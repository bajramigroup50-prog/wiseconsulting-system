/**
 * Production from a sales invoice („Производство = Да“ → „Репроматеријали за производство“; new — legacy had only a
 * free „Трошоци за производство“ field). In the invoice's transaction, before the invoice issues the product:
 * one production order per produced line (dated the invoice date, numbered like the production screen), the
 * materials issued at average cost from the materials warehouse and the product received at the materials cost
 * (+ the line's share of the extra costs) into the invoice's warehouse, through the existing production engine
 * (`runProduction`) and `replaceSourceMoves` (stock journal with the production scheme: D prodWip / C stock,
 * D product / C prodWip). The link lives in `invoices.data.prodRun` (orders) and in the order's note.
 */
import { and, eq } from 'drizzle-orm';
import { nextYearNumber, productionNeeds, runProduction, type StockContext, type StockItem } from '@wise/core';
import { perUnitBom, splitExtra } from '@wise/core/sales';
import { audit, type Tx } from '../audit';
import { assertOpenPeriod } from '../posting';
import { productionOrders, type Firm, type Invoice, type InvoiceProdState } from '../schema/index';
import { loadStockContext, replaceSourceMoves, requireLocation, whId } from '../stock-service';
import { deleteProductionOrder, saveBom } from '../stock-docs';
import { DocumentError, type DocActor } from './context';

export interface InvoiceProductionInput {
  /** Materials warehouse (null = main) — the default of the lines without their own (older invoice-level run). */
  wh?: string | null;
  /** Extra production costs of the whole invoice (older run), split over the lines by materials value. */
  extra?: number | string | null;
  /** Save the chosen materials as the product's normativ (default of the lines without their own flag). */
  saveBom?: boolean;
  /**
   * The lines marked „🏭 производство“. Per line: its own materials warehouse (`wh`, null = main), extra costs
   * (`extra`, added to that line's product only) and `saveBom`.
   */
  lines: { lineNo: number; productId: string; qty: number | string; materials: { itemId: string; qty: number | string }[]; wh?: string | null; extra?: number | string | null; saveBom?: boolean }[];
}

const num = (v: unknown) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The plan stored in `invoices.data.prodRun` (before the orders are made): the per-line fields are kept as given, so
 * an older invoice-level plan stays one. `extra` = invoice-level + the lines' own extra costs.
 */
export function invoiceProdPlan(input: InvoiceProductionInput, wh: string | null = input.wh ?? null): InvoiceProdState {
  const lines = input.lines.map((l) => ({
    lineNo: l.lineNo, productId: l.productId, qty: num(l.qty), materials: l.materials.map((m) => ({ itemId: m.itemId, qty: num(m.qty) })),
    ...(l.wh !== undefined ? { wh: l.wh || null } : {}), ...(l.extra != null ? { extra: r2(num(l.extra)) } : {}), ...(l.saveBom !== undefined ? { saveBom: !!l.saveBom } : {}),
  }));
  const extra = r2(num(input.extra) + lines.reduce((a, l) => a + num(l.extra), 0));
  return { wh, extra, saveBom: !!input.saveBom, lines, orders: [], mat: 0 };
}

/** Remove the production orders made by an invoice (edit / delete / un-post). Locked periods are refused. */
export async function removeInvoiceProduction(tx: Tx, firmId: string, prod: InvoiceProdState | null | undefined, actor: DocActor): Promise<void> {
  for (const o of prod?.orders ?? []) {
    const [row] = await tx.select({ id: productionOrders.id }).from(productionOrders).where(and(eq(productionOrders.id, o.id), eq(productionOrders.firmId, firmId))).limit(1);
    if (row) await deleteProductionOrder(tx, { firmId, userId: actor.userId }, o.id);
  }
}

/**
 * Run the production of an invoice. Returns the state stored in `invoices.data.prod` (orders, materials value) and
 * warnings (materials short at the date).
 */
export async function runInvoiceProduction(tx: Tx, f: Firm, inv: Invoice, input: InvoiceProductionInput, actor: DocActor): Promise<{ state: InvoiceProdState; warnings: string[] }> {
  const L = await loadStockContext(tx, f.id);
  assertOpenPeriod(L.firm, inv.date);
  const loc = requireLocation(L, input.wh ?? null);
  const outWh = whId(inv.warehouseId);
  const lineLoc = (l: InvoiceProductionInput['lines'][number]) => (l.wh !== undefined ? requireLocation(L, l.wh || null) : loc);
  const lines = input.lines.filter((l) => l.productId && num(l.qty) > 0 && l.materials.some((m) => m.itemId && num(m.qty) > 0));
  const warnings: string[] = [];
  const state = invoiceProdPlan(input, loc);
  if (!lines.length) return { state, warnings };
  const prodOf = (id: string): StockItem => {
    const p = L.ctx.items?.find((i) => i.id === id);
    if (!p || p.type === 'service') throw new DocumentError('Производот за производство мора да биде артикл на залиха (не услуга).');
    return p;
  };
  for (const l of lines) for (const m of l.materials) {
    const it = L.ctx.items?.find((i) => i.id === m.itemId);
    if (!it || it.type === 'service') throw new DocumentError('Репроматеријалите мора да бидат артикли на залиха.');
    if (m.itemId === l.productId) throw new DocumentError('Производот не може да биде и репроматеријал.');
  }
  // materials value per line at the current average (for the split of the invoice-level extra costs of an older run)
  const P = lines.map((l) => ({ l, loc: lineLoc(l), p: { ...prodOf(l.productId), bom: perUnitBom(l.materials.map((m) => ({ itemId: m.itemId, qty: num(m.qty) })), num(l.qty)), labor: 0 } as StockItem }));
  const vals = P.map(({ l, p, loc: lc }) => productionNeeds(L.ctx, p, num(l.qty), whId(lc)).mat);
  const shared = splitExtra(num(input.extra), vals);
  // the line's own extra costs go to its product only
  const ex = P.map(({ l }, k) => r2(num(l.extra) + (shared[k] ?? 0)));
  let ctx: StockContext = L.ctx;
  const nums = await tx.select({ number: productionOrders.number, date: productionOrders.date }).from(productionOrders).where(eq(productionOrders.firmId, f.id));
  for (const [k, { l, p, loc: lc }] of P.entries()) {
    const q = num(l.qty);
    const W = whId(lc);
    const need = productionNeeds(ctx, p, q, W);
    for (const x of need.lines.filter((y) => y.short)) warnings.push(`Недостига репроматеријал „${x.item.name}“ во ${L.locName(lc)}: потребно ${x.need}, на залиха ${x.have}.`);
    const number = nextYearNumber(nums, inv.date.slice(0, 4));
    nums.push({ number, date: inv.date });
    const prod = { ...p, labor: q ? (ex[k] ?? 0) / q : 0 } as StockItem;
    const [row] = await tx.insert(productionOrders).values({
      firmId: f.id, number, date: inv.date, productId: p.id, qty: q.toFixed(4), locationId: lc,
      bom: (p.bom ?? []).map((b) => ({ itemId: b.item, qty: Number(b.qty) })), note: `Фактура ${inv.number}`, createdBy: actor.userId,
    }).returning({ id: productionOrders.id });
    const id = row!.id;
    const r = runProduction(ctx, { id: 'prod-' + id, product: prod, qty: q, date: inv.date, wh: W });
    // the finished product is received where the invoice issues it from
    const moves = r.moves.map((m) => (m.type === 'prod-in' ? { ...m, wh: outWh } : m));
    await tx.update(productionOrders).set({ mat: r.record.mat.toFixed(2), lab: r.record.lab.toFixed(2), unitCost: String(r.record.unit ?? 0) }).where(eq(productionOrders.id, id));
    await replaceSourceMoves(tx, { firmId: f.id, sourceType: 'production', sourceId: id, moves, date: inv.date, description: `Работен налог ${number} · ${p.name ?? ''} (фактура ${inv.number})`, userId: actor.userId });
    ctx = { ...ctx, moves: [...ctx.moves, ...moves] };
    state.orders.push({ id, number, productId: p.id, lineNo: l.lineNo, mat: r.record.mat, lab: r.record.lab });
    state.mat = r2(state.mat + r.record.mat);
    if ((l.saveBom ?? input.saveBom) && p.type === 'product') {
      await saveBom(tx, { firmId: f.id, userId: actor.userId }, { productId: p.id, labor: num(L.ctx.items?.find((i) => i.id === p.id)?.labor), lines: (p.bom ?? []).map((b) => ({ itemId: b.item, qty: Number(b.qty) })) });
    }
  }
  await audit(tx, { userId: actor.userId, firmId: f.id, action: 'invProd', entityType: 'invoice', entityId: inv.id, data: { number: inv.number, orders: state.orders.map((o) => o.number), mat: state.mat, extra: state.extra } });
  return { state, warnings };
}
