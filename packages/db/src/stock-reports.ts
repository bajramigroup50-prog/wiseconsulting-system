/**
 * Read side of Phase 7: daily sales as the trade books / КДФИ / DFI control read them, and the move → document
 * resolver for the ЕТ form and МЕТГ (legacy `moveDoc`, here by `stock_moves.source_type` / `source_id`).
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { plainMoveDoc, purchaseBookTotals, transferBookTotals, type BookPurchase, type BookSales, type FiscalSales, type MoveDocResolver } from '@wise/core';
import type { Tx } from './audit';
import { inArray } from 'drizzle-orm';
import {
  invoices, partners, productionOrders, purchaseCosts, purchases, purchaseStockLines, salesDaily, stockCounts, transfers,
} from './schema/index';
import { parseMoveSrc, whId, type LoadedStock } from './stock-service';

export type StockSales = BookSales & FiscalSales;

/** Daily sales of a firm (optionally in a date range) in the core `BookSales` / `FiscalSales` shape. */
export async function loadStockSales(tx: Tx, firmId: string, range?: { from?: string; to?: string }): Promise<StockSales[]> {
  const rows = await tx.select().from(salesDaily).where(and(
    eq(salesDaily.firmId, firmId), eq(salesDaily.pending, false),
    range?.from ? gte(salesDaily.date, range.from) : undefined, range?.to ? lte(salesDaily.date, range.to) : undefined,
  )).orderBy(asc(salesDaily.date), asc(salesDaily.createdAt));
  return rows.map((s) => ({
    // POS days look like legacy `z-…` documents (DFI control treats them as POS, not as fiscal-device reports)
    id: (s.kind === 'pos' ? 'z-' : 'zf-') + s.id,
    date: s.date,
    wh: whId(s.locationId),
    total: Number(s.total),
    groups: s.groups,
    mk: s.mk ?? undefined,
    days: s.days ?? undefined,
    fisk: s.kind === 'fisk' ? { ...(s.fisk ?? {}), z: s.fisk?.z ?? s.number ?? undefined } : undefined,
  }));
}

/**
 * Move → document for the ЕТ form and МЕТГ. Transfers are booked as a whole document (purchase / sale value), stock
 * counts and write-offs as retail output, POS / fiscal issues as "Каса", purchases as their ПЛТ (col. 5/6 totals),
 * invoices, credit notes and dispatch notes by their number and partner; anything else falls back to the move label.
 */
export async function stockDocResolver(tx: Tx, L: LoadedStock): Promise<MoveDocResolver> {
  const firmId = L.firm.id;
  const [tr, sc, po, sd] = await Promise.all([
    tx.select().from(transfers).where(eq(transfers.firmId, firmId)),
    tx.select().from(stockCounts).where(eq(stockCounts.firmId, firmId)),
    tx.select().from(productionOrders).where(eq(productionOrders.firmId, firmId)),
    tx.select({ id: salesDaily.id, kind: salesDaily.kind, number: salesDaily.number, date: salesDaily.date }).from(salesDaily).where(eq(salesDaily.firmId, firmId)),
  ]);
  // Phase 3 documents: purchases (ПЛТ totals for ЕТ col. 5/6), invoices / credit notes and dispatch notes.
  const [pu, iv, pn] = await Promise.all([
    tx.select().from(purchases).where(eq(purchases.firmId, firmId)),
    tx.select({ id: invoices.id, kind: invoices.kind, number: invoices.number, date: invoices.date, partnerId: invoices.partnerId }).from(invoices).where(eq(invoices.firmId, firmId)),
    tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firmId)),
  ]);
  const PU = new Map(pu.map((x) => [x.id, x]));
  const IV = new Map(iv.map((x) => [x.id, x]));
  const PN = new Map(pn.map((x) => [x.id, x.name]));
  const purTotals = new Map<string, { nab: number; sp: number }>();
  const loadPurTotals = async () => {
    const ids = pu.map((p) => p.id);
    if (!ids.length) return;
    const [st, cs] = await Promise.all([
      tx.select().from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, ids)),
      tx.select().from(purchaseCosts).where(inArray(purchaseCosts.purchaseId, ids)),
    ]);
    for (const p of pu) {
      const bp: BookPurchase = {
        id: p.id, calcNo: p.calcNo ?? undefined, number: p.number, date: p.date, docDate: p.docDate ?? undefined, art32: p.art32, imp: p.imp, fx: Number(p.fx),
        wh: whId(p.warehouseId), cnames: p.cnames, distMode: p.distMode,
        costs: Object.fromEntries(cs.filter((c) => c.purchaseId === p.id).map((c) => [c.slot, { amt: Number(c.amount), fx: c.fx ?? undefined, byQty: c.byQty, lines: c.lines }])),
        stock: st.filter((x) => x.purchaseId === p.id).map((x) => ({ item: x.itemId, qty: Number(x.qty), price: Number(x.price), rab: Number(x.rab), cn: x.cn ?? '', dep: x.dep ?? '', sp: x.sp ?? '' })),
      };
      purTotals.set(p.id, purchaseBookTotals(L.ctx, bp));
    }
  };
  await loadPurTotals();
  const T = new Map(tr.map((x) => [x.id, x]));
  const C = new Map(sc.map((x) => [x.id, x]));
  const P = new Map(po.map((x) => [x.id, x]));
  const Z = new Map(sd.map((x) => [x.id, x]));
  const totals = new Map<string, { nab: number; sp: number }>();
  return (m) => {
    const s = parseMoveSrc(m.src);
    if (!s) return plainMoveDoc(m);
    // `src` of document lines is `<prefix>-<id>-<line>`; document ids are uuids (36 chars)
    const id = s.sourceId.slice(0, 36);
    if (s.sourceType === 'transfer' && T.has(id)) {
      const d = T.get(id)!;
      if (!totals.has(id))
        totals.set(id, transferBookTotals(L.ctx, { id, number: d.number, date: d.date, from: whId(d.fromLocationId), to: whId(d.toLocationId), lines: d.lines.map((l) => ({ item: l.itemId, qty: l.qty, nabU: l.nabU ?? 0, sp: l.sp ?? null })) }));
      return { key: 'prn-' + id, no: 'Преносница ' + d.number, name: Number(m.qty) > 0 ? 'од ' + L.locName(d.fromLocationId) : 'во ' + L.locName(d.toLocationId), ddate: d.date, inTotals: totals.get(id) };
    }
    if (s.sourceType === 'stock_count' && C.has(id)) {
      const d = C.get(id)!;
      return { key: 'mo-' + id, no: (d.kind === 'count' ? 'Попис ' : 'Отпис ') + d.number, name: L.locName(d.locationId), ddate: d.date, mo: true };
    }
    if (s.sourceType === 'production' && P.has(id)) {
      const d = P.get(id)!;
      return { key: 'prod-' + id, no: 'Работен налог ' + d.number, name: L.locName(d.locationId), ddate: d.date };
    }
    if (s.sourceType === 'sales_daily' && Z.has(id)) {
      const d = Z.get(id)!;
      return { key: 'pos-' + id, no: d.kind === 'pos' ? 'Каса' : 'Дн. фин. изв.' + (d.number ? ' Z бр. ' + d.number : ''), name: L.locName(m.wh), ddate: d.date };
    }
    if (s.sourceType === 'purchase' && PU.has(id)) {
      const p = PU.get(id)!;
      return {
        key: 'pur-' + id, no: 'Од ПЛТ бр. ' + (p.calcNo || p.number || '') + (p.calcNo && p.number && p.calcNo !== p.number ? ' (ф-ра ' + p.number + ')' : ''),
        name: (p.partnerId && PN.get(p.partnerId)) || p.supplierName || 'Добавувач', ddate: p.docDate || p.date, inTotals: purTotals.get(id),
      };
    }
    if ((s.sourceType === 'invoice' || s.sourceType === 'dispatch') && IV.has(id)) {
      const d = IV.get(id)!;
      const title = d.kind === 'dispatch' ? 'Испратница ' : d.kind === 'credit' ? 'Повратница ' : 'Фактура ';
      return { key: (d.kind === 'dispatch' ? 'isp-' : 'inv-') + id, no: title + d.number, name: (d.partnerId && PN.get(d.partnerId)) || 'Купувач', ddate: d.date, ...(d.kind === 'credit' ? { mo: true } : {}) };
    }
    return plainMoveDoc(m);
  };
}
