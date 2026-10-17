/**
 * Text of a PDF font without a usable ToUnicode map: pdfjs gives the glyph ids of the embedded TrueType subset as the
 * text (НЛБ „DpsStatement“ statements: „ɋɬɪɚɧɢɰɚ\u0003“ for „Страница “). The glyph order is the standard one of the
 * Windows core fonts (Arial / Times New Roman): ASCII at code − 29 (space = 3, „0“ = 0x13, „.“ = 0x11), Cyrillic
 * Ё–Џ, А–я, ё–џ from glyph 0x22C on. An item is decoded only when it has a character no real text holds (a control
 * character or one of the Latin-extended / IPA letters the Cyrillic glyph ids fall on) and no real Cyrillic letter;
 * pdfjs keeps one font per item, so the item is decoded as a whole (a space pdfjs inserted stays a space).
 */
import type { PdfItem } from './pdf-lines';

/** Glyph id → Unicode for the Cyrillic glyphs (Ё Ђ Ѓ Є Ѕ І Ї Ј Љ Њ Ћ Ќ Ў Џ, А–я, ё ђ … ќ ў џ). */
const CYR = (() => {
  const m = new Map<number, number>();
  const up = [0x401, 0x402, 0x403, 0x404, 0x405, 0x406, 0x407, 0x408, 0x409, 0x40a, 0x40b, 0x40c, 0x40e, 0x40f];
  up.forEach((u, i) => m.set(0x22c + i, u));
  for (let i = 0; i < 64; i++) m.set(0x23a + i, 0x410 + i);
  up.forEach((u, i) => m.set(0x27a + i, u + 0x50));
  return m;
})();

const GARBLED = /[\u0001-\u0008\u000b\u000c\u000e-\u001fȬ-ʇ]/;
const REAL_CYR = /[Ѐ-ӿ]/;

/** Is the text in glyph ids (see the module comment)? */
export const isGlyphText = (s: string): boolean => GARBLED.test(s) && !REAL_CYR.test(s);

/** Glyph-id text → Unicode (unchanged when it is not glyph-id text). */
export function decodeGlyphText(s: string): string {
  if (!isGlyphText(s)) return s;
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20) out += ' ';
    else if (c >= 0x01 && c <= 0x61) out += String.fromCharCode(c + 0x1d);
    else out += String.fromCodePoint(CYR.get(c) ?? c);
  }
  return out;
}

/** Items with glyph-id text decoded (others unchanged; the same array when nothing needs it). */
export function decodeGlyphItems<T extends PdfItem>(items: readonly T[]): T[] {
  if (!items.some((it) => isGlyphText(it.s))) return items as T[];
  return items.map((it) => (isGlyphText(it.s) ? { ...it, s: decodeGlyphText(it.s) } : it));
}
