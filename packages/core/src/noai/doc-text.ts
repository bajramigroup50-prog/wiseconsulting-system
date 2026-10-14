/**
 * Shared helpers of the free (no-AI) readers of printed documents (МПИН, fiscal reports, fiscal receipts): the PDF text
 * layer as text lines, strict amounts (always 2 decimals, so „1.234,56“ / „1,234.56“ / „1 234.56“ are never
 * ambiguous) and dates. A result of these readers carries `noai: true` and `note` (NOAI_NOTE) so the screen says it
 * was read without AI and must be checked.
 */
import { r2 } from '../money';
import type { PdfLine } from './pdf-lines';

/** Shown on every result of the free readers (МПИН / fiscal report / fiscal receipt). */
export const NOAI_NOTE = 'прочитано без AI – проверете';

/** A printed amount: thousands with space / dot / comma, exactly 2 decimals; not a percentage. */
export const AMT_SRC = '-?\\d{1,3}(?:[ \\u00a0.,]\\d{3})+[.,]\\d{2}(?![\\d%])|-?\\d+[.,]\\d{2}(?![\\d%])';
const AMT_G = () => new RegExp(`(?<![\\d.,])(?:${AMT_SRC})`, 'g');

/** Parse one strict amount token (null when it is not one). */
export function amt(tok: string): number | null {
  const t = tok.replace(/[  ]/g, '');
  const m = /^(-?)([\d.,]*?)[.,](\d{2})$/.exec(t);
  if (!m) return null;
  const int = m[2]!.replace(/[.,]/g, '');
  if (!/^\d+$/.test(int)) return null;
  return r2(+(m[1] + int + '.' + m[3]));
}

/** All amounts on a line, left → right (percentages removed first). */
export function amountsIn(s: string): number[] {
  const t = s.replace(/\d{1,3}(?:[.,]\d{1,2})?\s*%/g, ' ');
  return [...t.matchAll(AMT_G())].map((m) => amt(m[0])!).filter((x) => x != null);
}

/** Last amount on a line (null when none). */
export const lastAmount = (s: string): number | null => { const A = amountsIn(s); return A.length ? A[A.length - 1]! : null; };

/** Percentages on a line („18%“, „18.00 %“, „0,5%“). */
export const percentsIn = (s: string): number[] => [...s.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g)].map((m) => +m[1]!.replace(',', '.'));

/** d.m.yyyy / d-m-yyyy / d/m/yyyy → ISO ('' when none); the first date on the line. */
export function dateIn(s: string): string {
  const m = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/.exec(s) ?? /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
  if (!m) return '';
  const [y, mo, d] = m[1]!.length === 4 ? [m[1]!, m[2]!, m[3]!] : [m[3]!, m[2]!, m[1]!];
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const D = new Date(iso + 'T00:00:00Z');
  return !isNaN(+D) && D.toISOString().slice(0, 10) === iso ? iso : '';
}

/** A 13-digit ЕДБ on the line (also „MK4030…“), '' when none. */
export const edbIn = (s: string): string => /(?<!\d)(\d{13})(?!\d)/.exec(s.replace(/(\d)[  ](?=\d)/g, '$1'))?.[1] ?? '';

/** PDF lines → text lines: cells joined with three spaces (so cell gaps stay visible to the line patterns). */
export const pdfTextLines = (L: readonly PdfLine[]): string[] => L.map((l) => l.cells.map((c) => c.s).join('   '));

/** Plain text (TXT export) → lines, trimmed, without empty lines. */
export const textLines = (t: string): string[] => t.split(/\r?\n/).map((s) => s.replace(/\t/g, '   ').trimEnd()).filter((s) => s.trim());

/** Upper case with the Latin look-alikes of the Cyrillic group letters kept as they are. */
export const up = (s: string): string => s.toUpperCase().replace(/[ \t]+/g, ' ');

/** Result of a free reader: the data (same shape as the AI read) only when every check passed, else the reason. */
export interface FreeParse<T> { data: T | null; ok: boolean; why: string; checks: string[] }
