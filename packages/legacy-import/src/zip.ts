/**
 * Minimal ZIP reader for legacy backup archives.
 *
 * Legacy `zipStore` (index.html 8121) writes a plain "stored" ZIP (no compression, UTF-8 names, one
 * `<firm name>_<fid>.json` per firm). Users may also re-pack the files with Windows / 7-Zip, so deflate
 * (method 8) is supported as well. No ZIP64, no encryption — neither is produced by the legacy program.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry { name: string; data: Uint8Array }

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** All file entries of a ZIP archive (directories skipped). Throws on a damaged archive. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP архивата е оштетена (нема централен директориум).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== SIG_CEN) throw new Error('ZIP архивата е оштетена (централен запис).');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const loc = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (v.getUint32(loc, true) !== SIG_LOC) throw new Error(`ZIP архивата е оштетена (${name}).`);
    const start = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
    else throw new Error(`ZIP: непознат метод на компресија ${method} (${name}).`);
  }
  return out;
}
