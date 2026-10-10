/**
 * Turn a read result into review drafts (legacy `scanFile` / `batchRun` → `draftFromScan` + `batchCheck`, and
 * `outRun` → `outDraft`). Loads the firm's partners, items, duplicates and closed VAT periods.
 */
import { and, eq, sql } from 'drizzle-orm';
import { calcLines, periodOf, schemeValue } from '@wise/core';
import {
  batchStatus, findDuplicate, nextDocNumber, ownerCheck, purchaseDraftFromScan, purchaseTotal, saleDraftFromScan, scanInvoices,
  type MatchItem, type ScanResult,
} from '@wise/core/sales';
import {
  firmPostingContext, invoices, itemBarcodes, items, itemSupplierCodes, journals, partners, purchases,
  type AiDraft, type Firm, type Tx,
} from '@wise/db';

export async function matchData(db: Tx, firmId: string) {
  const [P, I, B, C] = await Promise.all([
    db.select({ id: partners.id, name: partners.name, edb: partners.edb }).from(partners).where(eq(partners.firmId, firmId)),
    db.select().from(items).where(and(eq(items.firmId, firmId), eq(items.active, true))),
    db.select().from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId)),
    db.select().from(itemSupplierCodes).where(eq(itemSupplierCodes.firmId, firmId)),
  ]);
  const its: MatchItem[] = I.map((i) => ({
    id: i.id, name: i.name, code: i.code, type: i.type, unit: i.unit, rate: i.vatRate,
    barcodes: B.filter((b) => b.itemId === i.id).map((b) => b.barcode),
    aliases: ((i.data as Record<string, unknown>).aliases as string[] | undefined) ?? [],
    supCodes: Object.fromEntries(C.filter((c) => c.itemId === i.id).map((c) => [c.partnerId ?? '', c.code])),
  }));
  return { partners: P, items: its };
}

export async function purchaseDrafts(db: Tx, f: Firm, r: ScanResult, opts: { cash?: boolean; warehouseId?: string | null; costOnly?: boolean }): Promise<AiDraft[]> {
  const ctx = await firmPostingContext(db, f);
  const M = await matchData(db, f.id);
  const closed = new Set((await db.select({ d: journals.date }).from(journals).where(and(eq(journals.firmId, f.id), eq(journals.kind, 'ddv'))))
    .map((j) => periodOf(j.d, f.vatPeriod)));
  const today = new Date().toISOString().slice(0, 10);
  const prev = await db.select({ id: purchases.id, partnerId: purchases.partnerId, number: purchases.number, total: purchases.total, date: purchases.date, edb: partners.edb })
    .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(eq(purchases.firmId, f.id));
  const cand = prev.map((p) => ({ ...p, partnerEdb: p.edb, total: Number(p.total) }));
  const s = (f.settings ?? {}) as Record<string, unknown>;
  return scanInvoices(r).map((x) => {
    const d = purchaseDraftFromScan(x, {
      ...M, today, cash: opts.cash, warehouseId: opts.warehouseId ?? null, costOnly: opts.costOnly,
      accounts: { goods: schemeValue(ctx, 'stock'), material: schemeValue(ctx, 'material'), other: schemeValue(ctx, 'purDefault') },
      defMargin: Number(s.defMargin) || 25, mgRound: Number(s.mgRound) || 1,
      vatClosed: (dt) => closed.has(periodOf(dt, f.vatPeriod)),
    });
    const dup = findDuplicate({ partnerId: d.partnerId || null, partnerEdb: d.supplierEdb, number: d.number, total: purchaseTotal(d) }, cand);
    const st = batchStatus(d, x, dup, ownerCheck('purchase', x, f.edb));
    return { draft: d as unknown as Record<string, unknown>, ...st };
  });
}

export async function saleDrafts(db: Tx, f: Firm, r: ScanResult): Promise<AiDraft[]> {
  const ctx = await firmPostingContext(db, f);
  const M = await matchData(db, f.id);
  const today = new Date().toISOString().slice(0, 10);
  const used = (await db.select({ n: invoices.number }).from(invoices).where(and(eq(invoices.firmId, f.id), eq(invoices.kind, 'invoice'),
    sql`extract(year from ${invoices.date}) = ${Number(today.slice(0, 4))}`))).map((x) => x.n);
  const out: AiDraft[] = [];
  const fm = (v: number) => v.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const x of scanInvoices(r)) {
    const d = saleDraftFromScan(x, { ...M, revKonto: schemeValue(ctx, 'revDefault'), today, nextNumber: nextDocNumber(used, today.slice(0, 4)) });
    // legacy `outCheck` (8402): existing number → „веќе внесена“; a new buyer alone does not block „спремна“
    const why: string[] = [];
    const dup = used.some((u) => String(u).trim() === d.number.trim());
    if (dup) why.push('бројот ' + d.number + ' веќе постои');
    used.push(d.number);
    if (!d.partnerId) why.push(d.buyer.name ? 'нов купувач: ' + d.buyer.name : 'купувачот не е препознаен');
    const c = calcLines(d.items, d.art32);
    if (d.total && Math.abs(c.total - d.total) > Math.max(2, d.total * 0.005)) why.push('износот не се совпаѓа (' + fm(c.total) + ' / ' + fm(d.total) + ')');
    const free = d.items.filter((l) => !l.itemId && Number(l.qty) && !/услуг|транспорт|превоз/i.test(l.name)).length;
    if (free) why.push(free + ' ставки не се поврзани со артикл');
    if (!d.items.length) why.push('нема ставки');
    const own = ownerCheck('sale', x, f.edb);
    if (own) why.push(own);
    const status = dup ? 'dup' : why.some((m) => !m.startsWith('нов купувач')) ? 'check' : 'ok';
    out.push({ draft: { ...d, calcTotal: c.total } as unknown as Record<string, unknown>, status, msg: why.join(' · ') });
  }
  return out;
}
