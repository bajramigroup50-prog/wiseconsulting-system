'use server';
/**
 * Fiscal device flow of the till (WISE desktop app, `window.wiseFiscal`):
 *   1. `posSellFiscalAction`  records the sale (stock, books, loyalty — the normal POS sale) and, in the same
 *      transaction, a `pending` fiscal receipt; returns the receipt to print;
 *   2. the page prints it on the device;
 *   3. `fiscalResultAction`   stores the device's answer: `ok` only with the device's receipt number, else `failed`
 *      with the error (the cashier can print again from the fiscal log).
 * Storno, Z / X reports and cash in / out are recorded after the device confirmed them (audit).
 */
import { inArray, and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { toFiscalReceipt, type FiscalReceipt } from '@wise/core/retail/fiscal';
import { StockDocError, createFiscalPending, createFiscalStorno, getFiscalLog, items as itemsTable, posSaleWithLoyalty, recordFiscalReport, recordFiscalResult } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { stockAction, todayIso } from '@/lib/stock';

const PATHS = ['/kasa', '/lojalnost', '/restoran', '/kujna'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.');
const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/\s/g, '').replace(',', '.'))).refine(Number.isFinite, 'Неважечки број.');
const numOpt = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(String(v).replace(/\s/g, '').replace(',', '.'))))
  .refine((v) => v == null || Number.isFinite(v), 'Неважечки број.');
const uuid = z.string().uuid('Неважечки запис.');

const SaleIn = z.object({
  date, wh: z.string().max(40).nullish(), card: numOpt,
  cart: z.array(z.object({ itemId: z.string().uuid(), qty: num, price: num, rate: numOpt })).min(1, 'Додадете барем еден артикл.').max(99, 'Најмногу 99 ставки во една фискална сметка.'),
  cardNo: z.string().max(60).nullish(), coupon: z.string().max(60).nullish(), usePts: z.boolean().optional(), order: z.string().uuid().nullish(),
});

/** Device answer as it comes from the page (validated again by recordFiscalResult / fiscalConfirmed). */
const ResultIn = z.object({
  ok: z.boolean(), number: z.string().max(40).optional(), time: z.string().max(40).optional(), total: z.number().optional(),
  code: z.string().max(40).optional(), error: z.string().max(400).optional(), cashSum: z.number().optional(),
  device: z.object({ vendor: z.string().max(40).optional(), model: z.string().max(60).optional(), driver: z.string().max(20).optional() }).nullish(),
}).passthrough();

const parse = <T extends z.ZodType>(s: T, v: unknown): z.infer<T> | { error: string } => {
  const p = s.safeParse(v);
  return p.success ? p.data : { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
};
const bad = (x: unknown): x is { error: string } => !!x && typeof x === 'object' && 'error' in x && typeof (x as { error: unknown }).error === 'string' && !('ok' in x);

export type FiscalSaleState = ActionState & { fiskId?: string; receipt?: FiscalReceipt; pay?: number; storno?: boolean };

/** POS sale + pending fiscal receipt (one transaction). The page then prints `receipt` and reports the result. */
export async function posSellFiscalAction(input: unknown): Promise<FiscalSaleState> {
  const v = parse(SaleIn, input);
  if (bad(v)) return v;
  const st = await stockAction('posSell', PATHS, async (tx, a) => {
    const sale = await posSaleWithLoyalty(tx, a, { ...v, orderId: v.order ?? null });
    const ids = [...new Set(v.cart.map((c) => c.itemId))];
    const names = new Map((await tx.select({ id: itemsTable.id, name: itemsTable.name }).from(itemsTable)
      .where(and(eq(itemsTable.firmId, a.firmId), inArray(itemsTable.id, ids)))).map((r) => [r.id, r.name ?? '']));
    let receipt: FiscalReceipt;
    try {
      receipt = toFiscalReceipt(v.cart.map((c) => ({ name: names.get(c.itemId) ?? 'Артикл', qty: c.qty, price: c.price, rate: Number(c.rate ?? 18) })),
        { discount: sale.disc, card: v.card ? Math.min(sale.pay, v.card) : 0 });
    } catch (e) { throw new StockDocError(e instanceof Error ? e.message : 'Неважечка сметка.'); }
    const fiskId = await createFiscalPending(tx, a, { kind: 'sale', date: v.date, wh: v.wh ?? null, salesDayId: sale.id, receipt });
    return { fiskId, receipt, pay: sale.pay };
  });
  if (st.error) return { error: st.error };
  return { ok: 'Продажбата е евидентирана. Се печати фискалната сметка…', ...st.data! };
}

/** The device's answer for a sale / storno receipt. */
export async function fiscalResultAction(fiskId: string, result: unknown): Promise<ActionState & { number?: string | null }> {
  const id = parse(uuid, fiskId);
  if (bad(id)) return id;
  const r = parse(ResultIn, result);
  if (bad(r)) return r;
  const st = await stockAction('posSell', PATHS, (tx, a) => recordFiscalResult(tx, a, id, r));
  if (st.error) return { error: st.error };
  const d = st.data!;
  return d.status === 'ok'
    ? { ok: `🧾 Фискалната сметка е испечатена — бр. ${d.number}.`, number: d.number }
    : { error: `Фискалната сметка НЕ е испечатена: ${r.error || 'апаратот не ја потврди'}. Продажбата е евидентирана — печатете повторно од „Фискални сметки“.` };
}

/** Storno receipt of a fiscalised sale: returns the receipt to print (then `fiscalResultAction`). */
export async function fiscalStornoAction(origId: string): Promise<FiscalSaleState> {
  const id = parse(uuid, origId);
  if (bad(id)) return id;
  const st = await stockAction('posSell', PATHS, (tx, a) => createFiscalStorno(tx, a, id, todayIso()));
  if (st.error) return { error: st.error };
  return { ok: 'Се печати сторно сметката…', fiskId: st.data!.id, receipt: st.data!.receipt };
}

/** Pending / failed receipt printed again: the stored receipt (the sale itself is not booked twice). */
export async function fiscalReprintAction(fiskId: string): Promise<FiscalSaleState> {
  const id = parse(uuid, fiskId);
  if (bad(id)) return id;
  const st = await stockAction('posSell', [], async (tx, a) => {
    const row = await getFiscalLog(tx, a.firmId, id);
    if (!row || (row.data.kind !== 'sale' && row.data.kind !== 'storno') || !row.data.receipt) throw new StockDocError('Записот не постои.');
    if (row.status === 'ok') throw new StockDocError(`Сметката е веќе фискализирана (бр. ${row.number}).`);
    return { receipt: row.data.receipt, storno: row.data.kind === 'storno' };
  });
  if (st.error) return { error: st.error };
  return { ok: 'Се печати…', fiskId: id, receipt: st.data!.receipt, storno: st.data!.storno };
}

const ReportIn = z.object({ kind: z.enum(['z', 'x', 'cashIn', 'cashOut']), wh: z.string().max(40).nullish(), amount: numOpt, result: ResultIn });

/** Z / X report or cash in / out the device confirmed. */
export async function fiscalReportAction(input: unknown): Promise<ActionState> {
  const v = parse(ReportIn, input);
  if (bad(v)) return v;
  const st = await stockAction('posSell', PATHS, (tx, a) => recordFiscalReport(tx, a, { kind: v.kind, date: todayIso(), wh: v.wh ?? null, result: v.result, amount: v.amount }));
  if (st.error) return { error: st.error };
  const label = { z: `Z дневен извештај бр. ${v.result.number ?? ''}`, x: 'X извештај', cashIn: 'Внесени пари во касата', cashOut: 'Извадени пари од касата' }[v.kind];
  return { ok: `${label} — потврдено од апаратот и евидентирано.` };
}
