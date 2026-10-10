import 'server-only';
/**
 * Server helpers of the stock, materials & retail screens: items as `Retail.CleanItem` (barcodes, aliases, move counts),
 * firm settings, customer-order reservations and supplier on-order quantities.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { Retail, stock } from '@wise/core';
import {
  customerOrders, itemBarcodes, items, lastSuppliers, orderDeliveries, stockMoves, supplierOrders, type Firm, type LoadedStock, type Tx,
} from '@wise/db';

export type ArtItem = Retail.CleanItem & { price: number; rate: number; rawK: string | null; costPrice: string | null; costPct: string | null; min: number };

/** Items of a firm with barcodes and aliases, and a move counter (legacy `artPickMaster` tie-breaker). */
export async function loadArtItems(tx: Tx, firmId: string): Promise<{ items: ArtItem[]; movesOf: (id: string) => number }> {
  const [its, bcs, mv] = await Promise.all([
    tx.select().from(items).where(eq(items.firmId, firmId)).orderBy(asc(items.name)),
    tx.select({ itemId: itemBarcodes.itemId, b: itemBarcodes.barcode, p: itemBarcodes.primary }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId)),
    tx.select({ itemId: stockMoves.itemId, n: sql<number>`count(*)::int` }).from(stockMoves).where(eq(stockMoves.firmId, firmId)).groupBy(stockMoves.itemId),
  ]);
  const B = new Map<string, string[]>();
  for (const b of bcs.sort((x, y) => Number(y.p) - Number(x.p))) B.set(b.itemId, [...(B.get(b.itemId) ?? []), b.b]);
  const M = new Map(mv.map((r) => [r.itemId, r.n]));
  return {
    items: its.map((i) => ({
      id: i.id, code: i.code, name: i.name, unit: i.unit, type: i.type, price: Number(i.price ?? 0), rate: i.vatRate, active: i.active,
      barcodes: B.get(i.id) ?? [], aliases: ((i.data as Record<string, unknown>).aliases as string[] | undefined) ?? [], rawK: i.rawAccount,
      costPrice: i.costPrice, costPct: i.costPct, min: Number(i.minStock ?? 0),
    })),
    movesOf: (id) => M.get(id) ?? 0,
  };
}

export const settingsOf = (f: Firm): Record<string, unknown> => (f.settings ?? {}) as Record<string, unknown>;

/** Reserved quantities of open customer orders and on-order quantities of open supplier orders, per item. */
export async function reservations(tx: Tx, firmId: string): Promise<{ reserved: Map<string, number>; onOrder: Map<string, number>; deliveries: Map<string, Record<string, number>> }> {
  const [ords, pos, deliveries] = await Promise.all([
    tx.select().from(customerOrders).where(eq(customerOrders.firmId, firmId)),
    tx.select().from(supplierOrders).where(eq(supplierOrders.firmId, firmId)),
    orderDeliveries(tx, firmId),
  ]);
  const reserved = Retail.reservedByItem(ords.map((o) => ({ id: o.id, status: o.status, lines: o.lines })), (id) => deliveries.get(id) ?? {});
  const onOrder = Retail.onOrderByItem(pos.map((p) => ({ status: p.status, lines: p.lines })));
  return { reserved, onOrder, deliveries };
}

/** Items for the order editors: price, VAT, stock (all locations), available = stock − reserved, last purchase price. */
export async function orderItemOptions(tx: Tx, L: LoadedStock, reserved: ReadonlyMap<string, number>, own?: readonly { itemId: string | null; qty: number }[]) {
  const last = await lastSuppliers(tx, L.firm.id);
  const mine = new Map<string, number>();
  for (const l of own ?? []) if (l.itemId) mine.set(l.itemId, (mine.get(l.itemId) ?? 0) + l.qty);
  return [...L.items.values()].filter((i) => i.active).map((i) => {
    const q = i.type === 'service' ? 0 : stock(L.ctx, i.id).qty;
    return {
      id: i.id, code: i.code ?? '', name: i.name, unit: i.unit ?? 'ком', price: Number(i.price ?? 0), rate: i.vatRate, service: i.type === 'service',
      stock: q, avail: Math.round((q - (reserved.get(i.id) ?? 0) + (mine.get(i.id) ?? 0)) * 1e4) / 1e4, last: last.get(i.id)?.price ?? 0,
    };
  }).sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, 'mk', { numeric: true }));
}
