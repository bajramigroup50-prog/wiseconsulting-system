/**
 * EAN-13 barcodes (legacy 9186–9199): check digit, validation, the module bit pattern for drawing, and the next free
 * internal code (prefix `29`, in-store use only).
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Check digit of 12 digits (legacy `eanCheck`). */
export function eanCheck(d12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

/** 13 digits with a correct check digit (legacy `eanValid`). */
export const eanValid = (c: string | null | undefined): boolean => !!c && /^\d{13}$/.test(c) && eanCheck(c.slice(0, 12)) === c[12];

/** The 95 modules (`1` = bar) of a valid EAN-13, or `''` (legacy `eanSVG` / `eanPNG`). */
export function eanBits(code: string): string {
  if (!eanValid(code)) return '';
  const p = P[Number(code[0])]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'L' ? L : G)[Number(code[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
  return bits + '101';
}

/** Module indexes drawn as long guard bars. */
export const EAN_GUARDS: ReadonlySet<number> = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);

/** First free internal EAN-13 `29` + 10 digits + check (legacy `eanNextInternal`). */
export function eanNextInternal(used: Iterable<string>): string {
  const U = new Set([...used].map(String));
  for (let n = 1; ; n++) {
    const d12 = '29' + String(n).padStart(10, '0');
    const c = d12 + eanCheck(d12);
    if (!U.has(c)) return c;
  }
}
