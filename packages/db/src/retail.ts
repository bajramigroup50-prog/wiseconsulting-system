/**
 * Stock, materials & retail screens — persistence (legacy `zaliha`, `porachki`, `nabavki`, `dopolnuvanje`, `mrp`,
 * `lojalnost`, `m_akcii`, `lotovi`, `rasNorm`). Every mutation runs inside the caller's transaction and writes an
 * `audit_log` row there; stock effects go through `replaceSourceMoves` (period locks, stock journal).
 * The pure computations are in `@wise/core` (`Retail`, stock module).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { r2, r4 } from '@wise/core/stock/num';
import { postIn, postOut, priceAt, promotionPrice, stockAt, type StockMove } from '@wise/core';
import { nextPrefixedNo, orderRest, type LoyaltyRules } from '@wise/core/retail';
import { audit, type Tx } from './audit';
import { assertOpenPeriod } from './posting';
import {
  coupons, customerOrders, firms, invoiceLines, invoices, items, loyaltyCards, partners, productionOrders, promotions, purchases,
  purchaseStockLines, stockLots, supplierOrders, writeoffDocs,
  type CustomerOrderLine, type SupplierOrderLine,
} from './schema/index';
import {
  StockDocError, loadStockContext, removeSourceMoves, replaceSourceMoves, requireLocation, requireTracked, whId,
} from './stock-service';
import { saveLevelling, type Actor } from './stock-docs';
import { saveInvoice } from './sales/invoices';

const isDate = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
function needDate(d: string | null | undefined, what = 'датум'): asserts d is string {
  if (!isDate(d)) throw new StockDocError(`Неважечки ${what}.`);
}
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function lockFirm(tx: Tx, firmId: string) {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) throw new StockDocError('Фирмата не постои.');
  return f;
}

async function ownPartner(tx: Tx, firmId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.id, id))).limit(1);
  if (!p) throw new StockDocError('Комитентот не постои.');
  return p.id;
}

/* ================================================================== firm settings */

/** Merge keys into `firms.settings` (legacy `saveFirmPatch`), audited. */
export async function patchFirmSettings(tx: Tx, a: Actor, patch: Record<string, unknown>, action: string): Promise<void> {
  const f = await lockFirm(tx, a.firmId);
  await tx.update(firms).set({ settings: { ...((f.settings ?? {}) as Record<string, unknown>), ...patch } }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action, entityType: 'firm', entityId: a.firmId, data: patch });
}

export const firmSettingsOf = (f: { settings: unknown }): Record<string, unknown> => (f.settings ?? {}) as Record<string, unknown>;

/* ================================================================== Приемници и издатници (manual moves) */

export interface ManualMoveInput {
  kind: 'in' | 'use' | 'tr';
  date: string;
  itemId: string;
  qty: number;
  /** Receipt: location; issue: location. */
  wh?: string | null;
  /** Transfer: from / to. */
  from?: string | null;
  to?: string | null;
  /** Receipt unit purchase price. */
  price?: number | null;
  /** Receipt: counter account (empty = no posting); issue: expense account. */
  account?: string | null;
  label?: string | null;
  /** Partner for a receipt booked against a supplier account (22xx). */
  partnerId?: string | null;
}

/**
 * Legacy `ACT.saveMove` (7214): receipt (Д stock / П counter account, or no posting), issue for consumption at average
 * cost (Д expense / П stock) or a transfer between locations at average cost. Stored as `stock_moves` of
 * `source_type = 'manual_move'` (one source per document).
 */
export async function saveManualMove(tx: Tx, a: Actor, input: ManualMoveInput): Promise<{ id: string }> {
  needDate(input.date);
  const q = r4(input.qty);
  if (!input.itemId || !(q > 0)) throw new StockDocError('Изберете артикл и количина.');
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, input.date);
  const it = requireTracked(L, input.itemId);
  const id = crypto.randomUUID();
  const src = 'manual_move-' + id;
  const label = input.label?.trim() || '';
  let moves: StockMove[] = [];
  let description = '';
  if (input.kind === 'tr') {
    const fr = requireLocation(L, input.from), to = requireLocation(L, input.to);
    if (fr === to) throw new StockDocError('Изберете различни објекти.');
    const have = stockAt(L.ctx, { item: it.id, wh: whId(fr), date: input.date }).qty;
    if (have < q - 1e-9) throw new StockDocError('Нема доволно залиха во ' + L.locName(fr) + '.');
    const out = postOut(L.ctx, { item: it, qty: q, date: input.date, type: 'transfer', src, label: (label || 'Преносница') + ' → ' + L.locName(to), debitAccount: null, wh: whId(fr) });
    moves = [out.move, { id: src + '-in', date: input.date, item: it.id, qty: q, value: out.value, type: 'transfer-in', src, wh: whId(to), label: (label || 'Преносница') + ' од ' + L.locName(fr), lines: [] }];
    description = `Преносница: ${L.locName(fr)} → ${L.locName(to)}`;
  } else if (input.kind === 'in') {
    const wh = requireLocation(L, input.wh);
    const v = r2(q * n(input.price));
    const k = (input.account ?? '').trim();
    if (k && !/^\d{3,10}$/.test(k)) throw new StockDocError('Неважечко конто.');
    const stockK = it.type === 'material' ? (L.ctx.scheme?.material || '3100') : it.type === 'product' ? (L.ctx.scheme?.product || '6300') : (L.ctx.scheme?.stock || '6600');
    moves = [{ id: src, date: input.date, item: it.id, qty: q, value: v, type: 'in', src, wh: whId(wh), label: label || 'Приемница', lines: k && v ? [{ account: stockK, debit: v, credit: 0 }, { account: k, debit: 0, credit: v }] : [] }];
    description = 'Приемница';
  } else {
    const wh = requireLocation(L, input.wh);
    if (L.ctx.moves.filter((m) => m.item === it.id && whId(m.wh) === whId(wh) && !m.pend).reduce((s, m) => s + m.qty, 0) < q - 1e-9) {
      throw new StockDocError('Нема доволно на залиха во ' + L.locName(wh) + '.');
    }
    const k = (input.account ?? '').trim() || '4000';
    if (!/^\d{3,10}$/.test(k)) throw new StockDocError('Неважечко конто.');
    moves = [postOut(L.ctx, { item: it, qty: q, date: input.date, type: 'use', src, label: label || 'Издатница', debitAccount: k, wh: whId(wh) }).move];
    description = 'Издатница';
  }
  const partnerId = await ownPartner(tx, a.firmId, input.partnerId);
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'manual_move', sourceId: id, moves, date: input.date, description: `${description} · ${it.name ?? ''}`, userId: a.userId, partnerId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveMove', entityType: 'stock_move', entityId: id, data: { kind: input.kind, item: it.id, qty: q, date: input.date } });
  return { id };
}

export async function deleteManualMove(tx: Tx, a: Actor, id: string): Promise<void> {
  const n0 = await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'manual_move', sourceId: id, userId: a.userId });
  if (!n0) throw new StockDocError('Документот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'delMove', entityType: 'stock_move', entityId: id });
}

/* ================================================================== customer orders */

export interface CustomerOrderInput {
  id?: string | null;
  number?: string | null;
  date: string;
  partnerId: string;
  deliveryDate?: string | null;
  note?: string | null;
  lines: readonly { itemId: string | null; name?: string | null; unit?: string | null; qty: number; price: number; disc?: number | null; rate?: number | null; account?: string | null }[];
}

/** Legacy `ordSaveB` (9888). Number `НР-NNN/YYYY`, unique per firm. */
export async function saveCustomerOrder(tx: Tx, a: Actor, input: CustomerOrderInput): Promise<{ id: string; number: string }> {
  needDate(input.date);
  if (input.deliveryDate && !isDate(input.deliveryDate)) throw new StockDocError('Неважечки датум на испорака.');
  const partnerId = await ownPartner(tx, a.firmId, input.partnerId);
  if (!partnerId) throw new StockDocError('Изберете купувач.');
  if (!input.lines.length) throw new StockDocError('Додајте ставки.');
  const ids = [...new Set(input.lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  const its = ids.length ? await tx.select().from(items).where(and(eq(items.firmId, a.firmId), inArray(items.id, ids))) : [];
  const by = new Map(its.map((i) => [i.id, i]));
  const lines: CustomerOrderLine[] = input.lines.map((l) => {
    const it = l.itemId ? by.get(l.itemId) : undefined;
    if (l.itemId && !it) throw new StockDocError('Артиклот не постои.');
    if (!(n(l.qty) > 0)) throw new StockDocError('Количината мора да е поголема од 0.');
    return {
      itemId: it?.id ?? null, name: (l.name || it?.name || 'Ставка').trim(), unit: l.unit ?? it?.unit ?? 'ком', qty: r4(l.qty), price: r4(l.price),
      disc: n(l.disc), rate: l.rate == null ? it?.vatRate ?? 18 : n(l.rate), account: l.account ?? it?.revenueAccount ?? null,
    };
  });
  const prev = input.id ? (await tx.select().from(customerOrders).where(and(eq(customerOrders.id, input.id), eq(customerOrders.firmId, a.firmId))).limit(1))[0] : undefined;
  if (input.id && !prev) throw new StockDocError('Нарачката не постои.');
  let number = (input.number ?? '').trim() || prev?.number || '';
  if (!number) number = nextPrefixedNo(await tx.select({ number: customerOrders.number, date: customerOrders.date }).from(customerOrders).where(eq(customerOrders.firmId, a.firmId)), 'НР-', input.date);
  const [dup] = await tx.select({ id: customerOrders.id }).from(customerOrders).where(and(eq(customerOrders.firmId, a.firmId), eq(customerOrders.number, number))).limit(1);
  if (dup && dup.id !== prev?.id) throw new StockDocError(`Нарачка со број ${number} веќе постои.`);
  const head = { number, date: input.date, partnerId, deliveryDate: input.deliveryDate || null, note: input.note?.trim() || null, lines };
  const id = prev
    ? (await tx.update(customerOrders).set(head).where(eq(customerOrders.id, prev.id)).returning({ id: customerOrders.id }))[0]!.id
    : (await tx.insert(customerOrders).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: customerOrders.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ordSaveB', entityType: 'customer_order', entityId: id, data: { number, lines: lines.length, edit: !!prev } });
  return { id, number };
}

export async function cancelCustomerOrder(tx: Tx, a: Actor, id: string): Promise<void> {
  const [o] = await tx.update(customerOrders).set({ status: 'cancel' }).where(and(eq(customerOrders.id, id), eq(customerOrders.firmId, a.firmId))).returning();
  if (!o) throw new StockDocError('Нарачката не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ordCancel', entityType: 'customer_order', entityId: id, data: { number: o.number } });
}

/** Delivered quantities per order and item: lines of invoices issued from the order (`data.source`). */
export async function orderDeliveries(tx: Tx, firmId: string): Promise<Map<string, Record<string, number>>> {
  const rows = await tx.select({ src: sql<string>`${invoices.data}->'source'->>'id'`, itemId: invoiceLines.itemId, qty: invoiceLines.qty })
    .from(invoices).innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
    .where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), sql`${invoices.data}->'source'->>'type' = 'customer_order'`));
  const M = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!r.itemId || !r.src) continue;
    const o = M.get(r.src) ?? {};
    o[r.itemId] = r4((o[r.itemId] ?? 0) + n(r.qty));
    M.set(r.src, o);
  }
  return M;
}

/**
 * Legacy `ordInv` (9890): an invoice draft for the rest of the order, goods limited to the stock on hand; the invoice
 * keeps `data.source = {type:'customer_order', id}` so its quantities count as delivered.
 */
export async function invoiceFromOrder(tx: Tx, a: Actor & { role: string }, id: string, date: string): Promise<{ invoiceId: string; short: boolean }> {
  needDate(date);
  const [o] = await tx.select().from(customerOrders).where(and(eq(customerOrders.id, id), eq(customerOrders.firmId, a.firmId))).limit(1);
  if (!o) throw new StockDocError('Нарачката не постои.');
  if (o.status === 'cancel') throw new StockDocError('Нарачката е откажана.');
  const del = (await orderDeliveries(tx, a.firmId)).get(o.id) ?? {};
  const L = await loadStockContext(tx, a.firmId);
  const R = orderRest(o.lines.map((l) => ({ ...l, itemId: l.itemId })), del).filter((l) => l.rest > 1e-9);
  const free = new Map<string, number>();
  let short = false;
  const lines = R.map((l) => {
    const it = l.itemId ? L.ctx.items?.find((x) => x.id === l.itemId) : undefined;
    let q = l.rest;
    if (it && it.type && it.type !== 'service') {
      const have = free.has(it.id) ? free.get(it.id)! : Math.max(0, L.ctx.moves.filter((m) => m.item === it.id && !m.pend).reduce((s, m) => s + m.qty, 0));
      q = r4(Math.min(l.rest, have));
      free.set(it.id, r4(have - q));
      if (q < l.rest - 1e-9) short = true;
    }
    return { itemId: l.itemId, name: l.name, unit: l.unit, qty: q, price: l.price, disc: l.disc, rate: l.rate, account: l.account };
  }).filter((l) => l.qty > 0);
  if (!lines.length) throw new StockDocError('Нема залиха за испорака.');
  const r = await saveInvoice(tx, a.firmId, {
    kind: 'invoice', date, partnerId: o.partnerId, note: 'По нарачка ' + o.number, draft: true, lines,
    data: { source: { type: 'customer_order', id: o.id } },
  }, { userId: a.userId, role: a.role });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ordInv', entityType: 'customer_order', entityId: o.id, data: { invoice: r.id, lines: lines.length } });
  return { invoiceId: r.id, short };
}

/* ================================================================== supplier orders */

export interface SupplierOrderInput {
  id?: string | null;
  date: string;
  partnerId?: string | null;
  note?: string | null;
  lines: readonly { itemId: string; qty: number; price?: number | null }[];
}

async function poLines(tx: Tx, firmId: string, lines: SupplierOrderInput['lines']): Promise<SupplierOrderLine[]> {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const its = ids.length ? await tx.select().from(items).where(and(eq(items.firmId, firmId), inArray(items.id, ids))) : [];
  const by = new Map(its.map((i) => [i.id, i]));
  return lines.filter((l) => n(l.qty) > 0).map((l) => {
    const it = by.get(l.itemId);
    if (!it) throw new StockDocError('Артиклот не постои.');
    return { itemId: it.id, name: it.name, unit: it.unit ?? 'ком', qty: r4(l.qty), price: r4(n(l.price)) };
  });
}

/** Legacy `poSaveB` / `poCreate` (9894). */
export async function saveSupplierOrder(tx: Tx, a: Actor, input: SupplierOrderInput, source: 'repl' | 'mrp' | null = null): Promise<{ id: string; number: string }> {
  needDate(input.date);
  const partnerId = await ownPartner(tx, a.firmId, input.partnerId);
  const lines = await poLines(tx, a.firmId, input.lines);
  if (!lines.length) throw new StockDocError('Додајте ставки.');
  if (input.id) {
    const [o] = await tx.update(supplierOrders).set({ date: input.date, partnerId, note: input.note?.trim() || null, lines })
      .where(and(eq(supplierOrders.id, input.id), eq(supplierOrders.firmId, a.firmId))).returning();
    if (!o) throw new StockDocError('Нарачката не постои.');
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'poSaveB', entityType: 'supplier_order', entityId: o.id, data: { number: o.number, lines: lines.length } });
    return { id: o.id, number: o.number };
  }
  await lockFirm(tx, a.firmId);
  const number = nextPrefixedNo(await tx.select({ number: supplierOrders.number, date: supplierOrders.date }).from(supplierOrders).where(eq(supplierOrders.firmId, a.firmId)), 'НД-', input.date);
  const [o] = await tx.insert(supplierOrders).values({ firmId: a.firmId, number, date: input.date, partnerId, note: input.note?.trim() || null, lines, source, createdBy: a.userId }).returning();
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: source ? (source === 'mrp' ? 'mrpPo' : 'replMake') : 'poSaveB', entityType: 'supplier_order', entityId: o!.id, data: { number, lines: lines.length } });
  return { id: o!.id, number };
}

/** One supplier order per supplier (legacy `poCreate`). */
export async function createSupplierOrders(tx: Tx, a: Actor, rows: readonly { itemId: string; qty: number; price: number; pid: string | null }[], source: 'repl' | 'mrp', date: string): Promise<string[]> {
  const by = new Map<string, typeof rows[number][]>();
  for (const r of rows) by.set(r.pid || '', [...(by.get(r.pid || '') ?? []), r]);
  const made: string[] = [];
  for (const [pid, L] of by) made.push((await saveSupplierOrder(tx, a, { date, partnerId: pid || null, lines: L }, source)).number);
  return made;
}

export async function setSupplierOrderStatus(tx: Tx, a: Actor, id: string, status: 'recv' | 'cancel', today: string): Promise<void> {
  const [o] = await tx.update(supplierOrders).set({ status, receivedAt: status === 'recv' ? today : null })
    .where(and(eq(supplierOrders.id, id), eq(supplierOrders.firmId, a.firmId), eq(supplierOrders.status, 'open'))).returning();
  if (!o) throw new StockDocError('Нарачката не постои или не е отворена.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: status === 'recv' ? 'poRecv' : 'poCancel', entityType: 'supplier_order', entityId: id, data: { number: o.number } });
}

/** Last supplier and purchase price of each item (legacy `lastSupplier`): the latest posted purchase with that item. */
export async function lastSuppliers(tx: Tx, firmId: string): Promise<Map<string, { pid: string; price: number }>> {
  const rows = await tx.select({ itemId: purchaseStockLines.itemId, price: purchaseStockLines.price, pid: purchases.partnerId, date: purchases.date })
    .from(purchaseStockLines).innerJoin(purchases, eq(purchases.id, purchaseStockLines.purchaseId))
    .where(and(eq(purchases.firmId, firmId), eq(purchases.status, 'posted'))).orderBy(desc(purchases.date));
  const M = new Map<string, { pid: string; price: number }>();
  for (const r of rows) if (!M.has(r.itemId)) M.set(r.itemId, { pid: r.pid ?? '', price: n(r.price) });
  return M;
}

/* ================================================================== loyalty */

export interface LoyaltyCardInput { id?: string | null; number: string; name: string; phone?: string | null; email?: string | null; discount?: number | null; points?: number | null }

/** Legacy `lcSave` (9952). */
export async function saveLoyaltyCard(tx: Tx, a: Actor, x: LoyaltyCardInput): Promise<string> {
  const number = x.number.trim(), name = x.name.trim();
  if (!number || !name) throw new StockDocError('Внесете број и име.');
  const [dup] = await tx.select({ id: loyaltyCards.id }).from(loyaltyCards).where(and(eq(loyaltyCards.firmId, a.firmId), eq(loyaltyCards.number, number))).limit(1);
  if (dup && dup.id !== x.id) throw new StockDocError('Картичката ' + number + ' постои.');
  const v = { number, name, phone: x.phone?.trim() || null, email: x.email?.trim() || null, discount: String(n(x.discount)), points: String(n(x.points)) };
  const id = x.id
    ? (await tx.update(loyaltyCards).set(v).where(and(eq(loyaltyCards.id, x.id), eq(loyaltyCards.firmId, a.firmId))).returning({ id: loyaltyCards.id }))[0]?.id
    : (await tx.insert(loyaltyCards).values({ ...v, firmId: a.firmId }).returning({ id: loyaltyCards.id }))[0]?.id;
  if (!id) throw new StockDocError('Картичката не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'lcSave', entityType: 'loyalty_card', entityId: id, data: { number, name } });
  return id;
}

export interface CouponInput { id?: string | null; code: string; kind: 'pct' | 'amt'; value: number; validFrom?: string | null; validTo?: string | null; maxUses?: number | null; minTotal?: number | null }

/** Legacy `cpSave` (9954). */
export async function saveCoupon(tx: Tx, a: Actor, x: CouponInput): Promise<string> {
  const code = x.code.trim().toUpperCase();
  if (!code || !(n(x.value) > 0)) throw new StockDocError('Внесете код и вредност.');
  if ((x.validFrom && !isDate(x.validFrom)) || (x.validTo && !isDate(x.validTo))) throw new StockDocError('Неважечки датум.');
  const [dup] = await tx.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.firmId, a.firmId), eq(coupons.code, code))).limit(1);
  if (dup && dup.id !== x.id) throw new StockDocError('Кодот постои.');
  const v = { code, kind: x.kind, value: String(r2(x.value)), validFrom: x.validFrom || null, validTo: x.validTo || null, maxUses: Math.max(0, Math.trunc(n(x.maxUses))), minTotal: String(r2(n(x.minTotal))) };
  const id = x.id
    ? (await tx.update(coupons).set(v).where(and(eq(coupons.id, x.id), eq(coupons.firmId, a.firmId))).returning({ id: coupons.id }))[0]?.id
    : (await tx.insert(coupons).values({ ...v, firmId: a.firmId }).returning({ id: coupons.id }))[0]?.id;
  if (!id) throw new StockDocError('Купонот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'cpSave', entityType: 'coupon', entityId: id, data: { code } });
  return id;
}

export const loyaltyRulesOf = (settings: Record<string, unknown>): LoyaltyRules => ({ per: 100, val: 1, min: 100, ...((settings.loy ?? {}) as Partial<LoyaltyRules>) });

/** Apply a POS sale to a card and a coupon (legacy `posSell` wrapper 9940): points earned / redeemed, spent, visits. */
export async function loyaltyApplySale(tx: Tx, a: Actor, x: { cardId?: string | null; couponId?: string | null; pay: number; redPts: number; earn: number; date: string }): Promise<void> {
  if (x.cardId) {
    const [c] = await tx.select().from(loyaltyCards).where(and(eq(loyaltyCards.id, x.cardId), eq(loyaltyCards.firmId, a.firmId))).for('update').limit(1);
    if (!c) throw new StockDocError('Картичката не постои.');
    await tx.update(loyaltyCards).set({
      points: String(r2(n(c.points) - x.redPts + x.earn)), spent: String(r2(n(c.spent) + x.pay)), visits: c.visits + 1, lastVisit: x.date,
      log: [...c.log, { d: x.date, pay: x.pay, earn: x.earn, red: x.redPts }].slice(-50),
    }).where(eq(loyaltyCards.id, c.id));
  }
  if (x.couponId) await tx.update(coupons).set({ used: sql`${coupons.used} + 1` }).where(and(eq(coupons.id, x.couponId), eq(coupons.firmId, a.firmId)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'loySale', entityType: 'loyalty_card', entityId: x.cardId ?? x.couponId ?? undefined, data: { pay: x.pay, earn: x.earn, red: x.redPts, coupon: x.couponId } });
}

/* ================================================================== promotions (акции) */

export interface PromotionInput {
  id?: string | null;
  name: string;
  wh: string;
  from: string;
  to: string;
  pct?: number | null;
  rnd?: number | null;
  /** Selected items: explicit promotional price or own %. */
  sel: Readonly<Record<string, { price?: number | null; pct?: number | null }>>;
}

/** Legacy `akcSave` (7902): lines with the regular price on `from` and the promotional price; number `NNN/YY`. */
export async function savePromotion(tx: Tx, a: Actor, x: PromotionInput): Promise<{ id: string; number: string }> {
  if (!x.name.trim()) throw new StockDocError('Внесете назив на акцијата.');
  if (!isDate(x.from) || !isDate(x.to) || x.to < x.from) throw new StockDocError('Проверете го периодот (Од / До).');
  const L = await loadStockContext(tx, a.firmId);
  const loc = requireLocation(L, x.wh);
  if (!loc || !L.locations.some((l) => l.id === loc && l.kind === 'store')) throw new StockDocError('Изберете продавница.');
  const lines = [] as { itemId: string; old: number; new: number }[];
  for (const [id, s] of Object.entries(x.sel)) {
    const it = L.ctx.items?.find((i) => i.id === id);
    if (!it) continue;
    const old = priceAt(L.ctx, it, loc, x.from);
    const nw = promotionPrice(old, s, { pct: x.pct ?? 0, rnd: x.rnd ?? 0 });
    if (!(nw >= 0) || Math.abs(nw - old) < 0.005) continue;
    lines.push({ itemId: id, old, new: nw });
  }
  if (!lines.length) throw new StockDocError('Изберете артикли со нова (пониска) цена.');
  const prev = x.id ? (await tx.select().from(promotions).where(and(eq(promotions.id, x.id), eq(promotions.firmId, a.firmId))).limit(1))[0] : undefined;
  if (x.id && !prev) throw new StockDocError('Акцијата не постои.');
  if (prev && prev.status !== 'plan') throw new StockDocError('Започната акција не може да се менува.');
  let number = prev?.number ?? '';
  if (!number) {
    const yy = x.from.slice(2, 4);
    const ex = await tx.select({ number: promotions.number, from: promotions.dateFrom }).from(promotions).where(eq(promotions.firmId, a.firmId));
    const mx = ex.filter((e) => e.from.slice(0, 4) === x.from.slice(0, 4)).reduce((m, e) => Math.max(m, parseInt(e.number, 10) || 0), 0);
    number = String(mx + 1).padStart(3, '0') + '/' + yy;
  }
  const head = { name: x.name.trim(), locationId: loc, dateFrom: x.from, dateTo: x.to, pct: x.pct == null ? null : String(x.pct), rounding: Math.trunc(n(x.rnd)), lines };
  const id = prev
    ? (await tx.update(promotions).set(head).where(eq(promotions.id, prev.id)).returning({ id: promotions.id }))[0]!.id
    : (await tx.insert(promotions).values({ ...head, firmId: a.firmId, number, date: new Date().toISOString().slice(0, 10), createdBy: a.userId }).returning({ id: promotions.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'akcSave', entityType: 'promotion', entityId: id, data: { number, lines: lines.length } });
  return { id, number };
}

export async function deletePromotion(tx: Tx, a: Actor, id: string): Promise<void> {
  const [p] = await tx.delete(promotions).where(and(eq(promotions.id, id), eq(promotions.firmId, a.firmId), eq(promotions.status, 'plan'))).returning();
  if (!p) throw new StockDocError('Може да се брише само планирана акција.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'akDel', entityType: 'promotion', entityId: id, data: { number: p.number } });
}

/**
 * Legacy `akStart` / `akEnd` (7907/7910): a levelling to the promotional prices (start) or back to the regular ones
 * (end); quantities = stock at the date.
 */
export async function runPromotion(tx: Tx, a: Actor, id: string, back: boolean, today: string): Promise<{ number: string; date: string }> {
  const [p] = await tx.select().from(promotions).where(and(eq(promotions.id, id), eq(promotions.firmId, a.firmId))).for('update').limit(1);
  if (!p) throw new StockDocError('Акцијата не постои.');
  if (!back && p.status !== 'plan') throw new StockDocError('Акцијата е веќе започната.');
  if (back && p.status !== 'active') throw new StockDocError('Акцијата не е активна.');
  const addDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const date = back ? (today > p.dateTo ? addDay(p.dateTo) : today) : (today < p.dateFrom || today > p.dateTo ? p.dateFrom : today);
  const r = await saveLevelling(tx, a, {
    date, wh: p.locationId, today, note: (back ? 'Крај на акција ' : 'Акција ') + p.name,
    prices: Object.fromEntries(p.lines.map((l) => [l.itemId, back ? l.old : l.new])),
    old: Object.fromEntries(p.lines.map((l) => [l.itemId, back ? l.new : l.old])),
  });
  await tx.update(promotions).set(back ? { status: 'done', levellingEndId: r.id, endedOn: date } : { status: 'active', levellingStartId: r.id, startedOn: date }).where(eq(promotions.id, p.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: back ? 'akEnd' : 'akStart', entityType: 'promotion', entityId: p.id, data: { number: p.number, levelling: r.number, date } });
  return { number: r.number, date };
}

/* ================================================================== lots */

export interface LotInput { sourceType: 'purchase' | 'production'; sourceId: string; lineNo: number; lot?: string | null; expiry?: string | null }

/** Legacy `lotSave` (10037): lot / expiry per purchase stock line or production order; empty both = removed. */
export async function saveLots(tx: Tx, a: Actor, rows: readonly LotInput[]): Promise<number> {
  let c = 0;
  for (const r of rows) {
    if (r.expiry && !isDate(r.expiry)) throw new StockDocError('Неважечки рок на траење.');
    let itemId: string | undefined, q = 0;
    if (r.sourceType === 'purchase') {
      const [l] = await tx.select({ itemId: purchaseStockLines.itemId, qty: purchaseStockLines.qty }).from(purchaseStockLines)
        .innerJoin(purchases, eq(purchases.id, purchaseStockLines.purchaseId))
        .where(and(eq(purchases.firmId, a.firmId), eq(purchases.id, r.sourceId), eq(purchaseStockLines.lineNo, r.lineNo))).limit(1);
      itemId = l?.itemId; q = n(l?.qty);
    } else {
      const [p] = await tx.select({ itemId: productionOrders.productId, qty: productionOrders.qty }).from(productionOrders)
        .where(and(eq(productionOrders.firmId, a.firmId), eq(productionOrders.id, r.sourceId))).limit(1);
      itemId = p?.itemId; q = n(p?.qty);
    }
    if (!itemId) throw new StockDocError('Документот не постои.');
    const where = and(eq(stockLots.firmId, a.firmId), eq(stockLots.sourceType, r.sourceType), eq(stockLots.sourceId, r.sourceId), eq(stockLots.lineNo, r.lineNo));
    const lot = r.lot?.trim() || null, expiry = r.expiry || null;
    if (!lot && !expiry) await tx.delete(stockLots).where(where);
    else {
      const [ex] = await tx.select({ id: stockLots.id }).from(stockLots).where(where).limit(1);
      if (ex) await tx.update(stockLots).set({ lot, expiry, itemId, qty: String(q) }).where(eq(stockLots.id, ex.id));
      else await tx.insert(stockLots).values({ firmId: a.firmId, sourceType: r.sourceType, sourceId: r.sourceId, lineNo: r.lineNo, itemId, qty: String(q), lot, expiry });
    }
    c++;
  }
  if (c) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'lotSave', entityType: 'stock_lot', data: { rows: c } });
  return c;
}

/* ================================================================== write-off without BOM (rasNorm) */

export interface WriteoffInput {
  date: string; from: string; to: string; mode: 'popis' | 'pct'; pct?: number | null; wh?: string | null;
  /** Product received from the materials (6300 / 6000) and its quantity; empty = expense 4000 / material. */
  productId?: string | null; productQty?: number | null;
  lines: readonly { itemId: string; qty: number }[];
}

/**
 * Legacy `rnPost` (13888): materials issued at average cost (`mat-out`, Д 4000 or Д 6000 when a product is made),
 * the product received at the material value (Д 6300 / П 6000). One `writeoff_docs` row, moves as its source.
 */
export async function saveWriteoff(tx: Tx, a: Actor, x: WriteoffInput): Promise<{ id: string; total: number }> {
  needDate(x.to);
  needDate(x.from);
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, x.to);
  const loc = requireLocation(L, x.wh);
  const wh = whId(loc);
  const P = x.productId ? L.ctx.items?.find((i) => i.id === x.productId && i.type === 'product') : undefined;
  if (x.productId && !P) throw new StockDocError('Производот не постои.');
  if (P && !(n(x.productQty) > 0)) throw new StockDocError('Внесете ја произведената количина.');
  const lines = x.lines.filter((l) => r4(l.qty) > 0);
  if (!lines.length) throw new StockDocError('Нема ништо за раздолжување.');
  const sch = L.ctx.scheme ?? {};
  const dk = P ? (sch.prodWip || '6000') : '4000';
  const id = crypto.randomUUID();
  const src = 'writeoff_doc-' + id;
  const label = 'Раздолжување суровини ' + (x.mode === 'pct' ? '(' + n(x.pct) + '% од продажба)' : '(попис)') + ' ' + x.from.split('-').reverse().join('.') + '–' + x.to.split('-').reverse().join('.');
  let ctx = L.ctx;
  const moves: StockMove[] = [];
  const docLines: { itemId: string; qty: number; value: number }[] = [];
  let mat = 0;
  for (const l of lines) {
    const it = requireTracked(L, l.itemId);
    const r = postOut(ctx, { item: it, qty: r4(l.qty), date: x.to, type: 'mat-out', src, label, debitAccount: dk, wh });
    moves.push(r.move);
    ctx = { ...ctx, moves: [...ctx.moves, r.move] };
    mat += r.value;
    docLines.push({ itemId: it.id, qty: r4(l.qty), value: r.value });
  }
  mat = r2(mat);
  if (P) {
    const r = postIn(ctx, { item: P, qty: r4(n(x.productQty)), date: x.to, src, label: 'Производство ' + (P.name ?? '') + ' (без норматив)', creditAccount: sch.prodWip || '6000', wh, type: 'prod-in', value: mat });
    moves.push({ ...r.move, lines: [{ account: sch.product || '6300', debit: mat, credit: 0 }, { account: sch.prodWip || '6000', debit: 0, credit: mat }] });
  }
  await tx.insert(writeoffDocs).values({
    id, firmId: a.firmId, date: x.to, dateFrom: x.from, dateTo: x.to, mode: x.mode, pct: x.mode === 'pct' ? String(n(x.pct)) : null, total: String(mat),
    locationId: loc, productId: P?.id ?? null, productQty: P ? String(r4(n(x.productQty))) : null, lines: docLines, createdBy: a.userId,
  });
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'writeoff_doc', sourceId: id, moves, date: x.to, description: label, userId: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rnPost', entityType: 'writeoff_doc', entityId: id, data: { total: mat, lines: docLines.length, product: P?.id } });
  return { id, total: mat };
}

export async function deleteWriteoff(tx: Tx, a: Actor, id: string): Promise<void> {
  const [d] = await tx.select().from(writeoffDocs).where(and(eq(writeoffDocs.id, id), eq(writeoffDocs.firmId, a.firmId))).limit(1);
  if (!d) throw new StockDocError('Документот не постои.');
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'writeoff_doc', sourceId: id, userId: a.userId });
  await tx.delete(writeoffDocs).where(eq(writeoffDocs.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rnDel', entityType: 'writeoff_doc', entityId: id, data: { total: d.total, date: d.date } });
}

