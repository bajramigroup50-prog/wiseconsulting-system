/**
 * Legacy-parity helpers for the screens Курсна листа, Компензации and Платни налози (2026-10 parity pass).
 * Pure functions, unit-tested in `fin-parity.test.ts`.
 */
import { FX_DEF } from '../bank-match';
import { mpOpsFrom } from '../payroll/mpin';
import { r2 } from '../money';
import { PP_T, ppBankName, type PaymentOrder } from './pp';

type Cell = string | number | null | undefined;

/* ================================================================== Курсна листа */

export const FX_NAME: Record<string, string> = Object.fromEntries(FX_DEF.map((x) => [x[0], x[1]]));

/** Legacy `fxNew` 7961: every currency of `FX_DEF` plus every currency ever entered in the office list. */
export const fxCurrencies = (rows: readonly { cur: string }[]): string[] => [...new Set([...FX_DEF.map((x) => x[0]), ...rows.map((r) => r.cur)])];

/** Legacy `fxXlsx` 7969: Датум · Валута · Назив · Среден курс, oldest first. */
export function fxExportRows(rows: readonly { date: string; cur: string; rate: number | string }[]): (string | number)[][] {
  const R = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur));
  return [['Датум', 'Валута', 'Назив', 'Среден курс'], ...R.map((x) => [x.date, x.cur, FX_NAME[x.cur] ?? '', Number(x.rate)])];
}

/** Template for the rate import (same columns the export writes). */
export const FX_IMPORT_TEMPLATE: (string | number)[][] = [['Датум', 'Валута', 'Курс'], ['2026-10-01', 'EUR', 61.5], ['2026-10-01', 'USD', 54.2519]];

/** A date cell: `yyyy-mm-dd`, `dd.mm.yyyy` (also `/` and `-`), or an Excel serial number. '' if not a date. */
export function cellDate(v: Cell): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return '';
}

/** A number cell: `61,5`, `61.5`, `1.234,56`, `1,234.56`, or a number. NaN if empty/invalid. */
export function cellNum(v: Cell): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  const t = /,\d+$/.test(s) && !/\.\d+$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const norm = (s: Cell) => String(s ?? '').trim().toLowerCase();

/**
 * Parse an imported rate table (Excel/CSV rows, first row with the headings Датум, Валута, Курс — English
 * Date/Currency/Rate are accepted too; without recognised headings columns A/B/C are used). Returns the
 * lists grouped by date and the skipped rows with the reason.
 */
export function fxImportRows(rows: readonly (readonly Cell[])[]): { lists: { date: string; rows: { cur: string; rate: number }[] }[]; errors: string[] } {
  let hi = rows.findIndex((r) => r.some((c) => /^(датум|date)$/.test(norm(c))));
  let ci = { d: 0, c: 1, r: 2 };
  if (hi >= 0) {
    const H = rows[hi]!.map(norm);
    const find = (re: RegExp, def: number) => { const i = H.findIndex((h) => re.test(h)); return i >= 0 ? i : def; };
    ci = { d: find(/^(датум|date)$/, 0), c: find(/^(валута|currency|cur|шифра)$/, 1), r: find(/(курс|rate)/, 2) };
  } else hi = rows.length && !cellDate(rows[0]![0]) ? 0 : -1;
  const by = new Map<string, Map<string, number>>();
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (i <= hi || r.every((c) => String(c ?? '').trim() === '')) return;
    const date = cellDate(r[ci.d]);
    const cur = String(r[ci.c] ?? '').trim().toUpperCase();
    const rate = cellNum(r[ci.r]);
    if (!date) { errors.push(`Ред ${i + 1}: неважечки датум.`); return; }
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'MKD') { errors.push(`Ред ${i + 1}: неважечка валута „${cur}“.`); return; }
    if (!(rate > 0)) { errors.push(`Ред ${i + 1}: неважечки курс.`); return; }
    const m = by.get(date) ?? by.set(date, new Map()).get(date)!;
    m.set(cur, rate); // the last row of a date/currency wins
  });
  const lists = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, m]) => ({ date, rows: [...m.entries()].map(([cur, rate]) => ({ cur, rate })) }));
  return { lists, errors };
}

/* ================================================================== Компензации */

/** Legacy `kompSave` 8964: a bilateral compensation has exactly one partner. Returns the error or ''. */
export function kompKindError(kind: 'bi' | 'multi', partnerIds: readonly string[]): string {
  if (kind !== 'multi' && new Set(partnerIds).size > 1) return 'Билатерална компензација мора да е со еден комитент. Изберете „Мултилатерална“ за повеќе.';
  return '';
}

/**
 * Legacy `kompSave` 8969: an empty number or one already used by another compensation of the firm is replaced
 * by the next К-nnn/yyyy of the year (`taken` = numbers of the other compensations of the firm).
 */
export function kompResolveNumber(number: string | null | undefined, taken: readonly string[], next: () => string): string {
  const n = String(number ?? '').trim();
  return !n || taken.includes(n) ? next() : n;
}

/** Live totals of the editor (legacy `kompTot` footer): receivables, payables, difference. Amounts in denars. */
export function kompTotals(rows: readonly { side: 'rec' | 'pay'; amt: number | string | null | undefined }[]): { rec: number; pay: number; diff: number } {
  let rec = 0, pay = 0;
  for (const r of rows) { const a = Number(r.amt) || 0; if (r.side === 'rec') rec += a; else pay += a; }
  return { rec: r2(rec), pay: r2(pay), diff: r2(rec - pay) };
}

/* ================================================================== Платни налози */

/**
 * Legacy `ppMuni` 15765: municipality code of the firm's seat for the ПП50 payment account (`840-XXX-…`) —
 * `mpOpsFrom(muni ‖ city ‖ address)`. A 3-digit code stored in `muni` is used as it is.
 */
export function ppMuniCode(f: { muni?: string | null; city?: string | null; address?: string | null }): string {
  const m = String(f.muni ?? '').trim();
  if (/^\d{3}$/.test(m)) return m;
  return mpOpsFrom(m) || mpOpsFrom(f.city ?? '') || mpOpsFrom(f.address ?? '') || '';
}

/** Legacy `ppRender` change listener 15820: empty bank names are filled from the 3-digit bank code of the account. */
export function ppFillBanks(n: PaymentOrder): PaymentOrder {
  const o = { ...n };
  if (o.kind !== 'pp10' && !String(o.payerBank ?? '').trim() && o.payerAcc) o.payerBank = ppBankName(o.payerAcc);
  if (!String(o.recipBank ?? '').trim() && o.recipAcc) o.recipBank = ppBankName(o.recipAcc);
  return o;
}

/** Calibration offset (mm) for pre-printed forms, legacy `ppCal` 15816: numbers, clamped to ±50 mm, 0.5 mm steps. */
export function ppCalValue(v: unknown): number {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-50, Math.min(50, Math.round(n * 2) / 2));
}

/** Legacy `ppPrint` 15800: the print date is stamped only on orders not printed before. */
export const ppToStamp = (L: readonly { id: string; printedAt: Date | string | null }[]): string[] => L.filter((o) => !o.printedAt).map((o) => o.id);

/** Order of the suggestions (legacy `ppSuggest` 15773): by due date (else document date), oldest first. */
export function ppSortByDue<T extends { date: string; due?: string | null }>(L: readonly T[]): T[] {
  return L.slice().sort((a, b) => String(a.due || a.date).localeCompare(String(b.due || b.date)));
}

/** Excel/CSV of the saved orders. */
export function ppExportRows(L: readonly { kind: string; date: string; amount: string | number | null; printedAt: Date | string | null; data: PaymentOrder }[]): (string | number)[][] {
  const d = (v: Date | string | null) => (v ? (typeof v === 'string' ? v : v.toISOString()).slice(0, 10) : '');
  return [
    ['Датум', 'Образец', 'Налогодавач', 'Сметка налогодавач', 'Примач', 'Сметка примач', 'Банка примач', 'Цел', 'Шифра', 'Повикување (задолжување)', 'Повикување (одобрување)', 'Износ', 'Печатен'],
    ...L.map((o) => [
      o.date, PP_T[o.kind as keyof typeof PP_T] ?? o.kind, String(o.data.payer ?? '').split('\n')[0] ?? '', o.data.payerAcc ?? '',
      String(o.data.recip ?? '').split('\n')[0] ?? '', o.data.recipAcc ?? '', o.data.recipBank ?? '', o.data.purpose ?? '', o.data.code ?? '',
      o.data.refDebit ?? '', o.data.refCredit ?? '', o.amount == null || o.amount === '' ? '' : Number(o.amount), d(o.printedAt),
    ]),
  ];
}
