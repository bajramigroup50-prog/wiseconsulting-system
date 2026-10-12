/**
 * Turns the screencast frames of e2e/prenos-demo.spec.ts (E2E_DEMO_FRAMES: JPEGs + frames.json) into a video without
 * ffmpeg: the installed Chrome replays the frames on a canvas at their recorded times and encodes it with
 * MediaRecorder — MP4 (H.264) when this Chrome supports it, otherwise WebM (VP9/VP8).
 *
 *   node e2e/demo-video.mjs <framesDir> <outFileWithoutExtension> [maxGapSeconds=2.5] [speed=1]
 *
 * Pauses longer than maxGap (screenshots, page loads) are shortened; the run is real-time (≈ the video's length).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Chrome's MediaRecorder writes a fragmented MP4 without a total duration (players then show a wrong length and
 * cannot seek well): compute the end of the last fragment and write it into mvhd / tkhd plus an `mehd` box.
 */
function mp4WithDuration(b) {
  const box = (o) => { let size = b.readUInt32BE(o); const type = b.toString('latin1', o + 4, o + 8); let h = 8; if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); h = 16; } return { size, type, h }; };
  const kids = (s, e) => { const r = []; for (let o = s; o + 8 <= e;) { const x = box(o); r.push({ ...x, o }); o += x.size || e - o; } return r; };
  const top = kids(0, b.length);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return b;
  const mv = kids(moov.o + moov.h, moov.o + moov.size);
  const mvhd = mv.find((x) => x.type === 'mvhd');
  const trak = mv.find((x) => x.type === 'trak');
  const mvex = mv.find((x) => x.type === 'mvex');
  if (!mvhd || !trak || !mvex || kids(mvex.o + mvex.h, mvex.o + mvex.size).some((x) => x.type === 'mehd')) return b;
  const mdia = kids(trak.o + trak.h, trak.o + trak.size).find((x) => x.type === 'mdia');
  const mdhd = kids(mdia.o + mdia.h, mdia.o + mdia.size).find((x) => x.type === 'mdhd');
  const ts = b.readUInt32BE(mdhd.o + mdhd.h + (b[mdhd.o + mdhd.h] ? 20 : 12));
  const trex = kids(mvex.o + mvex.h, mvex.o + mvex.size).find((x) => x.type === 'trex');
  const defDur0 = trex ? b.readUInt32BE(trex.o + trex.h + 12) : 0;
  let end = 0;
  for (const m of top.filter((x) => x.type === 'moof')) for (const t of kids(m.o + m.h, m.o + m.size).filter((x) => x.type === 'traf')) {
    const tk = kids(t.o + t.h, t.o + t.size);
    const tfhd = tk.find((x) => x.type === 'tfhd'), tfdt = tk.find((x) => x.type === 'tfdt');
    let defDur = defDur0;
    if (tfhd) { const fl = b.readUInt32BE(tfhd.o + tfhd.h) & 0xffffff; let q = tfhd.o + tfhd.h + 8; if (fl & 1) q += 8; if (fl & 2) q += 4; if (fl & 8) defDur = b.readUInt32BE(q); }
    let at = tfdt ? (b[tfdt.o + tfdt.h] ? Number(b.readBigUInt64BE(tfdt.o + tfdt.h + 4)) : b.readUInt32BE(tfdt.o + tfdt.h + 4)) : 0;
    for (const r of tk.filter((x) => x.type === 'trun')) {
      const fl = b.readUInt32BE(r.o + r.h) & 0xffffff, n = b.readUInt32BE(r.o + r.h + 4);
      let q = r.o + r.h + 8; if (fl & 1) q += 4; if (fl & 4) q += 4;
      const per = (fl & 0x100 ? 4 : 0) + (fl & 0x200 ? 4 : 0) + (fl & 0x400 ? 4 : 0) + (fl & 0x800 ? 4 : 0);
      for (let i = 0; i < n; i++, q += per) at += fl & 0x100 ? b.readUInt32BE(q) : defDur;
    }
    end = Math.max(end, at);
  }
  if (!end) return b;
  const out = Buffer.from(b);
  const v1 = out[mvhd.o + mvhd.h];
  const mts = out.readUInt32BE(mvhd.o + mvhd.h + (v1 ? 20 : 12));
  const movieDur = Math.round((end / ts) * mts);
  if (v1) out.writeBigUInt64BE(BigInt(movieDur), mvhd.o + mvhd.h + 24); else out.writeUInt32BE(movieDur, mvhd.o + mvhd.h + 16);
  const tkhd = kids(trak.o + trak.h, trak.o + trak.size).find((x) => x.type === 'tkhd');
  if (tkhd) { if (out[tkhd.o + tkhd.h]) out.writeBigUInt64BE(BigInt(movieDur), tkhd.o + tkhd.h + 28); else out.writeUInt32BE(movieDur, tkhd.o + tkhd.h + 20); }
  const mehd = Buffer.alloc(16); mehd.writeUInt32BE(16, 0); mehd.write('mehd', 4, 'latin1'); mehd.writeUInt32BE(movieDur, 12);
  // mehd becomes the first child of mvex; mvex and moov grow by 16 bytes (fragment data offsets are relative to their moof)
  out.writeUInt32BE(out.readUInt32BE(moov.o) + 16, moov.o);
  out.writeUInt32BE(out.readUInt32BE(mvex.o) + 16, mvex.o);
  const at = mvex.o + mvex.h;
  console.log(`duration ${(end / ts).toFixed(1)} s written into the MP4 header`);
  return Buffer.concat([out.subarray(0, at), mehd, out.subarray(at)]);
}

const [dir, out, gapArg, speedArg] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node e2e/demo-video.mjs <framesDir> <outFile> [maxGap] [speed]'); process.exit(2); }
const maxGap = Number(gapArg ?? 2.5), speed = Number(speedArg ?? 1);
const frames = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'));
// display time of each frame (seconds), long pauses shortened
const times = [];
let t = 0;
frames.forEach((f, i) => { times.push(t); const next = frames[i + 1]; if (next) t += Math.min(Math.max(next.t - f.t, 0), maxGap) / speed; });
const total = t + 1.5;
console.log(`${frames.length} frames, ${total.toFixed(1)} s`);

// headed: a headless Chrome produces canvas frames irregularly and the recording comes out too short
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'chrome', headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage();
await page.route('http://demo.local/**', (r) => {
  const name = new URL(r.request().url()).pathname.slice(1);
  if (!name) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="c"></canvas>' });
  return r.fulfill({ contentType: 'image/jpeg', body: readFileSync(join(dir, name)) });
});
await page.goto('http://demo.local/');
const chunks = [];
await page.exposeFunction('putChunk', (b64) => { chunks.push(Buffer.from(b64, 'base64')); });
page.on('console', (m) => console.log('page:', m.text()));
const mime = await page.evaluate(async ({ names, times, total }) => {
  const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const type = types.find((x) => MediaRecorder.isTypeSupported(x));
  const load = async (n) => createImageBitmap(await (await fetch('/' + n)).blob());
  const first = await load(names[0]);
  const c = document.getElementById('c');
  c.width = first.width - (first.width % 2); c.height = first.height - (first.height % 2);
  const g = c.getContext('2d');
  g.drawImage(first, 0, 0);
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 2_500_000 });
  const done = new Promise((ok) => { rec.onstop = ok; });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1000);
  const t0 = performance.now();
  const ahead = new Map([[0, Promise.resolve(first)]]);
  const want = (i) => { if (i < names.length && !ahead.has(i)) ahead.set(i, load(names[i])); };
  for (let i = 0; i < names.length; i++) {
    for (let k = 1; k <= 12; k++) want(i + k);
    const img = await ahead.get(i);
    ahead.delete(i);
    const wait = t0 + times[i] * 1000 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    g.drawImage(img, 0, 0);
    img.close();
    if (i % 200 === 0) console.log(`frame ${i}/${names.length}`);
  }
  const end = t0 + total * 1000 - performance.now();
  if (end > 0) await new Promise((r) => setTimeout(r, end));
  rec.stop();
  await done;
  // one Blob in recording order, handed over in pieces
  const b = new Uint8Array(await new Blob(parts, { type }).arrayBuffer());
  for (let o = 0; o < b.length; o += 1 << 20) {
    const part = b.subarray(o, o + (1 << 20));
    let s = ''; for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode(...part.subarray(i, i + 0x8000));
    await window.putChunk(btoa(s));
  }
  return type;
}, { names: frames.map((f) => f.f), times, total });
await browser.close();
const ext = mime.startsWith('video/mp4') ? '.mp4' : '.webm';
const video = ext === '.mp4' ? mp4WithDuration(Buffer.concat(chunks)) : Buffer.concat(chunks);
writeFileSync(out + ext, video);
console.log(`${out}${ext} (${mime}), ${(video.length / 1e6).toFixed(1)} MB`);
