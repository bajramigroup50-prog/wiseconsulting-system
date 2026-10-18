/**
 * „Преглед на внес по месеци“ — what is entered for each month of a year, so nothing is forgotten or entered twice:
 * booked outgoing / incoming invoices (count, VAT), read invoices still not saved (ready / to check / held in a past VAT
 * period), journals imported from the old program (their output / input VAT), bank statements per account, and the
 * warnings of the month:
 * - `dupOut` / `dupIn`: the month has booked invoices AND an imported journal with output (input) VAT — the same
 *   invoices may be in the books twice (scanned / typed and imported);
 * - `scans`: read invoices of the month are not saved yet (ready, to check or held);
 * - `bankGap`: a bank account has statements before and after the month but none in it;
 * - `noSales`: an earlier month than the last month with sales has no outgoing invoices and no imported output VAT.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from './audit';
import { aiDocuments, bankAccounts, bankStatements, invoices, journalLines, journals, purchases, type Firm } from './schema/index';
import { loadVatPostingContext } from './vat-context';
import { vatAccountRoles } from './vat-source';

export interface EntryScans { ready: number; check: number; held: number }
export interface EntryMonth {
  /** 1–12 */
  m: number;
  sales: { n: number; vat: number; total: number };
  purchases: { n: number; vat: number; total: number };
  scanSales: EntryScans; scanPurchases: EntryScans;
  /** Journals imported from the old program dated in the month, with the VAT they carry (gross: output credit / input debit). */
  imported: { n: number; outVat: number; inVat: number };
  /** Bank statements per bank account id. */
  bank: Record<string, number>;
  warn: ('dupOut' | 'dupIn' | 'scans' | 'bankGap' | 'noSales')[];
}
export interface EntryOverview { year: number; accounts: { id: string; name: string }[]; months: EntryMonth[] }

const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
const num = (v: unknown) => Number(v ?? 0) || 0;

export async function entryOverview(tx: Tx, firm: Pick<Firm, 'id' | 'vatRegistered' | 'settings'>, year: number): Promise<EntryOverview> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const mOf = (d: unknown) => sql<number>`extract(month from ${d})::int`;
  const roles = vatAccountRoles(await loadVatPostingContext(tx, firm));
  const outK = [...roles].filter(([, r]) => r.kind === 'out').map(([k]) => k);
  const inK = [...roles].filter(([, r]) => r.kind !== 'out').map(([k]) => k);

  const [S, P, I, B, A, D] = await Promise.all([
    tx.select({ m: mOf(invoices.date), n: sql<number>`count(*)::int`, vat: sql<string>`coalesce(sum(case when ${invoices.kind} = 'credit' then -${invoices.vat} else ${invoices.vat} end), 0)::text`,
      total: sql<string>`coalesce(sum(case when ${invoices.kind} = 'credit' then -${invoices.total} else ${invoices.total} end), 0)::text` })
      .from(invoices).where(and(eq(invoices.firmId, firm.id), inArray(invoices.kind, ['invoice', 'credit']), sql`${invoices.status} <> 'draft'`, sql`${invoices.date} between ${from} and ${to}`))
      .groupBy(mOf(invoices.date)),
    tx.select({ m: mOf(purchases.date), n: sql<number>`count(*)::int`, vat: sql<string>`coalesce(sum(${purchases.vat}), 0)::text`, total: sql<string>`coalesce(sum(${purchases.total}), 0)::text` })
      .from(purchases).where(and(eq(purchases.firmId, firm.id), sql`${purchases.status} <> 'draft'`, sql`${purchases.date} between ${from} and ${to}`))
      .groupBy(mOf(purchases.date)),
    tx.select({
      m: mOf(journals.date), n: sql<number>`count(distinct ${journals.id})::int`,
      outVat: outK.length ? sql<string>`coalesce(sum(case when ${inArray(journalLines.account, outK)} then ${journalLines.credit} else 0 end), 0)::text` : sql<string>`'0'`,
      inVat: inK.length ? sql<string>`coalesce(sum(case when ${inArray(journalLines.account, inK)} then ${journalLines.debit} else 0 end), 0)::text` : sql<string>`'0'`,
    }).from(journals).innerJoin(journalLines, eq(journalLines.journalId, journals.id))
      .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'import'), sql`${journals.date} between ${from} and ${to}`))
      .groupBy(mOf(journals.date)),
    tx.select({ m: mOf(bankStatements.date), a: bankStatements.bankAccountId, n: sql<number>`count(*)::int` })
      .from(bankStatements).where(and(eq(bankStatements.firmId, firm.id), sql`${bankStatements.date} between ${from} and ${to}`))
      .groupBy(mOf(bankStatements.date), bankStatements.bankAccountId),
    tx.select({ id: bankAccounts.id, name: bankAccounts.name }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id)).orderBy(bankAccounts.name),
    // read invoices not saved (not skipped), by the invoice's own date
    tx.execute(sql`select ${aiDocuments.kind} as kind, coalesce(e->>'status', '') as st, extract(month from (coalesce(e->'draft'->>'docDate', e->'draft'->>'date'))::date)::int as m, count(*)::int as n
      from ${aiDocuments}, jsonb_array_elements(${aiDocuments.drafts}) e
      where ${aiDocuments.firmId} = ${firm.id} and ${aiDocuments.kind} in ('sale', 'purchase') and ${aiDocuments.status} in ('done', 'saved')
        and e->>'savedId' is null and coalesce((e->>'skipped')::boolean, false) = false
        and coalesce(e->'draft'->>'docDate', e->'draft'->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}'
        and coalesce(e->'draft'->>'docDate', e->'draft'->>'date') between ${from} and ${to}
      group by 1, 2, 3`),
  ]);

  const months: EntryMonth[] = Array.from({ length: 12 }, (_, i) => ({
    m: i + 1, sales: { n: 0, vat: 0, total: 0 }, purchases: { n: 0, vat: 0, total: 0 },
    scanSales: { ready: 0, check: 0, held: 0 }, scanPurchases: { ready: 0, check: 0, held: 0 },
    imported: { n: 0, outVat: 0, inVat: 0 }, bank: {}, warn: [],
  }));
  const at = (m: number) => months[m - 1]!;
  for (const r of S) at(r.m).sales = { n: r.n, vat: num(r.vat), total: num(r.total) };
  for (const r of P) at(r.m).purchases = { n: r.n, vat: num(r.vat), total: num(r.total) };
  for (const r of I) at(r.m).imported = { n: r.n, outVat: num(r.outVat), inVat: num(r.inVat) };
  for (const r of B) at(r.m).bank[r.a] = r.n;
  for (const r of rowsOf<{ kind: string; st: string; m: number; n: number }>(D)) {
    if (!(r.m >= 1 && r.m <= 12)) continue;
    const s = r.kind === 'sale' ? at(r.m).scanSales : at(r.m).scanPurchases;
    if (r.st === 'past') s.held += Number(r.n); else if (r.st === 'ok') s.ready += Number(r.n); else s.check += Number(r.n);
  }

  const hasSales = (x: EntryMonth) => x.sales.n > 0 || x.imported.outVat > 0;
  const lastSales = Math.max(0, ...months.filter(hasSales).map((x) => x.m));
  for (const x of months) {
    if (x.sales.vat > 0 && x.imported.outVat > 0) x.warn.push('dupOut');
    if (x.purchases.vat > 0 && x.imported.inVat > 0) x.warn.push('dupIn');
    const sc = (s: EntryScans) => s.ready + s.check + s.held;
    if (sc(x.scanSales) + sc(x.scanPurchases) > 0) x.warn.push('scans');
    if (A.some((a) => !x.bank[a.id] && months.some((y) => y.m < x.m && y.bank[a.id]) && months.some((y) => y.m > x.m && y.bank[a.id]))) x.warn.push('bankGap');
    if (x.m < lastSales && !hasSales(x)) x.warn.push('noSales');
  }
  return { year, accounts: A, months };
}
