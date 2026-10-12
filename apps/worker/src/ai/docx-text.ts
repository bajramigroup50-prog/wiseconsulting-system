/**
 * Plain text of a Word .docx (for the free readers): the ZIP's `word/document.xml` (stored or deflated, read through
 * the central directory with node:zlib — no extra dependency), paragraphs separated by a blank line, tabs as spaces. Null when the
 * file is not a readable .docx.
 */
import { inflateRawSync } from 'node:zlib';

function entry(b: Buffer, name: string): Buffer | null {
  // end of central directory: signature 0x06054b50 within the last 64 KiB
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= b.length; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) return null;
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const fl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const nm = b.toString('utf8', p + 46, p + 46 + fl);
    if (nm === name) {
      if (b.readUInt32LE(off) !== 0x04034b50) return null;
      const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
      const data = b.subarray(start, start + csize);
      return method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    }
    p += 46 + fl + xl + cl;
  }
  return null;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function docxText(bytes: Uint8Array): string | null {
  try {
    const x = entry(Buffer.from(bytes), 'word/document.xml');
    if (!x) return null;
    return x.toString('utf8')
      .replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENT[e]!).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d));
  } catch { return null; }
}
