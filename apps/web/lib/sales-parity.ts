import 'server-only';
/**
 * Server helpers added for the legacy-parity pass of Sales & purchases (fuel VAT rule, fuel-seller banner data).
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { fuelRule, type FuelRule } from '@wise/core/law';
import { fuelBannerData, isFuel } from '@wise/core/sales';
import { items, type Firm } from '@wise/db';
import { db } from './db';
import { loadLaw } from './law';

/** Fuel VAT rule from the law feed (legacy `fuelRule` 14353), or null. */
export async function fuelRuleNow(): Promise<FuelRule | null> {
  try { return fuelRule(await loadLaw()); } catch { return null; }
}

/** Data for the „⛽ Оваа фирма продава гориво“ banner (legacy `fuelBanner` 14368). */
export async function fuelBannerFor(firm: Firm) {
  const R = await fuelRuleNow();
  if (!R) return null;
  const I = (await db().select({ id: items.id, name: items.name, rate: items.vatRate }).from(items)
    .where(and(eq(items.firmId, firm.id), ne(items.type, 'service'), eq(items.active, true)))).filter((i) => isFuel(i.name));
  const seller = !!((firm.settings ?? {}) as Record<string, unknown>).fuelSeller;
  const b = fuelBannerData(R, new Date().toISOString().slice(0, 10), seller, I);
  return b ? { ...b, ids: I.filter((i) => i.rate !== b.rate).map((i) => i.id), names: I.filter((i) => i.rate !== b.rate).map((i) => `${i.name} (${i.rate}%)`) } : null;
}

/* ---------- legacy `usedIn` / `usedList` (3289–3291): where a partner / item is used, counted in documents ---------- */

/** `execute` results: postgres-js returns the rows array, PGlite / node-postgres `{ rows }`. */
const rowsOf = <T,>(R: unknown): T[] => ((R as { rows?: T[] }).rows ?? (R as T[]));

export interface UseRow { kind: string; number: string; date: string; total: number | null }

/** Documents per partner (invoices, purchases, supplier returns, journals with a line on the partner). */
export async function partnerUsage(firmId: string): Promise<Map<string, number>> {
  const R = await db().execute<{ id: string; n: number }>(sql`
    select id, sum(n)::int as n from (
      select partner_id as id, count(*) as n from invoices where firm_id = ${firmId} and partner_id is not null group by partner_id
      union all select partner_id, count(*) from purchases where firm_id = ${firmId} and partner_id is not null group by partner_id
      union all select partner_id, count(*) from supplier_credits where firm_id = ${firmId} and partner_id is not null group by partner_id
      union all select jl.partner_id, count(distinct jl.journal_id) from journal_lines jl join journals j on j.id = jl.journal_id
        where jl.firm_id = ${firmId} and jl.partner_id is not null and coalesce(j.source_type, '') not in ('invoice', 'purchase', 'supplier_credit') group by jl.partner_id
    ) x group by id`);
  return new Map(rowsOf<{ id: string; n: number }>(R).map((r) => [r.id, Number(r.n)]));
}

/** Documents per item (invoice lines, purchase receipts, stock moves of other documents). */
export async function itemUsage(firmId: string): Promise<Map<string, number>> {
  const R = await db().execute<{ id: string; n: number }>(sql`
    select id, sum(n)::int as n from (
      select il.item_id as id, count(distinct il.invoice_id) as n from invoice_lines il join invoices i on i.id = il.invoice_id where i.firm_id = ${firmId} and il.item_id is not null group by il.item_id
      union all select sl.item_id, count(distinct sl.purchase_id) from purchase_stock_lines sl join purchases p on p.id = sl.purchase_id where p.firm_id = ${firmId} group by sl.item_id
      union all select item_id, count(distinct (source_type, source_id)) from stock_moves where firm_id = ${firmId} and source_type not in ('invoice', 'purchase', 'dispatch', 'credit') group by item_id
    ) x group by id`);
  return new Map(rowsOf<{ id: string; n: number }>(R).map((r) => [r.id, Number(r.n)]));
}

/** The documents that use a partner or an item (legacy `useShow` card: Вид · Број · Датум · Износ). */
export async function usedList(firmId: string, what: 'partner' | 'item', id: string): Promise<UseRow[]> {
  const R = what === 'partner'
    ? await db().execute<{ kind: string; number: string; date: string; total: string | null }>(sql`
      select case kind when 'credit' then 'Одобрение' when 'proforma' then 'Профактура' when 'dispatch' then 'Испратница' else 'Излезна фактура' end as kind, number, date::text, total::text from invoices where firm_id = ${firmId} and partner_id = ${id}
      union all select 'Влезна фактура', number, date::text, total::text from purchases where firm_id = ${firmId} and partner_id = ${id}
      union all select 'Повратница до добавувач', number, date::text, null from supplier_credits where firm_id = ${firmId} and partner_id = ${id}
      union all select distinct 'Налог', j.number, j.date::text, null from journal_lines jl join journals j on j.id = jl.journal_id
        where jl.firm_id = ${firmId} and jl.partner_id = ${id} and coalesce(j.source_type, '') not in ('invoice', 'purchase', 'supplier_credit')
      order by 3 desc limit 300`)
    : await db().execute<{ kind: string; number: string; date: string; total: string | null }>(sql`
      select distinct case i.kind when 'credit' then 'Одобрение' when 'proforma' then 'Профактура' when 'dispatch' then 'Испратница' else 'Излезна фактура' end as kind, i.number, i.date::text, i.total::text
        from invoice_lines il join invoices i on i.id = il.invoice_id where i.firm_id = ${firmId} and il.item_id = ${id}
      union all select distinct 'Влезна фактура', p.number, p.date::text, p.total::text from purchase_stock_lines sl join purchases p on p.id = sl.purchase_id where p.firm_id = ${firmId} and sl.item_id = ${id}
      union all select distinct 'Залиха', coalesce(label, source_type), date::text, null from stock_moves where firm_id = ${firmId} and item_id = ${id} and source_type not in ('invoice', 'purchase', 'dispatch', 'credit')
      order by 3 desc limit 300`);
  return rowsOf<{ kind: string; number: string; date: string; total: string | null }>(R).map((r) => ({ kind: r.kind, number: r.number ?? '', date: r.date, total: r.total == null ? null : Number(r.total) }));
}
