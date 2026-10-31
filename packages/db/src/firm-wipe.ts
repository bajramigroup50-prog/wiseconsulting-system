/**
 * „🗑 Избриши ги сите документи и книжења за годината“ – every bookkeeping document and posting of ONE firm in ONE year:
 * налози, излезни / влезни фактури, одобренија, изводи, благајна, компензации, платни налози, плати, залиха и малопродажба,
 * ДДВ периоди, амортизација, завршна сметка, скенирани документи. The firm itself, its bank accounts, settings,
 * the other years and the office records (contracts, fee invoices, mail, audit log) stay. Partners and items that are
 * used nowhere afterwards are deleted too.
 *
 * Order: the tables are deleted by retrying a table that fails on a foreign key (each attempt in a savepoint), as the
 * demo reset does; a row of another year that still points into this year (a credit note of next year…) stops it and
 * NOTHING is deleted (one transaction). A locked period is refused.
 */
import { and, eq, sql } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { firms, items, partners } from './schema/index';

/** [table, how its rows belong to the year]. */
const YEAR_TABLES: readonly (readonly [string, 'date' | 'year' | 'month' | 'from' | 'created'])[] = [
  ['supplier_credits', 'date'], ['invoices', 'date'], ['transfers', 'date'], ['purchases', 'date'], ['levelling_docs', 'date'], ['stock_counts', 'date'],
  ['store_outs', 'date'], ['sales_daily', 'date'], ['production_orders', 'date'], ['writeoff_docs', 'date'], ['stock_moves', 'date'],
  ['cash_vouchers', 'date'], ['compensations', 'date'], ['payment_orders', 'date'], ['bank_statements', 'date'], ['pdd_payments', 'date'],
  ['customer_orders', 'date'], ['supplier_orders', 'date'], ['payroll_runs', 'month'], ['mpin_inbox', 'created'], ['depreciation_runs', 'year'],
  ['year_closings', 'year'], ['annual_statements', 'year'], ['vat_periods', 'from'], ['journals', 'date'], ['ai_documents', 'created'],
];

/** Label of each table for the summary. */
export const WIPE_LABELS: Readonly<Record<string, string>> = {
  journals: 'налози', invoices: 'излезни фактури / профактури / испратници', purchases: 'влезни фактури и калкулации', supplier_credits: 'одобренија од добавувачи',
  bank_statements: 'изводи', cash_vouchers: 'благајнички налози', compensations: 'компензации', payment_orders: 'платни налози', payroll_runs: 'плати',
  stock_moves: 'движења на залиха', sales_daily: 'дневен промет / фискални', transfers: 'преноси', levelling_docs: 'нивелации', stock_counts: 'пописи',
  store_outs: 'излез од продавница', production_orders: 'производство', writeoff_docs: 'отпис', pdd_payments: 'исплати ПДД', customer_orders: 'нарачки од купувачи',
  supplier_orders: 'нарачки до добавувачи', mpin_inbox: 'МПИН', depreciation_runs: 'амортизација', year_closings: 'затворање на годината',
  annual_statements: 'завршна сметка', vat_periods: 'ДДВ периоди', ai_documents: 'скенирани документи',
};

const cond = (how: (typeof YEAR_TABLES)[number][1], y: number) => {
  const a = `${y}-01-01`, b = `${y}-12-31`;
  switch (how) {
    case 'date': return sql`"date" between ${a} and ${b}`;
    case 'year': return sql`"year" = ${y}`;
    case 'month': return sql`"month" like ${y + '-%'}`;
    case 'from': return sql`"date_from" between ${a} and ${b}`;
    default: return sql`(created_at at time zone 'Europe/Skopje') between ${a} and ${b + ' 23:59:59.999'}`;
  }
};

/** Rows of the year per table (the confirmation shows them before anything is deleted). */
export async function firmYearWipePlan(tx: Tx, firmId: string, year: number): Promise<{ counts: Record<string, number>; total: number; locked: string | null }> {
  const [f] = await tx.select({ lockDate: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const counts: Record<string, number> = {};
  for (const [t, how] of YEAR_TABLES) {
    const R = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where firm_id = ${firmId} and ${cond(how, year)}`);
    const n = Number(((R as unknown as { rows?: { n: number }[] }).rows ?? (R as unknown as { n: number }[]))[0]?.n ?? 0);
    if (n) counts[t] = n;
  }
  const locked = f?.lockDate && f.lockDate >= `${year}-01-01` ? f.lockDate : null;
  return { counts, total: Object.values(counts).reduce((s, n) => s + n, 0), locked };
}

export class FirmWipeError extends Error {}

/** Delete them (see the file comment). Run inside a transaction. */
export async function wipeFirmYear(tx: Tx, a: { firmId: string; year: number; userId: string | null }): Promise<{ deleted: Record<string, number>; partners: number; items: number }> {
  const plan = await firmYearWipePlan(tx, a.firmId, a.year);
  if (plan.locked) throw new FirmWipeError(`Периодот е заклучен до ${plan.locked.split('-').reverse().join('.')} – прво отклучете ја годината.`);
  const deleted: Record<string, number> = {};
  let todo = YEAR_TABLES.filter(([t]) => plan.counts[t]);
  let lastErr: unknown = null;
  while (todo.length) {
    const failed: typeof todo = [];
    for (const [t, how] of todo) {
      try {
        const n = await tx.transaction(async (sp) => {
          const R = await sp.execute(sql`delete from ${sql.identifier(t)} where firm_id = ${a.firmId} and ${cond(how, a.year)}`);
          return Number((R as unknown as { rowCount?: number; affectedRows?: number }).rowCount ?? (R as unknown as { affectedRows?: number }).affectedRows ?? 0);
        });
        if (n) deleted[t] = (deleted[t] ?? 0) + n;
      } catch (e) { failed.push([t, how]); lastErr = e; }
    }
    if (failed.length === todo.length) {
      const cause = (lastErr as { cause?: { message?: string; detail?: string } })?.cause;
      throw new FirmWipeError(`Не може да се избрише (${failed.map(([t]) => WIPE_LABELS[t] ?? t).join(', ')}): документ од друга година е поврзан со оваа (на пр. одобрение или плаќање во ${a.year + 1}). ${cause?.detail ?? cause?.message ?? ''} Ништо не е избришано.`);
    }
    todo = failed;
  }
  // corrections of journals that no longer exist
  await tx.execute(sql`delete from journal_overrides o where o.firm_id = ${a.firmId}
    and not exists (select 1 from journals j where j.firm_id = o.firm_id and j.source_type = o.source_type and j.source_id = o.source_id)`);
  // partners and items used nowhere any more (each in a savepoint: a used one stays)
  let np = 0, ni = 0;
  for (const p of await tx.select({ id: partners.id }).from(partners).where(eq(partners.firmId, a.firmId))) {
    try { await tx.transaction(async (sp) => { np += (await sp.delete(partners).where(and(eq(partners.firmId, a.firmId), eq(partners.id, p.id))).returning({ id: partners.id })).length; }); } catch { /* still used */ }
  }
  for (const it of await tx.select({ id: items.id }).from(items).where(eq(items.firmId, a.firmId))) {
    try { await tx.transaction(async (sp) => { ni += (await sp.delete(items).where(and(eq(items.firmId, a.firmId), eq(items.id, it.id))).returning({ id: items.id })).length; }); } catch { /* still used */ }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'firmYearWipe', entityType: 'firm', entityId: a.firmId, data: { year: a.year, deleted, partners: np, items: ni } });
  return { deleted, partners: np, items: ni };
}
