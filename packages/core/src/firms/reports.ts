/**
 * „📊 Извештаи“ — the reports that did not exist yet (pure, amounts in denars):
 * - {@link agingByPartner}: Старосна структура – open invoices / purchases per partner by days overdue;
 * - {@link liabilitiesByMonth}: Обврски кон УЈП и фондови – per liability konto and month: пресметано (П), платено (Д), салдо;
 * - {@link pnlByMonth}: Биланс на успех по месеци – приходи / расходи (по групи) / резултат for the 12 months and the year before.
 */
import { EXPG, isExp, isRev, type AcctMonth } from './dash';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

/* ---------------- Старосна структура ---------------- */

/** Buckets by days overdue (due date, or the document date when it has none). */
export const AGE_BUCKETS = ['Во рок', '1–30', '31–60', '61–90', 'над 90'] as const;
export const ageBucket = (daysLate: number): number => (daysLate <= 0 ? 0 : daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : daysLate <= 90 ? 3 : 4);

export interface AgingDoc { partnerId: string | null; number?: string | null; date: string; due: string | null; total: number; paid: number }
export interface AgingRow { partnerId: string; b: number[]; total: number; docs: number; oldest: number }

/** Open amounts (total − paid, in cents as the loaders give them) per partner and bucket on `today`; biggest debt first. */
export function agingByPartner(D: readonly AgingDoc[], today: string): { rows: AgingRow[]; tot: number[]; total: number } {
  const M = new Map<string, AgingRow>();
  const tot = AGE_BUCKETS.map(() => 0);
  for (const d of D) {
    const open = (d.total - d.paid) / 100;
    if (open <= 0.004) continue;
    const late = dayNo(today) - dayNo(d.due || d.date);
    const k = ageBucket(late);
    const p = d.partnerId ?? '';
    const r = M.get(p) ?? { partnerId: p, b: AGE_BUCKETS.map(() => 0), total: 0, docs: 0, oldest: 0 };
    r.b[k] = r2(r.b[k]! + open); r.total = r2(r.total + open); r.docs++; r.oldest = Math.max(r.oldest, late);
    tot[k] = r2(tot[k]! + open);
    M.set(p, r);
  }
  const rows = [...M.values()].sort((a, b) => b.total - a.total);
  return { rows, tot, total: r2(tot.reduce((a, b) => a + b, 0)) };
}

/* ---------------- Обврски кон УЈП и фондови ---------------- */

/** The liability kontos of the report: payroll (as the payroll scheme books them) and VAT. */
export const LIAB_KONTA: readonly (readonly [string, string])[] = [
  ['2340', 'Персонален данок од плата'], ['2341', 'Придонес ПИО'], ['2342', 'Придонес здравство'], ['2343', 'Дополнителен придонес'],
  ['2344', 'Придонес вработување'], ['2349', 'Останати придонеси (збирно)'], ['2401', 'Нето плати'], ['23008', 'ДДВ за плаќање'],
];

export interface LiabRow { k: string; name: string; calc: number[]; paid: number[]; saldo: number[]; calcY: number; paidY: number }

/**
 * Per konto: пресметано (Побарува) and платено (Должи) in each month, the running saldo (П − Д, + = still owed) at the
 * end of each month. Kontos without any movement in the year are left out. `konta` = [konto, name] (a konto matches
 * its analytics too: 2340 → 23400…).
 */
export function liabilitiesByMonth(L: readonly AcctMonth[], konta: readonly (readonly [string, string])[] = LIAB_KONTA): LiabRow[] {
  const out: LiabRow[] = [];
  const longest = (acc: string) => konta.filter(([k]) => acc.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[0];
  for (const [k, name] of konta) {
    const calc = Array<number>(12).fill(0), paid = Array<number>(12).fill(0);
    let any = false;
    for (const l of L) {
      if (longest(l.account) !== k || l.month < 1 || l.month > 12) continue;
      calc[l.month - 1] = r2(calc[l.month - 1]! + l.credit); paid[l.month - 1] = r2(paid[l.month - 1]! + l.debit); any = true;
    }
    if (!any) continue;
    let s = 0;
    const saldo = calc.map((c, i) => (s = r2(s + c - paid[i]!)));
    out.push({ k, name, calc, paid, saldo, calcY: r2(calc.reduce((a, b) => a + b, 0)), paidY: r2(paid.reduce((a, b) => a + b, 0)) });
  }
  return out;
}

/* ---------------- Биланс на успех по месеци ---------------- */

export interface PnlLine { key: string; label: string; m: number[]; y: number; py: number; kind: 'rev' | 'exp' | 'res' }

/** Приходи, the expense groups (40…, 41…, 70… – `EXPG`) and Резултат per month, the year and the year before. */
export function pnlByMonth(L: readonly AcctMonth[], LP: readonly AcctMonth[] = []): PnlLine[] {
  const sum = (A: readonly AcctMonth[], f: (a: AcctMonth) => number | null) => {
    const m = Array<number>(12).fill(0);
    for (const a of A) { const v = f(a); if (v != null && a.month >= 1 && a.month <= 12) m[a.month - 1] = r2(m[a.month - 1]! + v); }
    return m;
  };
  const tot = (m: number[]) => r2(m.reduce((a, b) => a + b, 0));
  const revF = (a: AcctMonth) => (isRev(a.account) ? a.credit - a.debit : null);
  const rev = sum(L, revF), revP = sum(LP, revF);
  const groups = [...new Set([...L, ...LP].filter((a) => isExp(a.account)).map((a) => a.account.slice(0, 2)))].sort();
  const exp: PnlLine[] = groups.map((g) => {
    const f = (a: AcctMonth) => (isExp(a.account) && a.account.startsWith(g) ? a.debit - a.credit : null);
    const m = sum(L, f);
    return { key: 'e' + g, label: `${g} ${EXPG[g] ?? 'Расходи'}`, m, y: tot(m), py: tot(sum(LP, f)), kind: 'exp' as const };
  }).filter((e) => e.y || e.py);
  const expM = Array.from({ length: 12 }, (_, i) => r2(exp.reduce((s, e) => s + e.m[i]!, 0)));
  const expPY = r2(exp.reduce((s, e) => s + e.py, 0));
  const res = rev.map((v, i) => r2(v - expM[i]!));
  return [
    { key: 'rev', label: 'Приходи', m: rev, y: tot(rev), py: tot(revP), kind: 'rev' },
    ...exp,
    { key: 'exp', label: 'Вкупно расходи', m: expM, y: tot(expM), py: expPY, kind: 'exp' },
    { key: 'res', label: 'Резултат (добивка / загуба)', m: res, y: tot(res), py: r2(tot(revP) - expPY), kind: 'res' },
  ];
}
