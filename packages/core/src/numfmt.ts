/**
 * Number format of imported text (zero tolerance for wrong amounts). In North Macedonia the usual format is
 * dot = thousands, comma = decimals („10.000,00“); other programs / banks also write „10,000.00“ or „1234.56“.
 *
 *   value evidence   „1.234,56“, „12,5“, „1234,56“          → mk   (comma decimal)
 *                    „1,234.56“, „1234.56“, „0.5“            → dot  (point decimal)
 *                    „10.000“, „1.500.000“, „1,500“          → amb  (separator + exactly 3 digits: thousands OR decimals)
 *                    „1234“, numbers from Excel               → none
 *
 * A column (or a whole document) takes the evidence of ALL its values: mk / dot when only that kind is present,
 * `amb` when the only evidence is ambiguous, `conflict` when both kinds are present. Ambiguous columns are never
 * guessed: the converter / importer asks for the „Децимали“ setting, the readers without AI pick the interpretation
 * whose totals reconcile (opening + movements = closing, debit = credit, base + VAT = total) and flag the rest.
 */

export type NumFmt = 'mk' | 'dot';
export type NumEvidence = NumFmt | 'amb' | 'none';
export type ColFmt = NumFmt | 'amb' | 'none' | 'conflict';

const clean = (v: unknown) => String(v ?? '').trim().replace(/[\s ']/g, '').replace(/(ден\.?|мкд|mkd|eur|€|usd|\$)/gi, '').replace(/^\((.*)\)$/, '-$1').replace(/^(.*)-$/, '-$1');

/** What one value says about the format. */
export function numEvidence(v: unknown): NumEvidence {
  if (typeof v === 'number' || v instanceof Date) return 'none';
  const t = clean(v).replace(/^[-+]/, '');
  if (!/^\d[\d.,]*$/.test(t) || !/\d$/.test(t)) return 'none';
  const hasC = t.includes(','), hasD = t.includes('.');
  // „0.125“ / „0,125“: a leading 0 group is never a thousands group → the separator is the decimal one
  if (/^0[.,]\d+$/.test(t)) return t[1] === ',' ? 'mk' : 'dot';
  if (hasC && hasD) return t.lastIndexOf(',') > t.lastIndexOf('.') ? 'mk' : 'dot';
  if (hasC) {
    if (/^\d{1,3}(,\d{3})+$/.test(t)) return 'amb';
    return /^\d+,\d+$/.test(t) ? 'mk' : 'none';
  }
  if (hasD) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return 'amb';
    return /^\d+\.\d+$/.test(t) ? 'dot' : 'none';
  }
  return 'none';
}

/** Format of a column / document from all its values. */
export function colFormat(values: Iterable<unknown>): ColFmt {
  let mk = false, dot = false, amb = false;
  for (const v of values) {
    const e = numEvidence(v);
    if (e === 'mk') mk = true; else if (e === 'dot') dot = true; else if (e === 'amb') amb = true;
  }
  return mk && dot ? 'conflict' : mk ? 'mk' : dot ? 'dot' : amb ? 'amb' : 'none';
}

/** Is the format decided (no explicit choice needed)? */
export const fmtDecided = (f: ColFmt): f is NumFmt | 'none' => f === 'mk' || f === 'dot' || f === 'none';

/**
 * Parse a value in a known format (`none` = no separators were seen: plain integers). Returns null for text that is
 * not a number. „12,50-“ / „(12,50)“ are negative.
 */
export function parseNum(v: unknown, fmt: NumFmt | 'none'): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = clean(v);
  if (!t) return null;
  let neg = false;
  if (/^[-+]/.test(t)) { neg = t[0] === '-'; t = t.slice(1); }
  if (!/^\d[\d.,]*$/.test(t)) return null;
  if (fmt === 'mk') t = t.replace(/\./g, '').replace(',', '.');
  else if (fmt === 'dot') t = t.replace(/,/g, '');
  else if (/[.,]/.test(t)) return null;
  if ((t.match(/\./g) ?? []).length > 1) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Parse with the format of the value itself, else `fallback` (used once the column / document format is known). */
export function parseNumAuto(v: unknown, fallback: NumFmt): number | null {
  const e = numEvidence(v);
  return parseNum(v, e === 'mk' || e === 'dot' ? e : e === 'amb' ? fallback : 'none') ?? parseNum(v, fallback);
}

/** Map the importer's „Децимали“ setting to a format. */
export const decToFmt = (d: string | null | undefined): NumFmt | null => (d === 'comma' ? 'mk' : d === 'dot' ? 'dot' : null);

/** Human text of an ambiguous example for warnings. */
export const AMB_HELP = 'Износите како „10.000“ може да значат десет илјади (10.000,00) или десет (10.000 со точка како децимала). Изберете „Децимали“ пред увозот.';

/**
 * Pick the interpretation of an ambiguous document whose totals reconcile. `check(fmt)` returns true when the amounts
 * read in that format reconcile. Exactly one reconciling format → it; none or both → null (flag for review).
 */
export function reconcileFmt(check: (fmt: NumFmt) => boolean): NumFmt | null {
  const mk = check('mk'), dot = check('dot');
  return mk && !dot ? 'mk' : dot && !mk ? 'dot' : null;
}

/** Thrown by the importers' parsers when the amounts are ambiguous and nothing in the file decides the format. */
export class AmbiguousAmountsError extends Error {
  constructor(public what = 'Износите', public examples: string[] = []) {
    super(`${what} не можат со сигурност да се прочитаат${examples.length ? ` (на пр. „${examples.slice(0, 3).join('“, „')}“)` : ''}: „10.000“ може да значи десет илјади или десет. ` +
      'Изберете го форматот на децималите (или претворете ја датотеката преку 🔄 Конвертор на датотеки со избрани „Децимали“).');
    this.name = 'AmbiguousAmountsError';
  }
}

/** Ambiguous example values of a column (for messages). */
export const ambExamples = (values: Iterable<unknown>, n = 3): string[] => {
  const out: string[] = [];
  for (const v of values) { if (numEvidence(v) === 'amb' && out.length < n) out.push(String(v).trim()); }
  return out;
};

/** A JS number as text that no reader can misread („10.123“ → „10.1230“: 4 decimals are unambiguous). */
export function numStr(n: number): string {
  const s = String(n);
  return /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s + '0' : s;
}
