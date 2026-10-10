/**
 * Posting a read fiscal report (legacy `fiskPer` v2 11392–11467 and wrappers 13086–13152): the row checks
 * (`fkCheck`), per-day or summed posting (`fkRows2`), the МЕТГ day breakdown of a single posting (`fkDayRates`,
 * `fkMetgDays` with the even spread `fkSpread`), the posting scheme default (`fkScDef`) and the POS terminal
 * balance (`posSaldo`, `posBox`).
 */
import { FISK_G0, fkNormDate, fkRows, type FiskRead, type FiskRow } from '../ai/fisk';
import { fkSpread } from '../stock/fiscal';
import { num, r2 } from '../stock/num';

const fmt2 = (x: number) => x.toFixed(2);

/** Legacy `fkCheck`: sum of groups vs total, VAT per group vs the rate, cash + card + other vs total. */
export function fkCheck(r: FiskRow, G: Readonly<Record<string, number>>, fmt: (x: number) => string = fmt2): string[] {
  const P: string[] = [];
  if (Math.abs(r.sum - r.total) > 1) P.push(`збир по групи ${fmt(r.sum)} ≠ вкупно ${fmt(r.total)}`);
  for (const [L, g] of Object.entries(r.gross)) {
    const rate = num(G[L]);
    if (rate) {
      const exp = r2((g * rate) / (100 + rate));
      if (Math.abs(exp - (r.vat[L] || 0)) > Math.max(1, g * 0.002)) P.push(`ДДВ ${L} (${rate}%) ${fmt(r.vat[L] || 0)} ≠ пресметан ${fmt(exp)}`);
    }
  }
  const pay = r2(r.cash + r.card + r.other);
  if (pay && Math.abs(pay - r.total) > 1) P.push(`готовина+картичка ${fmt(pay)} ≠ вкупно ${fmt(r.total)}`);
  return P;
}

/** Row checks as the v2 screen shows them (without VAT only cash + card vs total). */
export function fkChecks2(r: FiskRow, G: Readonly<Record<string, number>>, nonVat: boolean, fmt?: (x: number) => string): string[] {
  if (!nonVat) return fkCheck(r, G, fmt);
  const pay = r.cash + r.card + r.other;
  return Math.abs(pay - r.total) > 1 && pay ? ['готовина+картичка ≠ вкупно'] : [];
}

/** Legacy `fkRows2`: rows without VAT become one turnover column; `sum` folds the days into one row dated `date`. */
export function fkRows2(R: FiskRead, o: { nonVat?: boolean; sum?: boolean; date?: string | null; today: string }): { G: Record<string, number>; rows: FiskRow[]; daily: boolean; nonVat: boolean } {
  const X = fkRows(R, o.today);
  const nonVat = !!o.nonVat;
  let rows = X.rows;
  if (nonVat) rows = rows.map((r) => ({ ...r, gross: { '—': r.total || r.sum }, vat: { '—': 0 }, sum: r.total || r.sum }));
  if (o.sum && rows.length > 1) {
    const T: FiskRow = { date: o.date || rows[rows.length - 1]!.date, z: (rows[0]!.z || '') + (rows.length > 1 ? '–' + (rows[rows.length - 1]!.z || '') : ''), gross: {}, vat: {}, total: 0, sum: 0, cash: 0, card: 0, other: 0, storno: 0, receipts: 0 };
    for (const r of rows) {
      for (const [L, g] of Object.entries(r.gross)) { T.gross[L] = r2((T.gross[L] || 0) + g); T.vat[L] = r2((T.vat[L] || 0) + (r.vat[L] || 0)); }
      for (const k of ['total', 'sum', 'cash', 'card', 'other', 'storno', 'receipts'] as const) T[k] = r2(T[k] + (num(r[k]) || 0));
    }
    rows = [T];
  } else if (o.date && !X.daily) rows = [{ ...rows[0]!, date: o.date }];
  return { G: nonVat ? { '—': 0 } : X.G, rows, daily: X.daily, nonVat };
}

/** Legacy `fkDayRates`: gross and VAT of a row per VAT rate (letter groups → rates; without VAT all at 0 %). */
export function fkDayRates(d: Pick<FiskRow, 'gross' | 'vat'>, G: Readonly<Record<string, number>>, nonVat: boolean): { g: Record<string, number>; v: Record<string, number> } {
  const g: Record<string, number> = {}, v: Record<string, number> = {};
  for (const [L, x] of Object.entries(d.gross || {})) {
    const rate = nonVat ? 0 : num(G[L]);
    g[rate] = r2((g[rate] || 0) + x);
    if (rate) v[rate] = r2((v[rate] || 0) + ((d.vat || {})[L] || 0));
  }
  return { g, v };
}

export interface MetgDay { date: string; total: number; z?: string; est?: boolean; g: Record<string, number>; v: Record<string, number> }

/**
 * Legacy `fkMetgDays`: the days of a single posting for МЕТГ / КДФИ — the daily Z rows of the read, or (periodic report
 * without days, `mg = 'spread'`) the total spread evenly over Mon–Sat, per rate in proportion, the last day takes the
 * rest; `mg = 'one'` or a one-day period → none.
 */
export function fkMetgDays(R: FiskRead, r: FiskRow, o: { nonVat: boolean; mg?: 'spread' | 'one'; today: string }): MetgDay[] | null {
  const X0 = fkRows(R, o.today);
  const G = X0 ? X0.G : FISK_G0;
  if (X0.daily && X0.rows.length > 1) return X0.rows.map((d) => ({ date: d.date, total: d.total, z: d.z || '', ...fkDayRates(d, G, o.nonVat) }));
  if (o.mg === 'one') return null;
  const from = fkNormDate(R.from), to = fkNormDate(R.to);
  if (!from || !to || from === to) return null;
  const tot = fkDayRates(X0.rows[0] ?? r, G, o.nonVat);
  const D = fkSpread(from, to, r.total);
  const T = r.total || 1;
  const acc = { g: {} as Record<string, number>, v: {} as Record<string, number> };
  return D.map((d, i) => {
    const last = i === D.length - 1;
    const g: Record<string, number> = {}, v: Record<string, number> = {};
    for (const [rt, x] of Object.entries(tot.g)) { g[rt] = last ? r2(x - (acc.g[rt] || 0)) : r2((x * d.total) / T); acc.g[rt] = r2((acc.g[rt] || 0) + g[rt]!); }
    for (const [rt, x] of Object.entries(tot.v)) { v[rt] = last ? r2(x - (acc.v[rt] || 0)) : r2((x * d.total) / T); acc.v[rt] = r2((acc.v[rt] || 0) + v[rt]!); }
    return { ...d, g, v };
  });
}

/** Turnover per VAT rate of a row (`{'18': 1180, '5': 105}`) for the posting. */
export function fkGrossByRate(r: FiskRow, G: Readonly<Record<string, number>>, nonVat: boolean): Record<string, number> {
  if (nonVat) return { 0: r.total || r.sum };
  const out: Record<string, number> = {};
  for (const [L, g] of Object.entries(r.gross)) { const k = String(num(G[L])); out[k] = r2((out[k] || 0) + g); }
  return out;
}

/** Legacy `FK_SC` posting schemes of a fiscal report. */
export const FK_SC: Readonly<Record<'trgNoVat' | 'usl' | 'trg', readonly [string, string]>> = {
  trgNoVat: ['Трговија – фирма без ДДВ (Д 1009 / П 7410; Д 6690 / П 6630)', '7410'],
  usl: ['Само услуги, без стока (Д 1009 / П 230018 / П 7414)', '7414'],
  trg: ['Трговија – ДДВ обврзник (П 7411 + ДДВ, излез на стока)', ''],
};

/** Legacy `fkScDef`: chosen scheme, else the firm's last one, else by VAT status. */
export const fkScDef = (chosen: string | null | undefined, firmSc: string | null | undefined, nonVat: boolean): 'trgNoVat' | 'usl' | 'trg' =>
  ((chosen || firmSc || (nonVat ? 'trgNoVat' : 'trg')) as 'trgNoVat' | 'usl' | 'trg');

/** EDB on the report matches the firm (legacy: the last 7 digits). */
export const fkEdbOk = (firmEdb: string | null | undefined, repEdb: string | null | undefined): boolean =>
  String(firmEdb ?? '').replace(/\D/g, '').endsWith(String(repEdb ?? '').replace(/\D/g, '').slice(-7));

/** Legacy `posSaldo` (13075): card payments booked on the POS account vs. received from the bank. */
export function posSaldo(ledger: readonly { account: string; date: string; debit: number | string; credit: number | string }[], k: string): { k: string; d: number; p: number; s: number; last: string } {
  const L = ledger.filter((l) => String(l.account) === k);
  const d = r2(L.reduce((a, l) => a + num(l.debit), 0)), p = r2(L.reduce((a, l) => a + num(l.credit), 0));
  return { k, d, p, s: r2(d - p), last: L.filter((l) => num(l.credit)).map((l) => l.date).sort().pop() || '' };
}
