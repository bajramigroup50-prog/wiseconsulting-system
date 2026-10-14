'use client';
/**
 * Phone capture (installed PWA on Android / iPhone): big buttons, the back camera (`capture="environment"`), photos
 * shrunk in the browser (long side ≤ 2000 px, JPEG 0.8), PDFs as they are. Sending = upload every file
 * (`lib/upload.ts`: hash → presigned PUT → confirm, duplicates reused) → `sendCapture`.
 *
 * Offline-tolerant: every send is first saved in this browser (IndexedDB `wise-capture`), removed only after the
 * server answered; what could not be sent stays listed („⏳ чека мрежа“) and is retried on „Обиди се пак“, when the
 * phone is back online and every minute while the page is open. The same `cid` is sent on every retry, so a send whose
 * answer was lost is not stored twice.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_JPEG_Q, CAPTURE_KINDS, CAPTURE_MAX_FILES, captureScale, type CaptureKind } from '@wise/core/office';
import { uploadFile } from '@/lib/upload';
import { sendCapture } from './actions';

interface QFile { name: string; type: string; blob: Blob; id?: string }
interface QItem { cid: string; firmId: string; kind: CaptureKind; note: string; combine: boolean; at: number; files: QFile[]; error?: string }

/* ---------------- IndexedDB queue (falls back to memory when the browser refuses storage) ---------------- */
const DB = 'wise-capture', ST = 'queue';
const mem = new Map<string, QItem>();
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(ST, { keyPath: 'cid' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function qAll(): Promise<QItem[]> {
  const d = await idb();
  if (!d) return [...mem.values()];
  return new Promise((res) => {
    const r = d.transaction(ST).objectStore(ST).getAll();
    r.onsuccess = () => res((r.result as QItem[]).sort((a, b) => a.at - b.at));
    r.onerror = () => res([...mem.values()]);
  });
}
async function qPut(x: QItem): Promise<void> {
  mem.set(x.cid, x);
  const d = await idb();
  if (!d) return;
  await new Promise<void>((res) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(x); t.oncomplete = () => res(); t.onerror = () => res(); });
}
async function qDel(cid: string): Promise<void> {
  mem.delete(cid);
  const d = await idb();
  if (!d) return;
  await new Promise<void>((res) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).delete(cid); t.oncomplete = () => res(); t.onerror = () => res(); });
}

/** Long side ≤ 2000 px, JPEG 0.8 (EXIF rotation applied); anything that is not a decodable photo is kept as is. */
async function compress(f: File): Promise<QFile> {
  if (!/^image\//.test(f.type) || f.type === 'image/gif') return { name: f.name, type: f.type || 'application/octet-stream', blob: f };
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const sc = captureScale(bmp.width, bmp.height);
    if (sc === 1 && f.type === 'image/jpeg' && f.size < 1.2e6) return { name: f.name, type: f.type, blob: f };
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const bl = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', CAPTURE_JPEG_Q));
    return bl ? { name: f.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', blob: bl } : { name: f.name, type: f.type, blob: f };
  } catch { return { name: f.name, type: f.type, blob: f }; }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16)));

/** Upload what is not uploaded yet (ids kept in the queue), then send the message. */
async function deliver(x: QItem): Promise<{ ok: true } | { ok: false; error: string; fatal?: boolean }> {
  for (const f of x.files) {
    if (f.id) continue;
    const r = await uploadFile(new File([f.blob], f.name, { type: f.type }), x.firmId).catch(() => ({ ok: false as const, error: 'Нема врска со серверот.' }));
    if (!r.ok) return { ok: false, error: r.error };
    f.id = r.id;
    await qPut(x);
  }
  const r = await sendCapture({ cid: x.cid, kind: x.kind, note: x.note, combine: x.combine, fileIds: x.files.map((f) => f.id!) }).catch(() => null);
  if (!r) return { ok: false, error: 'Нема врска со серверот.' };
  if (r.error) return { ok: false, error: r.error, fatal: true };
  return { ok: true };
}

export function Capture({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<CaptureKind | null>(null);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<QFile[]>([]);
  const [combine, setCombine] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [queue, setQueue] = useState<QItem[]>([]);
  const urls = useRef(new Map<Blob, string>());
  const url = (b: Blob) => { let u = urls.current.get(b); if (!u) { u = URL.createObjectURL(b); urls.current.set(b, u); } return u; };
  const running = useRef(false);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      let sent = 0;
      for (const x of (await qAll()).filter((q) => q.firmId === firmId)) {
        const r = await deliver(x);
        if (r.ok) { await qDel(x.cid); sent++; } else { x.error = r.error; await qPut(x); }
      }
      setQueue((await qAll()).filter((q) => q.firmId === firmId));
      if (sent) { setMsg({ t: sent === 1 ? 'Испратено до канцеларијата. ✓' : `Испратени ${sent} праќања. ✓` }); router.refresh(); }
    } finally { running.current = false; }
  }, [firmId, router]);

  useEffect(() => {
    void qAll().then((q) => setQueue(q.filter((x) => x.firmId === firmId)));
    void flush();
    const on = () => { void flush(); };
    window.addEventListener('online', on);
    const t = setInterval(() => { if (navigator.onLine !== false) void flush(); }, 60_000);
    return () => { window.removeEventListener('online', on); clearInterval(t); };
  }, [firmId, flush]);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setMsg(null);
    try {
      const out: QFile[] = [];
      for (const f of Array.from(list)) out.push(await compress(f));
      setPicked((p) => [...p, ...out].slice(0, CAPTURE_MAX_FILES));
    } finally { setBusy(false); }
  }

  async function send() {
    if (!kind) { setMsg({ t: 'Изберете што праќате.', bad: true }); return; }
    if (!picked.length) { setMsg({ t: 'Фотографирајте или изберете документ.', bad: true }); return; }
    setBusy(true); setMsg({ t: 'Се праќа…' });
    const x: QItem = { cid: uuid(), firmId, kind, note: note.trim(), combine: combine && picked.filter((f) => f.type.startsWith('image/')).length > 1, at: Date.now(), files: picked };
    await qPut(x);
    setPicked([]); setNote(''); setKind(null);
    try {
      const r = await deliver(x);
      if (r.ok) { await qDel(x.cid); setMsg({ t: 'Испратено до канцеларијата. ✓' }); router.refresh(); }
      else if (r.fatal) { await qDel(x.cid); setMsg({ t: r.error, bad: true }); setPicked(x.files); setKind(x.kind); setNote(x.note); }
      else { x.error = r.error; await qPut(x); setMsg({ t: '⏳ Нема мрежа – зачувано на телефонот, ќе се испрати само штом има врска.', bad: true }); }
    } finally {
      setQueue((await qAll()).filter((q) => q.firmId === firmId));
      setBusy(false);
    }
  }

  const photos = picked.filter((f) => f.type.startsWith('image/')).length;
  return (
    <div className="kfoto">
      <div className="kf-step">1. Што праќате?</div>
      <div className="kf-kinds">
        {(Object.keys(CAPTURE_KINDS) as CaptureKind[]).map((k) => (
          <button key={k} type="button" className={`kf-kind${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <span>{CAPTURE_KINDS[k].icon}</span>{CAPTURE_KINDS[k].label}
          </button>
        ))}
      </div>

      <div className="kf-step">2. Фотографирајте или изберете</div>
      <div className="kf-pick">
        <label className="kf-big pri">📷 Фотографирај
          <input type="file" accept="image/*" capture="environment" multiple hidden disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="kf-big">🖼 Галерија / PDF
          <input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {picked.length > 0 && (
        <div className="kf-thumbs">
          {picked.map((f, i) => (
            <div key={i} className="kf-thumb">
              {f.type.startsWith('image/') ? <img src={url(f.blob)} alt={`страница ${i + 1}`} /> : <div className="kf-pdf">PDF<small>{f.name}</small></div>}
              <b>{i + 1}</b>
              <button type="button" aria-label="Отстрани" onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      {photos > 1 && (
        <label className="kf-chk"><input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} /> Сите {photos} слики се еден документ (спој ги во еден PDF)</label>
      )}

      <div className="kf-step">3. Порака (по желба)</div>
      <textarea className="kf-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="на пр. фактура за гориво, извод од 15.10…" />

      <button type="button" className="kf-send" disabled={busy} onClick={() => void send()}>{busy ? 'Се праќа…' : '📤 Испрати'}</button>
      {msg && <div className={`kf-msg${msg.bad ? ' bad' : ''}`} role="status">{msg.t}</div>}

      {queue.length > 0 && (
        <div className="kf-queue">
          <b>⏳ Чека мрежа ({queue.length})</b>
          {queue.map((q) => <div key={q.cid} className="mini">{new Date(q.at).toLocaleString('mk-MK')} · {CAPTURE_KINDS[q.kind]?.label} · {q.files.length} датотеки{q.error ? ` · ${q.error}` : ''}</div>)}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void flush()}>↻ Обиди се пак</button>
            <button type="button" className="btn ghost" onClick={async () => { if (!confirm('Да се отфрлат неиспратените?')) return; for (const q of queue) await qDel(q.cid); setQueue([]); }}>Отфрли</button>
          </div>
        </div>
      )}
    </div>
  );
}
