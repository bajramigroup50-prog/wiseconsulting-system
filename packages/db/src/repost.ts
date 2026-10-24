/**
 * Legacy `ACT.schRepost` („Прекнижи ги сега“ / „Прекнижи ја {year} според шемите“): every purchase, invoice, daily
 * turnover, cash voucher, supplier credit and (unlocked) payroll run of the year is booked again with the current posting schemes, through each
 * document's own posting service. Documents in a locked period (firm lock date / closed VAT period / locked payroll
 * month) are skipped and counted, like legacy `_lockSkip`. Each document runs in its own savepoint.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { scrEntries } from '@wise/core';
import { VAT_SUMMARY_ACCOUNTS, oldVatDocCount } from '@wise/core/repost';
import { audit, type Tx } from './audit';
import { postJournal, PostingError } from './posting';
import { PayrollError, postRun } from './payroll';
import { loadRegisters, postVoucher } from './bank/cash';
import { cashVouchers, invoices, journalLines, journals, payrollRuns, purchases, salesDaily, firms, supplierCreditLines, supplierCredits, type Firm } from './schema/index';
import { firmPostingContext, stockLocations } from './sales/context';
import { repostInvoice } from './sales/invoices';
import { repostPurchase } from './sales/purchases';
import { repostSalesDay } from './stock-docs';

export interface RepostResult { n: number; locked: number; failed: number; errors: string[] }

/** Legacy `oldVatDocs()`: documents of the year still booked with VAT on a summary konto. */
export async function oldVatDocs(tx: Tx, firmId: string, year: number): Promise<number> {
  const L = await tx.select({ sourceType: journals.sourceType, sourceId: journals.sourceId, account: journalLines.account })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journals.firmId, firmId), gte(journals.date, `${year}-01-01`), lte(journals.date, `${year}-12-31`),
      inArray(journalLines.account, [...VAT_SUMMARY_ACCOUNTS]), inArray(journals.sourceType, ['invoice', 'purchase', 'sales_daily'])));
  return oldVatDocCount(L);
}

/** Re-post a supplier return / credit (journal only, from its stored lines; the stock moves stay). */
export async function repostSupplierCredit(tx: Tx, f: Firm, id: string, userId: string | null): Promise<void> {
  const [d] = await tx.select().from(supplierCredits).where(and(eq(supplierCredits.id, id), eq(supplierCredits.firmId, f.id))).limit(1);
  if (!d || d.status !== 'posted') return;
  const rows = await tx.select().from(supplierCreditLines).where(eq(supplierCreditLines.creditId, id)).orderBy(asc(supplierCreditLines.lineNo));
  const [pur] = d.refPurchaseId ? await tx.select({ imp: purchases.imp, supKonto: purchases.supplierAccount }).from(purchases).where(eq(purchases.id, d.refPurchaseId)).limit(1) : [];
  const loc = d.warehouseId ? (await stockLocations(tx, f.id)).find((l) => l.id === d.warehouseId) : undefined;
  const ctx = await firmPostingContext(tx, f);
  const lines = scrEntries({ id, kind: d.kind, date: d.date, number: d.number, partner: d.partnerId, wh: d.warehouseId ?? undefined,
    refPurchase: pur ? { imp: pur.imp, supKonto: pur.supKonto ?? undefined } : null,
    rows: rows.map((r) => ({ item: r.itemId ?? undefined, name: r.name, qty: Number(r.qty), price: Number(r.price), rate: r.rate, konto: r.account || undefined })) },
  ctx, loc ? { kind: loc.kind, konto: loc.konto, kMarg: loc.kMarg, kVat: loc.kVat } : null);
  await postJournal(tx, {
    firmId: f.id, date: d.date, kind: 'povrat', sourceType: 'supplier_credit', sourceId: id, userId,
    description: (d.kind === 'ret' ? 'Повратница до добавувач ' : 'Одобрение од добавувач ') + d.number,
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: l.note ?? null, doc: d.supNo || d.number })),
    auditAction: 'postSupplierCredit',
  });
}

/** A locked period / closed VAT period / locked payroll (skipped and counted, not a failure). */
export const isRepostLock = (e: unknown) => (e instanceof PostingError && (e.code === 'locked' || e.code === 'vat_closed')) || (e instanceof PayrollError && e.code === 'locked');

export async function repostYear(tx: Tx, a: { firmId: string; userId: string | null }, year: number): Promise<RepostResult> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const yr = <T extends { date: unknown }>(c: T) => [gte(c.date as never, from), lte(c.date as never, to)];
  const [P, I, Z, Y, C, S, REG] = await Promise.all([
    tx.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.firmId, f.id), eq(purchases.status, 'posted'), ...yr(purchases))).orderBy(purchases.date),
    tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.firmId, f.id), eq(invoices.status, 'posted'), ...yr(invoices))).orderBy(invoices.date),
    tx.select({ id: salesDaily.id }).from(salesDaily).where(and(eq(salesDaily.firmId, f.id), eq(salesDaily.pending, false), ...yr(salesDaily))).orderBy(salesDaily.date),
    tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), eq(payrollRuns.status, 'posted'), eq(payrollRuns.locked, false), ...yr(payrollRuns))).orderBy(payrollRuns.date),
    tx.select().from(cashVouchers).where(and(eq(cashVouchers.firmId, f.id), ...yr(cashVouchers))).orderBy(cashVouchers.date),
    tx.select({ id: supplierCredits.id }).from(supplierCredits).where(and(eq(supplierCredits.firmId, f.id), eq(supplierCredits.status, 'posted'), ...yr(supplierCredits))).orderBy(supplierCredits.date),
    loadRegisters(tx, f.id),
  ]);
  const R: RepostResult = { n: 0, locked: 0, failed: 0, errors: [] };
  const one = async (run: (sp: Tx) => Promise<unknown>) => {
    try { await tx.transaction(async (sp) => { await run(sp as unknown as Tx); }); R.n++; } catch (e) {
      if (isRepostLock(e)) R.locked++;
      else { R.failed++; if (R.errors.length < 5) R.errors.push(e instanceof Error ? e.message : String(e)); }
    }
  };
  for (const x of P) await one((sp) => repostPurchase(sp, f, x.id, a.userId));
  for (const x of I) await one((sp) => repostInvoice(sp, f, x.id, a.userId));
  for (const x of Z) await one((sp) => repostSalesDay(sp, { firmId: f.id, userId: a.userId }, x.id));
  for (const v of C) {
    const reg = REG.find((r) => r.id === v.registerId);
    if (reg) await one((sp) => postVoucher(sp, v, reg, a.userId));
  }
  for (const x of S) await one((sp) => repostSupplierCredit(sp, f, x.id, a.userId));
  for (const x of Y) await one((sp) => postRun(sp, { firmId: f.id, runId: x.id, userId: a.userId }));
  await audit(tx, { userId: a.userId, firmId: f.id, action: 'schRepost', data: { year, ...R } });
  return R;
}
