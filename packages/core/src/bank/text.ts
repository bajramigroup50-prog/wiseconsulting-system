/**
 * Byte → text decoding for bank statement files.
 *
 * Legacy read every statement with `file.text()` (UTF-8 only), so cp1251 exports from
 * Macedonian e-banking (KBFileFormat, older MT940 and XML exports) came out as U+FFFD garbage.
 * The rebuild accepts the raw bytes and decides: BOM → UTF-8; XML `encoding="windows-1251"`
 * → cp1251; valid UTF-8 → UTF-8; otherwise cp1251.
 */

/** cp1251 code points for bytes 0x80–0xBF (0xC0–0xFF map to U+0410–U+044F); WHATWG table (0x98 → U+0098). */
const CP1251_HI = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f,
  0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x0098, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f,
  0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457,
];

/** Decode Windows-1251 bytes. */
export function decodeCp1251(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    const cp = b < 0x80 ? b : b >= 0xc0 ? 0x0410 + (b - 0xc0) : CP1251_HI[b - 0x80]!;
    out += String.fromCharCode(cp);
  }
  return out;
}

/** True when the bytes are well-formed UTF-8 (no overlongs, no surrogates, ≤ U+10FFFF). */
export function isUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) { i++; continue; }
    let need: number, min: number, cp: number;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; cp = b & 0x1f; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; cp = b & 0x0f; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; cp = b & 0x07; }
    else return false;
    if (i + need >= n) return false;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    i += need + 1;
  }
  return true;
}

/** Decode bytes already checked with {@link isUtf8} (no platform TextDecoder needed). */
function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) { cp = b; i += 1; }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f); i += 2; }
    else if (b < 0xf0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f); i += 3; }
    else { cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f); i += 4; }
    chunk.push(cp);
    if (chunk.length >= 8192) { parts.push(String.fromCodePoint(...chunk)); chunk = []; }
  }
  if (chunk.length) parts.push(String.fromCodePoint(...chunk));
  return parts.join('');
}

export type BankEncoding = 'utf-8' | 'windows-1251';

/** Pick the encoding of a statement file. */
export function detectEncoding(bytes: Uint8Array): BankEncoding {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  // XML declaration (ASCII-compatible in both encodings)
  const head = decodeCp1251(bytes.subarray(0, 200));
  const decl = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  if (decl) {
    const e = decl[1]!.toLowerCase().replace(/[_\s]/g, '-');
    if (/^(windows-1251|cp-?1251|x-cp1251)$/.test(e)) return 'windows-1251';
    if (/^utf-?8$/.test(e)) return isUtf8(bytes) ? 'utf-8' : 'windows-1251';
  }
  return isUtf8(bytes) ? 'utf-8' : 'windows-1251';
}

/**
 * Decode a statement file to text (BOM stripped). Strings pass through (BOM stripped) so the
 * parsers can be called with either raw bytes or already-decoded text.
 */
export function decodeBankBytes(input: Uint8Array | string): string {
  if (typeof input === 'string') return input.replace(/^﻿/, '');
  const enc = detectEncoding(input);
  const txt = enc === 'utf-8' ? decodeUtf8(input) : decodeCp1251(input);
  return txt.replace(/^﻿/, '');
}
