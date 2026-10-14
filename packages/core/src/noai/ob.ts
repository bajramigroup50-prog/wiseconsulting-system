/**
 * Trial balance (бруто биланс) / opening journal from the text layer of a PDF, without AI.
 *
 *  1. The old program's „Бруто биланс со аналитика“ (`tb-analitika.ts`, read by its x layout): one row per analytic
 *     konto + partner with the CLOSING saldo split into debit / credit; every printed total („Сумарно за“,
 *     „Синтетика“, „Група“, „Класа“, „ВКУПНО“) is checked, and the next year's opening is prepared by the carry rules
 *     of `yearend/carry.ts` (classes 4/5/7/8, statistical 994 / 999 and zero balances excluded, with the reason).
 *  2. Otherwise generic: the header line with „Конто“ and the saldo / debit / credit columns is found, the lines are cut
 *     into those columns and the table goes through the opening-balance importer's own parser (`parseOpeningSheet`).
 *
 * The result has the shape of the AI read (`OB_PROMPT`: rows / totals / grand), so the opening-balance screen maps it
 * with `obFromAi` like any read. `balanced: true` (layout 1, everything reconciles) lets the worker accept the read
 * without AI.
 */
import { parseOpeningSheet } from '../ledger';
import { carryNotReason, DEFAULT_CARRY_STAT_PREFIXES, carryStatAccount } from '../yearend/carry';
import { lineText, pdfTable, type PdfLine } from './pdf-lines';
import { tbAnalitika, tbaOpeningDate, type TbaResult } from './tb-analitika';
import { finNalogFromLines } from './fin-nalog';

export const isObHeader = (cells: string[]): boolean => {
  const h = cells.join(' | ').toLowerCase();
  return /конто|сметка|konto/.test(h) && /салдо|должи|побарува|dolzi|pobaruva|debit|credit|saldo/.test(h);
};

type ObRowT = [string, string, string, string, number, number];
export interface ObExcluded { k: string; name: string; partner: string; code: string; d: number; p: number; why: string }
export interface ObPdfResult {
  rows: ObRowT[]; totals: [string, number, number][]; grand: [number, number];
  /** set by the layout reader: true = every printed total matches (accepted without AI) */
  balanced?: boolean; warnings?: string[]; source?: 'tb-analitika';
  period?: { from: string; to: string } | null;
  /** next year's opening by the carry rules (from the closing saldo) */
  opening?: { date: string; n: number; D: number; P: number; diff: number; balanced: boolean; excluded: ObExcluded[] };
  check?: { rows: number; pages: number; pagesTotal: number | null; totals: number; grandClose: number | null; grandD: number | null; grandP: number | null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dp = (n: number): [number, number] => [n > 0 ? r2(n) : 0, n < 0 ? r2(-n) : 0];

const FIELD_MK: Record<string, string> = { open: 'почетна состојба', turnD: 'промет должи', turnP: 'промет побарува', totD: 'вкупно должи', totP: 'вкупно побарува', close: 'крајно салдо' };

/** The layout reader's result as an ob read (closing saldo → debit / credit, carry rules for the opening). */
export function obFromTba(R: TbaResult, stat: readonly string[] = DEFAULT_CARRY_STAT_PREFIXES): ObPdfResult {
  const rows: ObRowT[] = [];
  const excluded: ObExcluded[] = [];
  let D = 0, P = 0, n = 0;
  for (const r of R.rows) {
    const [d, p] = dp(r.close);
    if (d || p) rows.push([r.k, r.name, r.partner, r.code, d, p]);
    const no = carryNotReason(r.k, r.close, stat);
    if (no) { if (no.rule !== 'zero') excluded.push({ k: r.k, name: r.name, partner: r.partner, code: r.code, d, p, why: no.reason }); continue; }
    D += Math.round(d * 100); P += Math.round(p * 100); n++;
  }
  // printed closing totals per synthetic account (3 digits) for the screen's control; statistical accounts and
  // 951 / 961 (remapped to 950 / 960 on the opening) are left out
  const totals: [string, number, number][] = R.totals
    .filter((t) => t.level === 'synth' && t.close != null && /^\d{3}$/.test(t.k) && !carryStatAccount(t.k, stat) && !/^9[56]1/.test(t.k))
    .map((t) => [t.k, ...dp(t.close!)]);
  const warnings: string[] = [
    ...R.bad.slice(0, 20).map((b) => `${b.label} (стр. ${b.page}): ${FIELD_MK[b.field] ?? b.field} во документот ${b.doc}, прочитано ${b.got}`),
    ...R.rowBad.slice(0, 20).map((b) => `конто ${b.k} (стр. ${b.page}): ${b.why}`),
  ];
  if (!R.grand) warnings.push('Не е најден редот „ВКУПНО“ – можеби документот не е целосен.');
  if (R.pagesTotal != null && R.pages < R.pagesTotal) warnings.push(`Прочитани се ${R.pages} од ${R.pagesTotal} страници.`);
  const g = R.grand;
  return {
    rows, totals, grand: [0, 0], balanced: R.ok && !warnings.length, warnings, source: 'tb-analitika', period: R.period,
    opening: { date: tbaOpeningDate(R), n, D: D / 100, P: P / 100, diff: (D - P) / 100, balanced: D === P, excluded },
    check: { rows: R.rows.length, pages: R.pages, pagesTotal: R.pagesTotal, totals: R.totals.length, grandClose: g?.close ?? null, grandD: g?.totD ?? null, grandP: g?.totP ?? null },
  };
}

export function obFromPdf(L: readonly PdfLine[]): ObPdfResult | null {
  const A = tbAnalitika(L);
  if (A) return obFromTba(A);
  // the old program's „Финансов налог“ (opening journal): records by row number, totals line as the control
  const F = finNalogFromLines(L);
  if (F) return { rows: F.rows, totals: [], grand: F.sum, balanced: F.balanced, warnings: F.balanced ? [] : [F.printed ? `Збирот на редовите (${F.sum[0].toFixed(2)} / ${F.sum[1].toFixed(2)}) не е еднаков на отпечатениот (${F.printed[0].toFixed(2)} / ${F.printed[1].toFixed(2)}).` : 'Должи ≠ Побарува.'] };
  const T = pdfTable(L, isObHeader);
  if (!T) return null;
  // the lines above the table go along: when they repeat on the next pages (firm, title, „Страна 2“) they are skipped
  const P = parseOpeningSheet([...L.slice(0, T.at).map((l) => [lineText(l)]), T.header, ...T.rows], 'excel');
  if (!P) return null;
  return { rows: P.rows, totals: P.totals, grand: [0, 0] };
}
