/**
 * Анализа на работењето (interactive dashboard) — legacy `kdRange` 11562, `kdData` 11566, `kdMon` 14967,
 * `KD_EXP`, `VIEWS.klDash` 11588. Pure: the web layer passes documents, cash-register days, item sales and ledger lines.
 */

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const KD_PER = [['7', '7 дена'], ['30', '30 дена'], ['m', 'Овој месец'], ['pm', 'Минат месец'], ['q', 'Квартал'], ['ytd', 'Од почеток на год.'], ['y', 'Цела година'], ['c', 'Избери…']] as const;
export const KD_EXP: Record<string, string> = { 40: 'Материјали и енергија', 41: 'Услуги', 42: 'Плати', 43: 'Амортизација', 44: 'Останати трошоци', 45: 'Вредносно усогласување', 46: 'Останати расходи', 49: 'Други' };

/** Legacy `kdRange`: [from, to, label]; "today" is the end of the business year when it is not the current year. */
export function kdRange(p: string | undefined, year: number, today: string, custom?: { from?: string; to?: string }): [string, string, string] {
  const t = today.startsWith(String(year)) ? today : `${year}-12-31`;
  const d = new Date(t + 'T12:00:00Z');
  const Y = d.getUTCFullYear(), M = d.getUTCMonth();
  switch (p) {
    case 'm': return [t.slice(0, 8) + '01', t, 'Тековен месец'];
    case 'pm': return [ymd(new Date(Date.UTC(Y, M - 1, 1))), ymd(new Date(Date.UTC(Y, M, 0))), 'Претходен месец'];
    case 'q': return [ymd(new Date(Date.UTC(Y, Math.floor(M / 3) * 3, 1))), t, 'Тековен квартал'];
    case '7': return [ymd(new Date(d.getTime() - 6 * 864e5)), t, 'Последни 7 дена'];
    case '30': return [ymd(new Date(d.getTime() - 29 * 864e5)), t, 'Последни 30 дена'];
    case 'y': return [`${year}-01-01`, `${year}-12-31`, 'Цела година'];
    case 'c': {
      const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
      return [ok(custom?.from) ? custom!.from! : `${year}-01-01`, ok(custom?.to) ? custom!.to! : t, 'Избран период'];
    }
    default: return [`${year}-01-01`, t, 'Од почеток на годината'];
  }
}

export interface KdInput {
  invoices: readonly { date: string; total: number; partner: string }[];
  /** Cash register (каса) turnover per day. */
  kasa: readonly { date: string; total: number }[];
  purchases: readonly { date: string; total: number; partner: string }[];
  /** Goods sold (POS / invoices) valued at the selling price, and free-text invoice lines. */
  itemSales: readonly { date: string; key: string; name: string; unit: string; qty: number; value: number }[];
  ledger: readonly { date: string; account: string; debit: number; credit: number }[];
}

export interface KdDay { inv: number; kasa: number; pur: number; exp: number }
export interface KdData {
  days: Record<string, KdDay>;
  exp: Record<string, number>;
  cust: Record<string, number>;
  sup: Record<string, number>;
  items: Record<string, { n: string; q: number; v: number; u: string }>;
  sales: number; inv: number; kasa: number; pur: number; expT: number; cash: number; rec: number; pay: number; nInv: number; nPur: number;
}

/** Legacy `kdData`: turnover, purchases, class-4 costs (without 47/48) per day, rankings and balances at `to`. */
export function kdData(a: KdInput, from: string, to: string): KdData {
  const inR = (d: string) => d >= from && d <= to;
  const days: Record<string, KdDay> = {};
  const D = (d: string) => (days[d] ??= { inv: 0, kasa: 0, pur: 0, exp: 0 });
  const inv = a.invoices.filter((i) => inR(i.date));
  for (const i of inv) D(i.date).inv += i.total;
  for (const s of a.kasa) if (inR(s.date)) D(s.date).kasa += s.total;
  const pur = a.purchases.filter((p) => inR(p.date));
  for (const p of pur) D(p.date).pur += p.total;
  const exp: Record<string, number> = {};
  for (const l of a.ledger) {
    if (!inR(l.date)) continue;
    const k = String(l.account);
    if (/^4/.test(k) && !/^4[78]/.test(k)) { const g = k.slice(0, 2); const v = l.debit - l.credit; exp[g] = (exp[g] ?? 0) + v; D(l.date).exp += v; }
  }
  const bal = (pre: string) => r2(a.ledger.filter((l) => l.account.startsWith(pre) && l.date <= to).reduce((s, l) => s + l.debit - l.credit, 0));
  const cust: Record<string, number> = {};
  for (const i of inv) cust[i.partner || '—'] = (cust[i.partner || '—'] ?? 0) + i.total;
  const sup: Record<string, number> = {};
  for (const p of pur) sup[p.partner || '—'] = (sup[p.partner || '—'] ?? 0) + p.total;
  const items: KdData['items'] = {};
  for (const s of a.itemSales) {
    if (!inR(s.date)) continue;
    const o = (items[s.key] ??= { n: s.name, q: 0, v: 0, u: s.unit });
    o.q += s.qty; o.v += s.value;
  }
  const V = Object.values(days);
  return {
    days, exp, cust, sup, items,
    sales: r2(V.reduce((s, d) => s + d.inv + d.kasa, 0)), inv: r2(inv.reduce((s, i) => s + i.total, 0)), kasa: r2(V.reduce((s, d) => s + d.kasa, 0)),
    pur: r2(V.reduce((s, d) => s + d.pur, 0)), expT: r2(Object.values(exp).reduce((s, v) => s + v, 0)),
    cash: bal('10'), rec: bal('12'), pay: -bal('22'), nInv: inv.length, nPur: pur.length,
  };
}

/** Legacy `kdMon`: totals by month. */
export function kdMonths(R: Pick<KdData, 'days'>): [string, { s: number; p: number; e: number }][] {
  const B: Record<string, { s: number; p: number; e: number }> = {};
  for (const [d, v] of Object.entries(R.days)) { const o = (B[d.slice(0, 7)] ??= { s: 0, p: 0, e: 0 }); o.s += v.inv + v.kasa; o.p += v.pur; o.e += v.exp; }
  return Object.entries(B).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Chart buckets (legacy `kdChart`): by day up to 62 days, else by month; every bucket of the range is present. */
export function kdBuckets(R: Pick<KdData, 'days'>, from: string, to: string): { k: string; i: number; o: number; byMonth: boolean }[] {
  const nd = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const byMonth = nd > 62;
  const B: Record<string, { i: number; o: number }> = {};
  for (const [d, v] of Object.entries(R.days)) { const k = byMonth ? d.slice(0, 7) : d; const o = (B[k] ??= { i: 0, o: 0 }); o.i += v.inv + v.kasa; o.o += v.pur; }
  const keys: string[] = [];
  if (byMonth) {
    const d = new Date(from.slice(0, 7) + '-01T12:00:00Z');
    while (d.toISOString().slice(0, 7) <= to.slice(0, 7)) { keys.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  } else {
    for (const d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) keys.push(d.toISOString().slice(0, 10));
  }
  return keys.map((k) => ({ k, i: r2(B[k]?.i ?? 0), o: r2(B[k]?.o ?? 0), byMonth }));
}

/** Legacy `kdRank`: top 8 by value (|v| ≥ 0.5). */
export function kdRank(obj: Readonly<Record<string, number | { n: string; v: number; q?: number; u?: string }>>): { n: string; v: number; q?: number; u?: string }[] {
  return Object.entries(obj).map(([k, v]) => (typeof v === 'object' ? { n: v.n, v: v.v, q: v.q, u: v.u } : { n: k, v }))
    .filter((x) => Math.abs(x.v) >= 0.5).sort((a, b) => b.v - a.v).slice(0, 8);
}
