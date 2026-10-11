/**
 * „📥 Увези од поднесена годишна сметка (Excel / CSV)“ — legacy `zmImport` 10953–10966: AOP amounts of a filed annual
 * account (e.g. the ЦРМ printout saved as Excel) become manual amounts: current year → year Y, previous year → Y−1.
 * Rows: the section comes from the text „биланс на состојба“ / „биланс на успех“; the AOP is the first cell after the
 * first column with 1–3 digits in 1..300; of the numbers after it the first is the current year and the last the
 * previous year (when there are at least two).
 */
import { impNum } from '../retail/import';

export type ZmRow = [rep: 'bs' | 'bu', aop: string, cur: number, prev: number | null];

/** Legacy CSV split: the delimiter (`;`, tab or `,`) that splits the first line most. */
export function zmCsvGrid(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const L = t.split(/\r?\n/);
  const first = L[0] ?? '';
  const dl = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  return L.map((l) => l.split(dl).map((x) => x.replace(/^"|"$/g, '').trim()));
}

const isAmount = (c: unknown): boolean => {
  if (typeof c === 'number') return Number.isFinite(c);
  const s = String(c ?? '').trim();
  if (!s || /[a-zа-шѓќљњџѕј]/i.test(s)) return false;
  return /\d/.test(s) && /^-?[\d.,\s()-]+$/.test(s);
};
const amount = (c: unknown): number => {
  if (typeof c === 'number') return c;
  const s = String(c).trim();
  const neg = /^\(.*\)$/.test(s);
  const v = impNum(s.replace(/[()]/g, ''));
  return neg ? -v : v;
};

/** AOP rows of the grid. Each row's first cell is skipped (legacy prefixes the sheet name). */
export function zmParse(A: readonly (readonly unknown[])[]): ZmRow[] {
  const rows: ZmRow[] = [];
  let sec: '' | 'bs' | 'bu' = '';
  for (const r of A) {
    const txt = r.map((c) => String(c ?? '')).join(' ').toLowerCase();
    if (/биланс на состојба/.test(txt)) sec = 'bs';
    else if (/биланс на успех/.test(txt)) sec = 'bu';
    const ai = r.findIndex((c, i) => i > 0 && /^\d{1,3}$/.test(String(c ?? '').trim()) && +String(c) >= 1 && +String(c) <= 300);
    if (ai < 0) continue;
    const nums = r.slice(ai + 1).filter((c) => String(c ?? '').trim() !== '' && isAmount(c)).map(amount);
    const aop = String(+String(r[ai])).padStart(3, '0');
    rows.push([sec || (+aop >= 201 ? 'bu' : 'bs'), aop, nums[0] || 0, nums.length > 1 ? nums[nums.length - 1]! : null]);
  }
  return rows;
}

/** Rounded, non-zero amounts keyed `bs001` / `bu201` for the current and the previous year. */
export function zmSplit(rows: readonly ZmRow[]): { cur: Record<string, number>; prev: Record<string, number> } {
  const cur: Record<string, number> = {}, prev: Record<string, number> = {};
  for (const [r, a, c, p] of rows) {
    if (c) cur[r + a] = Math.round(c);
    if (p) prev[r + a] = Math.round(p);
  }
  return { cur, prev };
}

export const ZM_TEMPLATE: readonly (readonly string[])[] = [
  ['Биланс на состојба'],
  ['', 'АОП', 'Позиција', 'Тековна година', 'Претходна година'],
  ['', '001', 'А. Постојани средства', '', ''],
  ['Биланс на успех'],
  ['', '201', 'I. Приходи од работењето', '', ''],
];

/** Legacy `zmImport` 10960 prompt (verbatim): a filed annual account (PDF / image) read by AI. */
export const ZM_PROMPT = 'This is a filed annual account (годишна сметка) of a North Macedonian company from Централен регистар: Биланс на состојба (AOP 001–112) and/or Биланс на успех (AOP 201–258). Columns are usually: Ознака за АОП, Опис, Нето за тековна година, Бруто за тековна година, Исправка на вредноста, Претходна година (or Тековна година / Претходна година). Reply ONLY JSON: {"year":number (the year of the annual account),"rows":[["bs" or "bu", AOP as 3-digit string, current year NET amount (number, 0 if empty), previous year amount (number or null)]]}. Include EVERY AOP row that has any amount. Amounts like 1.234.567,00 mean 1234567.';

/** Legacy `zmImport` mapping of the AI answer: rows (AOP ≥ 201 → БУ), the year printed on the document. */
export function zmFromAi(res: unknown): { year: number | null; rows: ZmRow[] } {
  const r = (Array.isArray(res) ? { rows: res } : (res ?? {})) as { year?: unknown; rows?: unknown };
  const rows: ZmRow[] = (Array.isArray(r.rows) ? r.rows : []).filter(Array.isArray).map((x: unknown[]) => [
    x[0] === 'bu' || +(x[1] as number) >= 201 ? 'bu' : 'bs', String(+(x[1] as number)).padStart(3, '0'), +(x[2] as number) || 0, x[3] == null ? null : +(x[3] as number) || 0,
  ] as ZmRow).filter((x) => /^\d{3}$/.test(x[1]) && x[1] !== '000' && x[1] !== 'NaN');
  return { year: +(r.year as number) || null, rows };
}
