/**
 * 📥 Прием на документи – the office's деловодник for the documents a client brings (Закон за архивска граѓа,
 * Уредба за канцелариско и архивско работење; ISO 9001 8.5.3 „сопственост на клиентот“, 7.5.3; ISO 27001 A.5.9,
 * A.5.33). One receipt = one basic number of the office's book 01 (Примени), counted from 1 every 1 January for the
 * whole office: `01-157/26`; the documents in it get the sub-numbers /1…/n in the order of the kinds.
 */

export const PRIEM_KINDS = [
  ['in', 'Влезни фактури'],
  ['out', 'Излезни фактури'],
  ['bank', 'Изводи од банка'],
  ['fisk', 'Фискални / Z-извештаи'],
  ['plati', 'Плати / листи'],
  ['dog', 'Договори / решенија'],
  ['other', 'Друго'],
] as const;
export type PriemKind = (typeof PRIEM_KINDS)[number][0];
export const PRIEM_KIND_NAME: Record<PriemKind, string> = Object.fromEntries(PRIEM_KINDS) as Record<PriemKind, string>;
export const isPriemKind = (k: unknown): k is PriemKind => PRIEM_KINDS.some(([x]) => x === k);

/** One line of the receipt: how many pieces of a kind (`pack` = counted as packages, e.g. fiscal reports). */
export interface PriemItem { k: PriemKind; n: number; pack?: boolean; text?: string }

/** `01-157/26`. */
export const priemNo = (no: number, year: number) => `01-${no}/${String(year).slice(2)}`;
/** `01-157` (without the year, as on the dossier). */
export const priemShort = (no: number) => `01-${no}`;

/** Sub-numbers of each line: /1–/12, /13–/20 … (a package counts as one). */
export function priemSubRanges(items: readonly PriemItem[]): { k: PriemKind; from: number; to: number }[] {
  let at = 0;
  return items.filter((i) => i.n > 0).map((i) => {
    const c = i.pack ? 1 : i.n;
    const r = { k: i.k, from: at + 1, to: at + c };
    at += c;
    return r;
  });
}
export const priemTotal = (items: readonly PriemItem[]) => items.reduce((s, i) => s + (i.n > 0 ? (i.pack ? 1 : i.n) : 0), 0);

/**
 * Kept until: accounting documents 5 years after the end of the year of the period (Закон за сметководство), payroll
 * lists and contracts 10 years. Returns YYYY-12-31.
 */
export function priemKeepUntil(period: string, items: readonly PriemItem[]): string {
  const y = Number(period.slice(0, 4)) || new Date().getFullYear();
  const long = items.some((i) => i.n > 0 && (i.k === 'plati' || i.k === 'dog'));
  return `${y + (long ? 10 : 5)}-12-31`;
}

const MON = ['ЈАНУАРИ', 'ФЕВРУАРИ', 'МАРТ', 'АПРИЛ', 'МАЈ', 'ЈУНИ', 'ЈУЛИ', 'АВГУСТ', 'СЕПТЕМВРИ', 'ОКТОМВРИ', 'НОЕМВРИ', 'ДЕКЕМВРИ'];
/** `2026-10` → „ОКТОМВРИ 2026“. */
export const priemPeriodName = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? `${MON[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p);

/** Clean the posted lines (kinds known, counts 0–9999). */
export function priemItemsClean(raw: unknown): PriemItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PriemItem[] = [];
  for (const r of raw as Partial<PriemItem>[]) {
    if (!r || !isPriemKind(r.k)) continue;
    const n = Math.max(0, Math.min(9999, Math.floor(Number(r.n) || 0)));
    if (!n) continue;
    out.push({ k: r.k, n, ...(r.pack ? { pack: true } : {}), ...(r.k === 'other' && r.text ? { text: String(r.text).slice(0, 120) } : {}) });
  }
  return out;
}
