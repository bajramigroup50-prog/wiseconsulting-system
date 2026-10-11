/**
 * Exact money arithmetic for the compliance module: amounts travel as decimal strings (Postgres `numeric`) and are
 * added / compared as integer cents (deni), never as floating-point denars.
 */

/** `"1.234,56"`, `"1234.56"`, `1234.5`, `null` → integer cents. Throws on garbage so a typo never becomes 0. */
export function toCents(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Неважечки износ: ${v}`);
    return Math.round(v * 100);
  }
  let s = v.trim().replace(/\s|ден\.?|мкд|mkd/gi, '');
  if (!s) return 0;
  // Macedonian format 1.234.567,89 → 1234567.89; plain 1234.56 stays
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) throw new Error(`Неважечки износ: ${v}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

/** Integer cents → `"1234.56"` (the `numeric(18,2)` wire format). */
export function fromCents(c: number): string {
  const neg = c < 0;
  const a = Math.abs(Math.round(c));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Integer cents → `"1.234,56"` for documents. */
export function fmtCents(c: number): string {
  const s = fromCents(c);
  const [i, d] = s.replace('-', '').split('.') as [string, string];
  return (c < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}

export const sumCents = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
