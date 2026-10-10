import 'server-only';
/** Legacy `kdData` (11565): turnover by day, purchases, class-4 expenses, top customers / suppliers / items, balances. */
import { and, eq, ne, sql } from 'drizzle-orm';
import { items, invoices, purchases, salesDaily, stockMoves, stockSaleValues, toStockMove, type Firm } from '@wise/db';
import { acctDays, prefixBalance } from '@/lib/dash';
import { db } from '@/lib/db';
import { partnerNames } from '@/lib/firms-office';

export interface KdDay { inv: number; kasa: number; pur: number; exp: number }
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function kdData(firm: Firm, year: number, from: string, to: string) {
  const inR = sql`between ${from} and ${to}`;
  const [I, S, Pu, X, MV] = await Promise.all([
    db().select({ d: invoices.date, p: invoices.partnerId, v: sql<string>`${invoices.total} * ${invoices.fx}` }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), ne(invoices.status, 'pending'), sql`${invoices.date} ${inR}`)),
    db().select({ d: salesDaily.date, total: salesDaily.total, days: salesDaily.days }).from(salesDaily)
      .where(and(eq(salesDaily.firmId, firm.id), eq(salesDaily.pending, false), sql`(${salesDaily.date} ${inR} or ${salesDaily.days} is not null)`)),
    db().select({ d: purchases.date, p: purchases.partnerId, v: sql<string>`${purchases.total} * ${purchases.fx}` }).from(purchases)
      .where(and(eq(purchases.firmId, firm.id), ne(purchases.status, 'draft'), ne(purchases.status, 'pending'), sql`${purchases.date} ${inR}`)),
    acctDays(firm.id, from, to),
    db().select().from(stockMoves).where(and(eq(stockMoves.firmId, firm.id), eq(stockMoves.kind, 'sale'), eq(stockMoves.pending, false), sql`${stockMoves.date} ${inR}`)),
  ]);
  const days: Record<string, KdDay> = {};
  const D = (d: string) => (days[d] ??= { inv: 0, kasa: 0, pur: 0, exp: 0 });
  for (const i of I) D(i.d).inv += Number(i.v) || 0;
  for (const s of S) {
    if (Array.isArray(s.days) && s.days.length) { for (const d of s.days) if (d.date >= from && d.date <= to) D(d.date).kasa += +d.total || 0; continue; }
    if (s.d >= from && s.d <= to) D(s.d).kasa += Number(s.total) || 0;
  }
  for (const p of Pu) D(p.d).pur += Number(p.v) || 0;
  const exp: Record<string, number> = {};
  for (const l of X) {
    if (!/^4/.test(l.account) || /^4[78]/.test(l.account)) continue;
    const g = l.account.slice(0, 2), v = l.debit - l.credit;
    exp[g] = (exp[g] ?? 0) + v;
    D(l.date).exp += v;
  }
  const PN = await partnerNames(firm.id, [...I.map((x) => x.p), ...Pu.map((x) => x.p)]);
  const cust: Record<string, number> = {}, sup: Record<string, number> = {};
  for (const i of I) { const n = (i.p && PN.get(i.p)?.name) || '—'; cust[n] = (cust[n] ?? 0) + (Number(i.v) || 0); }
  for (const p of Pu) { const n = (p.p && PN.get(p.p)?.name) || '—'; sup[n] = (sup[n] ?? 0) + (Number(p.v) || 0); }
  // Top items: sold quantity × retail / sale price on the date (legacy `priceAt`).
  const top: Record<string, { n: string; q: number; v: number; u: string }> = {};
  if (MV.length) {
    const val = await stockSaleValues(db(), firm.id);
    const IT = new Map((await db().select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.firmId, firm.id))).map((x) => [x.id, x]));
    for (const m of MV) {
      const it = IT.get(m.itemId); if (!it) continue;
      const q = Math.abs(Number(m.qty)); const sv = val(toStockMove(m));
      const o = (top[it.id] ??= { n: it.name, q: 0, v: 0, u: it.unit ?? '' });
      o.q += q; o.v += typeof sv === 'number' ? Math.abs(sv) : Math.abs(Number(m.value));
    }
  }
  const sum = (k: keyof KdDay) => r2(Object.values(days).reduce((a, d) => a + d[k], 0));
  const [cash, rec, payB] = await Promise.all([prefixBalance(firm.id, '10', year, to), prefixBalance(firm.id, '12', year, to), prefixBalance(firm.id, '22', year, to)]);
  const inv = sum('inv'), kasa = sum('kasa');
  return { days, exp, cust, sup, items: top, sales: r2(inv + kasa), inv, kasa, pur: sum('pur'), expT: r2(Object.values(exp).reduce((a, v) => a + v, 0)), cash, rec, pay: -payB, nInv: I.length, nPur: Pu.length };
}

export type KdData = Awaited<ReturnType<typeof kdData>>;

/** Legacy `kdMon`: per month [ym, sales, purchases, expenses]. */
export function kdMon(R: KdData): [string, { s: number; p: number; e: number }][] {
  const B: Record<string, { s: number; p: number; e: number }> = {};
  for (const [d, v] of Object.entries(R.days)) { const o = (B[d.slice(0, 7)] ??= { s: 0, p: 0, e: 0 }); o.s += v.inv + v.kasa; o.p += v.pur; o.e += v.exp; }
  return Object.entries(B).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
