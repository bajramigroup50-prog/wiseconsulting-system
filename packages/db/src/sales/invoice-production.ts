/**
 * Production from a sales invoice („Производство = Да“ → „Репроматеријали за производство“; new — legacy had only a
 * free „Трошоци за производство“ field). In the invoice's transaction, before the invoice issues the product:
 * one production order per produced line (dated the invoice date, numbered like the production screen), the
 * materials issued at average cost from the materials warehouse and the product received at the materials cost
 * (+ the line's share of the extra costs) into the invoice's warehouse, through the existing production engine
 * (`runProduction`) and `replaceSourceMoves` (stock journal with the production scheme: D prodMat 4000 / C stock,
 * D prodWip / C prodLabour 4900, D product / C prodWip). The link lives in `invoices.data.prodRun` (orders) and in the order's note.
 *
 * Production invoice („🏭 Фактура од производство“): the main products carry their cost elements (`calc`: labour,
 * other direct costs, overhead %); the server recomputes them on the materials value actually issued, so the product
 * is received at the calculated cost. The orders are numbered after the chosen „Работен налог / период“ (its number,
 * then „број-2“…). Materials short at the date are warnings kept in `prodRun.notes` — never a block.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nextYearNumber, productionNeeds, runProduction, stock as stockOf, type StockContext, type StockItem } from '@wise/core';
import { lineProdCalc, materialRows, perUnitBom, prodCostCalc, specText, splitExtra, workOrderLabel, workOrderNumber, type ProdCostInput, type ProdSpec, type WorkOrderRef } from '@wise/core/sales';
import { audit, type Tx } from '../audit';
import { assertOpenPeriod } from '../posting';
import { firms, invoiceLines, invoices, items, partners, productionOrders, stockMoves, type Firm, type Invoice, type InvoiceData, type InvoiceProdState } from '../schema/index';
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
  /** „🏭 Фактура од производство“ and its „Работен налог / период“. */
  mode?: 'prodInv' | null;
  workOrder?: WorkOrderRef | null;
  /**
   * The lines marked „🏭 производство“. Per line: its own materials warehouse (`wh`, null = main), extra costs
   * (`extra`, added to that line's product only) and `saveBom`. A main product of a production invoice carries `calc`
   * (labour, other direct costs, overhead %) instead — its extra cost is computed here.
   */
  lines: {
    lineNo: number; productId: string; qty: number | string; materials: { itemId: string; qty: number | string }[]; wh?: string | null; extra?: number | string | null; saveBom?: boolean;
    main?: boolean; spec?: ProdSpec | null; calc?: ProdCostInput | null;
  }[];
}

const num = (v: unknown) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Cost elements as stored (numbers, empty labels dropped). */
function cleanCalc(c: ProdCostInput | null | undefined): ProdCostInput | undefined {
  if (!c) return undefined;
  const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : num(v));
  return {
    hours: s(c.hours), rate: s(c.rate), labour: s(c.labour), ovhPct: s(c.ovhPct),
    other: (c.other ?? []).filter((o) => num(o.amount)).map((o) => ({ label: String(o.label ?? '').trim().slice(0, 80), amount: r2(num(o.amount)) })),
  };
}
function cleanSpec(x: ProdSpec | null | undefined): ProdSpec | undefined {
  if (!x) return undefined;
  const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : num(v));
  return { text: String(x.text ?? '').trim().slice(0, 500) || null, l: s(x.l), w: s(x.w), h: s(x.h), mode: x.mode || '', pcs: s(x.pcs) };
}

/**
 * The plan stored in `invoices.data.prodRun` (before the orders are made): the per-line fields are kept as given, so
 * an older invoice-level plan stays one. `extra` = invoice-level + the lines' own extra costs.
 */
export function invoiceProdPlan(input: InvoiceProductionInput, wh: string | null = input.wh ?? null): InvoiceProdState {
  const lines = input.lines.map((l) => ({
    lineNo: l.lineNo, productId: l.productId, qty: num(l.qty), materials: l.materials.map((m) => ({ itemId: m.itemId, qty: num(m.qty) })),
    ...(l.wh !== undefined ? { wh: l.wh || null } : {}), ...(l.extra != null ? { extra: r2(num(l.extra)) } : {}), ...(l.saveBom !== undefined ? { saveBom: !!l.saveBom } : {}),
    ...(l.main ? { main: true } : {}), ...(l.spec ? { spec: cleanSpec(l.spec) } : {}), ...(l.calc ? { calc: cleanCalc(l.calc) } : {}),
  }));
  const extra = r2(num(input.extra) + lines.reduce((a, l) => a + num(l.extra), 0));
  const wo = input.workOrder?.number?.trim() ? { number: input.workOrder.number.trim().slice(0, 40), from: input.workOrder.from || null, to: input.workOrder.to || null } : null;
  return { wh, extra, saveBom: !!input.saveBom, lines, orders: [], mat: 0, ...(input.mode === 'prodInv' ? { mode: 'prodInv' as const } : {}), ...(wo ? { workOrder: wo } : {}) };
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
  // a line is produced when it has materials or its own costs (labour-only custom work)
  const hasCost = (l: InvoiceProductionInput['lines'][number]) => num(l.extra) > 0 || (!!l.calc && prodCostCalc({ ...l.calc, mat: 0, qty: 1, sale: 0 }).extra > 0);
  const lines = input.lines.filter((l) => l.productId && num(l.qty) > 0 && (l.materials.some((m) => m.itemId && num(m.qty) > 0) || hasCost(l)));
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
  const P = lines.map((l) => ({ l, loc: lineLoc(l), p: { ...prodOf(l.productId), bom: perUnitBom(l.materials.filter((m) => m.itemId && num(m.qty) > 0).map((m) => ({ itemId: m.itemId, qty: num(m.qty) })), num(l.qty)), labor: 0 } as StockItem }));
  const vals = P.map(({ l, p, loc: lc }) => productionNeeds(L.ctx, p, num(l.qty), whId(lc)).mat);
  const shared = splitExtra(num(input.extra), vals);
  let ctx: StockContext = L.ctx;
  const nums = await tx.select({ number: productionOrders.number, date: productionOrders.date }).from(productionOrders).where(eq(productionOrders.firmId, f.id));
  const wo = state.workOrder ?? null;
  const note = `Фактура ${inv.number}` + (wo ? ` · ${workOrderLabel(wo)}` : '');
  for (const [k, { l, p, loc: lc }] of P.entries()) {
    const q = num(l.qty);
    const W = whId(lc);
    const need = productionNeeds(ctx, p, q, W);
    for (const x of need.lines.filter((y) => y.short)) warnings.push(`Недостига репроматеријал „${x.item.name}“ во ${L.locName(lc)}: потребно ${x.need}, на залиха ${x.have}.`);
    // the materials at the value the issue will book; the main product's labour / other / overhead % are computed on it
    const mat = runProduction(ctx, { id: 'calc', product: p, qty: q, date: inv.date, wh: W }).record.mat;
    const C = l.calc ? prodCostCalc({ ...l.calc, mat, qty: q, sale: 0 }) : null;
    // the line's own extra costs go to its product only
    const extra = C ? C.extra : r2(num(l.extra) + (shared[k] ?? 0));
    const number = wo ? workOrderNumber(wo.number, nums.map((x) => x.number)) : nextYearNumber(nums, inv.date.slice(0, 4));
    nums.push({ number, date: inv.date });
    const prod = { ...p, labor: q ? extra / q : 0 } as StockItem;
    const [row] = await tx.insert(productionOrders).values({
      firmId: f.id, number, date: inv.date, productId: p.id, qty: q.toFixed(4), locationId: lc,
      bom: (p.bom ?? []).map((b) => ({ itemId: b.item, qty: Number(b.qty) })), note, createdBy: actor.userId,
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
    const sl = state.lines.find((x) => x.lineNo === l.lineNo && x.productId === l.productId);
    if (sl) {
      const cost = r2(r.record.mat + r.record.lab);
      sl.res = { mat: r.record.mat, lab: C ? C.lab : r.record.lab, other: C ? C.other : 0, ovh: C ? C.ovh : 0, cost, unit: q ? Math.round((cost / q) * 1e4) / 1e4 : 0 };
      if (C) sl.extra = r.record.lab;
    }
    if ((l.saveBom ?? input.saveBom) && p.type === 'product' && (p.bom ?? []).length) {
      await saveBom(tx, { firmId: f.id, userId: actor.userId }, { productId: p.id, labor: num(L.ctx.items?.find((i) => i.id === p.id)?.labor), lines: (p.bom ?? []).map((b) => ({ itemId: b.item, qty: Number(b.qty) })) });
    }
  }
  state.extra = r2(state.lines.reduce((a, x) => a + num(x.extra), 0) + (num(input.extra) || 0));
  if (warnings.length) state.notes = warnings;
  await audit(tx, { userId: actor.userId, firmId: f.id, action: 'invProd', entityType: 'invoice', entityId: inv.id, data: { number: inv.number, orders: state.orders.map((o) => o.number), mat: state.mat, extra: state.extra, ...(wo ? { workOrder: wo.number } : {}) } });
  return { state, warnings };
}

/* ---------------- „Калкулација на производство“ — the calculation sheet of an invoice ---------------- */

export interface ProdSheetMaterial { code: string; name: string; unit: string; qty: number; price: number; value: number; short: boolean }
export interface ProdSheetProduct {
  lineNo: number; orderNo: string | null; code: string; name: string; spec: string; unit: string; qty: number; main: boolean;
  materials: ProdSheetMaterial[]; mat: number; lab: number; labNote: string; other: { label: string; amount: number }[]; otherTotal: number; ovhPct: number; ovh: number;
  cost: number; unitCost: number; sale: number; margin: number; pct: number | null; below: boolean;
}
export interface ProdSheet {
  firm: Firm; number: string; date: string; partner: string; currency: string; fx: number; workOrder: string; booked: boolean; prodInv: boolean;
  products: ProdSheetProduct[]; totals: { cost: number; sale: number; margin: number; pct: number | null }; notes: string[];
}

/**
 * The calculation sheet of an invoice with production: per produced line the materials (booked: at the value the
 * production order issued them; plan: at the current average cost), labour, other direct costs, overhead, cost of
 * production, unit cost, sale value (denars), margin. Null when the invoice has no production.
 */
export async function invoiceProdSheet(tx: Tx, firmId: string, invoiceId: string): Promise<ProdSheet | null> {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.firmId, firmId))).limit(1);
  const D = (inv?.data ?? {}) as InvoiceData;
  const run = D.prodRun;
  if (!inv || !run?.lines.length) return null;
  const [[f], IL, pt] = await Promise.all([
    tx.select().from(firms).where(eq(firms.id, firmId)).limit(1),
    tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo)),
    inv.partnerId ? tx.select({ name: partners.name }).from(partners).where(eq(partners.id, inv.partnerId)).limit(1) : Promise.resolve([]),
  ]);
  const orderIds = run.orders.map((o) => o.id);
  const OM = orderIds.length ? await tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.sourceType, 'production'), inArray(stockMoves.sourceId, orderIds))) : [];
  const ids = [...new Set([...run.lines.flatMap((l) => [l.productId, ...l.materials.map((m) => m.itemId)]), ...OM.map((m) => m.itemId)])];
  const IT = new Map((ids.length ? await tx.select().from(items).where(inArray(items.id, ids)) : []).map((i) => [i.id, i]));
  const booked = run.orders.length > 0;
  const SC = booked ? null : (await loadStockContext(tx, firmId)).ctx;
  const fx = inv.currency === 'MKD' ? 1 : num(inv.fx) || 1;
  const used = new Set<string>();
  const products: ProdSheetProduct[] = [];
  for (const l of run.lines) {
    const it = IT.get(l.productId);
    const il = IL[l.lineNo];
    const sale = il ? r2(num(il.qty) * num(il.price) * (1 - num(il.disc) / 100) * fx) : 0;
    const ord = run.orders.find((o) => o.lineNo === l.lineNo && o.productId === l.productId && !used.has(o.id));
    if (ord) used.add(ord.id);
    let materials: ProdSheetMaterial[];
    if (ord) {
      const by = new Map<string, { qty: number; value: number }>();
      for (const m of OM.filter((x) => x.sourceId === ord.id && x.direction === 'out' && x.itemId !== l.productId)) {
        const o = by.get(m.itemId) ?? { qty: 0, value: 0 };
        by.set(m.itemId, { qty: o.qty - num(m.qty), value: r2(o.value - num(m.value)) });
      }
      materials = [...by].map(([id, x]) => ({ code: IT.get(id)?.code ?? '', name: IT.get(id)?.name ?? '?', unit: IT.get(id)?.unit ?? '', qty: Math.round(x.qty * 1e4) / 1e4, price: x.qty ? Math.round((x.value / x.qty) * 1e4) / 1e4 : 0, value: x.value, short: false }));
    } else {
      const W = l.wh ?? run.wh ?? 'main';
      const R = materialRows(l.materials, (id) => (SC ? stockOf(SC, id, W || 'main') : { qty: 0, avg: 0 }));
      materials = R.rows.map((r) => ({ code: IT.get(r.itemId)?.code ?? '', name: IT.get(r.itemId)?.name ?? '?', unit: IT.get(r.itemId)?.unit ?? '', qty: r.qty, price: r.avg, value: r.value, short: r.short }));
    }
    const mat = ord ? ord.mat : r2(materials.reduce((a, m) => a + m.value, 0));
    const c = l.calc ? prodCostCalc({ ...l.calc, mat, qty: l.qty, sale }) : null;
    const res = l.res;
    const lab = res ? res.lab : c ? c.lab : ord ? ord.lab : r2(num(l.extra));
    const other = (l.calc?.other ?? []).map((o) => ({ label: o.label, amount: r2(num(o.amount)) }));
    const otherTotal = res ? res.other : c ? c.other : 0;
    const ovh = res ? res.ovh : c ? c.ovh : 0;
    const cost = res ? res.cost : c ? c.cost : r2(mat + lab);
    const k = lineProdCalc({ mat, extra: r2(cost - mat), qty: l.qty, sale });
    const labNote = l.calc && num(l.calc.hours) && !(l.calc.labour != null && String(l.calc.labour) !== '') ? `${num(l.calc.hours)} ч × ${r2(num(l.calc.rate))}` : '';
    products.push({
      lineNo: l.lineNo, orderNo: ord?.number ?? null, code: it?.code ?? '', name: il?.name ?? it?.name ?? '?', spec: specText(l.spec), unit: il?.unit ?? it?.unit ?? '', qty: l.qty, main: !!l.main,
      materials, mat, lab, labNote, other, otherTotal, ovhPct: num(l.calc?.ovhPct), ovh, cost, unitCost: k.unit, sale, margin: k.margin, pct: k.pct, below: k.below,
    });
  }
  const cost = r2(products.reduce((a, p) => a + p.cost, 0)), sale = r2(products.reduce((a, p) => a + p.sale, 0));
  const margin = r2(sale - cost);
  const notes = [...(run.notes ?? [])];
  if (!booked) for (const p of products) for (const m of p.materials.filter((x) => x.short)) notes.push(`Недостига репроматеријал „${m.name}“ за „${p.name}“.`);
  return {
    firm: f!, number: inv.number, date: inv.date, partner: pt[0]?.name ?? '', currency: inv.currency, fx: num(inv.fx) || 1, workOrder: workOrderLabel(run.workOrder),
    booked, prodInv: run.mode === 'prodInv' || D.prodInv === '1', products, totals: { cost, sale, margin, pct: sale ? Math.round((margin / sale) * 1e4) / 100 : null }, notes,
  };
}
