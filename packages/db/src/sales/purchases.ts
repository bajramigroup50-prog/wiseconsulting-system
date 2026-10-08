/**
 * Purchases service — save / post / unpost / approve / delete incoming invoices and import calculations with VAT
 * groups, stock lines (приемница) and landed costs (legacy `savePur` 7166 → `purPersist` 4388).
 *
 * Journal (`purchase`, id), kind `vlez` (imports `vlezDev`). Receipt moves (`purchase`, id) carry the stock value
 * incl. landed costs; their booking is part of the purchase journal (legacy `pur-` moves had no lines).
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  calculationRows, finalizeStockLines, purchaseEntries, PostingError as CorePostingError, r2, roundPurchase,
  type CostSlot, type PurchaseCostKey, type PurchaseDoc, type PurchaseLike, type StockItem,
} from '@wise/core';
import { findDuplicate, purchaseTotal } from '@wise/core/sales';
import { audit, type Tx } from '../audit';
import { postJournal, unpostSource } from '../posting';
import {
  fileLinks, files, items, itemSupplierCodes, partners, purchaseCosts, purchases, purchaseStockLines, purchaseVatGroups,
  stockMoves, supplierCredits, type Purchase, type PurchaseData,
} from '../schema/index';
import {
  assertLocation, DocumentError, firmItems, firmPostingContext, loadFirmForUpdate, pendingFor, stockLocations, toStockItem, type Actor,
} from './context';

export const COST_SLOTS = ['car', 't1', 't2', 'sped', 'trans', 'dr', 'dev'] as const;
export interface PurchaseGroupInput { account?: string | null; rate: number | string; base: number | string; vat?: number | string | null }
export interface PurchaseStockInput {
  itemId?: string | null; name?: string | null; code?: string | null; barcode?: string | null; unit?: string | null;
  qty: number | string; price: number | string; rab?: number | string | null; amount?: number | string | null;
  cn?: number | string | null; dep?: number | string | null; sp?: number | string | null;
  /** Line type override (`goods` | `material` | `product`). */
  type?: string | null;
  /** VAT rate for a new item. */
  rate?: number | string | null;
}
export interface PurchaseCostInput {
  amount?: number | string | null; fx?: number | string | null; doc?: string | null; date?: string | null; due?: string | null;
  partnerId?: string | null; byQty?: boolean; foreign?: boolean; lines?: { base?: number | string | null; rate?: number | string | null; vat?: number | string | null }[];
}
export interface PurchaseInput {
  id?: string | null;
  number?: string | null; date: string; docDate?: string | null; due?: string | null;
  partnerId?: string | null; supplierName?: string | null; supplierEdb?: string | null;
  ptype?: 'stock' | 'cost'; art32?: boolean; imp?: boolean; cash?: boolean; noDed?: boolean;
  warehouseId?: string | null; supplierAccount?: string | null; currency?: string | null; fx?: number | string | null;
  calcNo?: string | null; distMode?: 'val' | 'cn' | 'multi'; cnames?: (string | number)[];
  scanned?: boolean; data?: PurchaseData;
  groups: PurchaseGroupInput[];
  stock?: PurchaseStockInput[];
  costs?: Partial<Record<(typeof COST_SLOTS)[number], PurchaseCostInput | null>>;
  /** Uploaded source documents (MinIO `files`) to link. */
  fileIds?: string[];
  /** Save even when the duplicate rule matches. */
  allowDuplicate?: boolean;
}
export interface PurchaseSaveResult { id: string; status: string; warnings: string[]; createdItems: number }

const n = (v: unknown) => Number(v) || 0;
const n4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
const empty = (v: unknown) => v === '' || v == null;

/** Next calculation number per warehouse and year (legacy `nextCalcNo`, 4441): `0001 01`. */
async function nextCalcNo(tx: Tx, firmId: string, wh: string | null, whCode: string, date: string, exceptId: string | null): Promise<string> {
  const rows = await tx.select({ c: purchases.calcNo }).from(purchases).where(and(
    eq(purchases.firmId, firmId), sql`extract(year from ${purchases.date}) = ${Number(date.slice(0, 4))}`,
    wh ? eq(purchases.warehouseId, wh) : sql`${purchases.warehouseId} is null`, eq(purchases.ptype, 'stock'),
    exceptId ? ne(purchases.id, exceptId) : undefined,
  ));
  const mx = rows.reduce((m, r) => Math.max(m, parseInt(r.c ?? '', 10) || 0), 0);
  return String(mx + 1).padStart(4, '0') + ' ' + (whCode || '01');
}

/**
 * Auto-create items for stock lines that name an article not in the catalogue (legacy `createMissingItems`, 4424):
 * code sequence from 1000, sale price = cost × (1 + default margin, 25%). FIX (LEGACY-MAP 3.4 item 3): no hard-coded
 * revenue konto '7400' — the item's revenue konto stays empty and the scheme decides by item type.
 */
async function createMissingItems(tx: Tx, firmId: string, lines: PurchaseStockInput[], defMargin: number, partnerId: string | null): Promise<number> {
  const todo = lines.filter((s) => !s.itemId && String(s.name ?? '').trim() && n(s.qty));
  if (!todo.length) return 0;
  const codes = (await tx.select({ c: items.code }).from(items).where(eq(items.firmId, firmId))).map((r) => r.c ?? '');
  const used = new Set(codes);
  let seq = Math.max(999, ...codes.map((c) => (/^\d+$/.test(c) ? parseInt(c, 10) : 0)));
  const byName = new Map<string, string>();
  let made = 0;
  for (const s of todo) {
    const key = String(s.name).toLowerCase().trim();
    const hit = byName.get(key);
    if (hit) { s.itemId = hit; continue; }
    const own = s.code && !used.has(String(s.code)) && /^\d+$/.test(String(s.code)) ? String(s.code) : String(++seq);
    used.add(own);
    const [it] = await tx.insert(items).values({
      firmId, code: own, name: String(s.name).trim(), type: (['goods', 'material', 'product'].includes(String(s.type)) ? s.type : 'goods') as 'goods',
      unit: s.unit || 'ком', vatRate: n(s.rate) || 18, price: n4(n(s.price) * (1 + defMargin / 100)), data: { aliases: [String(s.name).trim()] },
    }).returning({ id: items.id });
    s.itemId = it!.id;
    byName.set(key, it!.id);
    made++;
  }
  void partnerId;
  return made;
}

async function postPurchase(tx: Tx, f: Parameters<typeof firmPostingContext>[1], pur: Purchase, userId: string | null): Promise<void> {
  const ctx = await firmPostingContext(tx, f);
  const [G, ST, C] = await Promise.all([
    tx.select().from(purchaseVatGroups).where(eq(purchaseVatGroups.purchaseId, pur.id)).orderBy(asc(purchaseVatGroups.lineNo)),
    tx.select().from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, pur.id)).orderBy(asc(purchaseStockLines.lineNo)),
    tx.select().from(purchaseCosts).where(eq(purchaseCosts.purchaseId, pur.id)),
  ]);
  const IT = await firmItems(tx, f.id, ST.map((s) => s.itemId));
  const locs = await stockLocations(tx, f.id);
  const loc = pur.warehouseId ? locs.find((l) => l.id === pur.warehouseId) : undefined;
  const costs: Partial<Record<PurchaseCostKey, CostSlot>> = {};
  for (const c of C) costs[c.slot] = { amt: n(c.amount), fx: c.fx ?? undefined, doc: c.doc ?? undefined, partner: c.partnerId ?? undefined, byQty: c.byQty, foreign: c.foreign, lines: c.lines };
  // Stock values are final (incl. landed costs, whole denars) — the purchase posts them via groups + costs.
  const stock = ST.map((s) => ({ item: s.itemId, qty: n(s.qty), price: n(s.price), rab: n(s.rab), type: (s.type || IT.get(s.itemId)?.type || 'goods') as 'goods' }));
  let retail: PurchaseDoc['retail'];
  const sch = { ...(ctx.global?.sch ?? {}), ...(ctx.firm.sch ?? {}) } as Record<string, unknown>;
  if (stock.length && loc && (loc.kind === 'store' ? sch.retailMethod : sch.whSaleMethod)) {
    const rows = calculationRows({ items: [...IT.values()].map(toStockItem) as StockItem[] }, {
      imp: pur.imp, fx: n(pur.fx), wh: pur.warehouseId ?? undefined, costs: costs as PurchaseLike['costs'], cnames: pur.cnames, distMode: pur.distMode,
      stock: ST.map((s) => ({ item: s.itemId, qty: n(s.qty), price: n(s.price), rab: n(s.rab), cn: s.cn ?? '', dep: s.dep ?? '', sp: s.sp ?? '' })),
    });
    const goods = rows.filter((r) => (IT.get(r.item)?.type ?? 'goods') === 'goods');
    retail = { margin: r2(goods.reduce((a, r) => a + r.marg, 0)), vat: r2(goods.reduce((a, r) => a + r.vat, 0)) };
  }
  let lines;
  try {
    lines = purchaseEntries({
      id: pur.id, date: pur.date, number: pur.number, partner: pur.partnerId ?? undefined, supplierName: pur.supplierName ?? undefined,
      groups: G.map((g) => ({ konto: g.account, rate: g.rate, base: n(g.base), vat: n(g.vat) })), art32: pur.art32, imp: pur.imp, cash: pur.cash,
      noDed: pur.noDed, supKonto: pur.supplierAccount ?? undefined, fx: n(pur.fx), costs, stock, wh: pur.warehouseId ?? undefined, retail,
    }, ctx, loc ? { kind: loc.kind, konto: loc.konto, kMarg: loc.kMarg, kVat: loc.kVat } : null);
  } catch (e) {
    if (e instanceof CorePostingError) throw new DocumentError(e.message);
    throw e;
  }
  await postJournal(tx, {
    firmId: f.id, date: pur.date, kind: pur.imp ? 'vlezDev' : 'vlez', sourceType: 'purchase', sourceId: pur.id, userId,
    description: 'Влезна ф-ра ' + (pur.number || '') + (pur.supplierName ? ' · ' + pur.supplierName : ''),
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: l.note ?? null, doc: pur.number || null, currency: l.cur ?? null, amountCur: l.amtCur ?? null })),
    auditAction: 'postPurchase',
  });
  await tx.delete(stockMoves).where(and(eq(stockMoves.firmId, f.id), eq(stockMoves.sourceType, 'purchase'), eq(stockMoves.sourceId, pur.id)));
  if (ST.length) await tx.insert(stockMoves).values(ST.map((s) => ({
    firmId: f.id, itemId: s.itemId, warehouseId: pur.warehouseId, date: pur.date, qty: s.qty, value: s.value, direction: 'in' as const,
    moveType: 'in', sourceType: 'purchase', sourceId: pur.id, lineNo: s.lineNo, label: 'Влезна ф-ра ' + (pur.number || ''),
  })));
}

async function unpostPurchase(tx: Tx, firmId: string, id: string, userId: string | null) {
  await unpostSource(tx, { firmId, sourceType: 'purchase', sourceId: id, userId });
  await tx.delete(stockMoves).where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.sourceType, 'purchase'), eq(stockMoves.sourceId, id)));
}

/** Purchases of the firm as duplicate candidates (`findDuplicate`). */
async function dupCandidates(tx: Tx, firmId: string, number: string) {
  const digits = number.replace(/\D/g, '');
  const rows = await tx.select({ id: purchases.id, partnerId: purchases.partnerId, number: purchases.number, total: purchases.total, date: purchases.date, edb: partners.edb, sedb: purchases.supplierEdb })
    .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firmId), digits ? sql`regexp_replace(${purchases.number}, '\\D', '', 'g') = ${digits}` : undefined));
  return rows.map((r) => ({ id: r.id, partnerId: r.partnerId, partnerEdb: r.edb ?? r.sedb, number: r.number, total: n(r.total), date: r.date }));
}

/**
 * The same file (sha256) already attached to another document of the firm → that link, else null.
 * Second half of the duplicate detection (the first is `findDuplicate`).
 */
export async function fileAlreadyUsed(tx: Tx, firmId: string, fileIds: readonly string[], except?: { entityType: string; entityId: string }) {
  if (!fileIds.length) return null;
  const F = await tx.select({ sha: files.sha256 }).from(files).where(and(eq(files.firmId, firmId), inArray(files.id, [...fileIds])));
  if (!F.length) return null;
  const [hit] = await tx.select({ entityType: fileLinks.entityType, entityId: fileLinks.entityId, name: files.name }).from(fileLinks)
    .innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(files.firmId, firmId), inArray(files.sha256, F.map((x) => x.sha)), inArray(fileLinks.entityType, ['purchase', 'invoice']),
      except ? sql`not (${fileLinks.entityType} = ${except.entityType} and ${fileLinks.entityId} = ${except.entityId})` : undefined)).limit(1);
  return hit ?? null;
}

/** Save a purchase and book it (pending for klient users). */
export async function savePurchase(tx: Tx, firmId: string, input: PurchaseInput, actor: Actor): Promise<PurchaseSaveResult> {
  const f = await loadFirmForUpdate(tx, firmId);
  const existing = input.id ? (await tx.select().from(purchases).where(and(eq(purchases.id, input.id), eq(purchases.firmId, firmId))).for('update').limit(1))[0] : undefined;
  if (input.id && !existing) throw new DocumentError('Влезната фактура не постои.');
  if (existing && existing.status === 'posted' && pendingFor(actor)) throw new DocumentError('Прокнижен документ не може да се менува од порталот.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DocumentError('Неважечки датум.');
  const warnings: string[] = [];
  const imp = !!input.imp, cash = !imp && !!input.cash, art32 = !!input.art32;
  await assertLocation(tx, firmId, input.warehouseId ?? null);

  let partnerId = input.partnerId || null;
  if (partnerId) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, partnerId), eq(partners.firmId, firmId))).limit(1);
    if (!p) throw new DocumentError('Добавувачот не постои во оваа фирма.');
  } else if (String(input.supplierName ?? '').trim()) {
    // legacy `ensureSupplier`: create the supplier from the read document
    const [p] = await tx.insert(partners).values({ firmId, name: String(input.supplierName).trim(), edb: input.supplierEdb?.trim() || null, foreign: imp }).returning({ id: partners.id });
    partnerId = p!.id;
    warnings.push(`Додаден е нов добавувач „${String(input.supplierName).trim()}“.`);
  } else if (!cash) throw new DocumentError('Изберете добавувач.');

  const groups = input.groups
    .map((g) => ({ account: String(g.account ?? '').trim() || '4000', rate: n(g.rate), base: n(g.base), vat: art32 ? 0 : n(g.vat) }))
    .filter((g) => g.base || g.vat);
  if (!groups.length) throw new DocumentError('Внесете основица во книжењето.');
  for (const g of groups) {
    if (!/^\d{2,10}$/.test(g.account)) throw new DocumentError(`Неважечко конто „${g.account}“.`);
    if (![0, 5, 10, 18].includes(g.rate)) throw new DocumentError(`Неважечка ДДВ стапка ${g.rate}%.`);
  }
  const ptype = input.ptype ?? ((input.stock ?? []).length || imp ? 'stock' : 'cost');
  const stockIn = ptype === 'cost' ? [] : (input.stock ?? []).map((s) => ({ ...s }));
  const defMargin = n((f.settings as Record<string, unknown>)?.defMargin) || 25;
  const createdItems = await createMissingItems(tx, firmId, stockIn, defMargin, partnerId);
  if (createdItems) warnings.push(`Додадени се ${createdItems} нови артикли во шифрарникот.`);
  const stock = stockIn.filter((s) => s.itemId && n(s.qty));
  const IT = await firmItems(tx, firmId, stock.map((s) => s.itemId!));
  for (const s of stock) if (IT.get(s.itemId!)!.type === 'service') throw new DocumentError(`„${IT.get(s.itemId!)!.name}“ е услуга и не оди на залиха.`);

  const total = purchaseTotal({ art32, groups });
  const number = String(input.number ?? '').trim();
  if (!input.allowDuplicate && number) {
    const dup = findDuplicate({ id: existing?.id, partnerId, partnerEdb: input.supplierEdb, number, total }, await dupCandidates(tx, firmId, number));
    if (dup) throw new DocumentError(`Фактурата бр. ${number} од овој добавувач со ист износ веќе е внесена (${dup.date?.split('-').reverse().join('.')}).`);
  }
  if (!input.allowDuplicate && input.fileIds?.length) {
    const used = await fileAlreadyUsed(tx, firmId, input.fileIds, existing ? { entityType: 'purchase', entityId: existing.id } : undefined);
    if (used) throw new DocumentError(`Документот „${used.name}“ веќе е прикачен на друг документ.`);
  }

  const costs: Partial<Record<PurchaseCostKey, CostSlot>> = {};
  for (const k of COST_SLOTS) {
    const c = input.costs?.[k];
    if (!c) continue;
    const lines = (c.lines ?? []).map((l) => ({ base: n(l.base), rate: n(l.rate), vat: n(l.vat) })).filter((l) => l.base || l.vat);
    if (!n(c.amount) && !lines.length) continue;
    costs[k] = { amt: n(c.amount), fx: k === 'dev' ? n(c.fx) || 1 : undefined, doc: c.doc ?? undefined, date: c.date ?? undefined, due: c.due ?? undefined, partner: c.partnerId ?? undefined, byQty: !!c.byQty, foreign: !!c.foreign, lines };
  }
  const p0: PurchaseLike = {
    imp, fx: n(input.fx) || 1, art32, wh: input.warehouseId ?? undefined, costs: costs as PurchaseLike['costs'], cnames: input.cnames ?? [], distMode: input.distMode ?? 'val',
    groups: groups.map((g) => ({ konto: g.account, rate: g.rate, base: g.base, vat: g.vat })),
    stock: stock.map((s) => ({ item: s.itemId!, name: s.name ?? '', code: s.code ?? '', barcode: s.barcode ?? '', amount: n(s.amount), qty: n(s.qty), price: n(s.price), rab: n(s.rab), cn: empty(s.cn) ? '' : n(s.cn), dep: empty(s.dep) ? '' : n(s.dep), sp: empty(s.sp) ? '' : n(s.sp) })),
  };
  const p = roundPurchase(p0);
  const fin = finalizeStockLines(p);
  const W = input.warehouseId || null;
  let calcNo = input.calcNo?.trim() || existing?.calcNo || null;
  if (ptype === 'stock' && !calcNo) {
    const locs = await stockLocations(tx, firmId);
    calcNo = await nextCalcNo(tx, firmId, W, W ? locs.find((l) => l.id === W)?.code ?? '' : '01', input.date, existing?.id ?? null);
  }
  if (ptype === 'cost') calcNo = null;
  const RG = p.groups ?? [];
  const status = pendingFor(actor) ? 'pending' : 'posted';
  const header = {
    firmId, status, number, date: input.date, docDate: input.docDate || null, due: input.due || null, partnerId,
    supplierName: input.supplierName?.trim() || null, supplierEdb: input.supplierEdb?.trim() || null, ptype, art32, imp, cash, noDed: !!input.noDed,
    warehouseId: W, supplierAccount: imp ? input.supplierAccount?.trim() || null : null, currency: (input.currency || (imp ? 'EUR' : 'MKD')).toUpperCase(),
    fx: String(n(input.fx) || 1), calcNo, distMode: input.distMode ?? 'val', cnames: (input.cnames ?? []).map(String),
    base: r2(RG.reduce((a, g) => a + n(g.base), 0)).toFixed(2), vat: r2(RG.reduce((a, g) => a + n(g.vat), 0)).toFixed(2),
    total: purchaseTotal({ art32, groups: RG.map((g) => ({ base: n(g.base), vat: n(g.vat) })) }).toFixed(2),
    scanned: !!input.scanned || !!existing?.scanned, data: input.data ?? {}, updatedBy: actor.userId,
  } satisfies Partial<typeof purchases.$inferInsert>;
  let pur: Purchase;
  if (existing) {
    [pur] = await tx.update(purchases).set(header).where(eq(purchases.id, existing.id)).returning() as [Purchase];
    await tx.delete(purchaseVatGroups).where(eq(purchaseVatGroups.purchaseId, pur.id));
    await tx.delete(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, pur.id));
    await tx.delete(purchaseCosts).where(eq(purchaseCosts.purchaseId, pur.id));
  } else [pur] = await tx.insert(purchases).values({ ...header, createdBy: actor.userId }).returning() as [Purchase];
  await tx.insert(purchaseVatGroups).values(RG.map((g, i) => ({ purchaseId: pur.id, lineNo: i + 1, account: String(g.konto), rate: n(g.rate), base: n(g.base).toFixed(2), vat: n(g.vat).toFixed(2) })));
  if (fin.length) await tx.insert(purchaseStockLines).values(fin.map((s, i) => {
    const src = stock[i];
    return {
      purchaseId: pur.id, lineNo: i + 1, itemId: s.item, name: s.name || null, code: s.code || null, barcode: s.barcode || null, qty: n4(s.qty), price: n4(s.price),
      rab: n4(s.rab), amount: s.amount ? s.amount.toFixed(2) : null, cn: s.cn === '' ? null : n(s.cn), dep: s.dep === '' ? null : r2(s.dep).toFixed(2),
      cvat: r2(s.cvat).toFixed(2), sp: s.sp === '' ? null : n4(s.sp), value: r2(s.value).toFixed(2), type: src?.type || null,
    };
  }));
  const RC = (p.costs ?? {}) as Record<string, CostSlot | null | undefined>;
  const CR = Object.entries(RC).filter((e): e is [string, CostSlot] => !!e[1]);
  if (CR.length) await tx.insert(purchaseCosts).values(CR.map(([slot, c]) => ({
    purchaseId: pur.id, slot: slot as PurchaseCostKey, amount: r2(n(c.amt)).toFixed(2), fx: c.fx != null ? String(c.fx) : null, doc: c.doc || null,
    date: c.date || null, due: c.due || null, partnerId: c.partner || null, byQty: !!c.byQty, foreign: !!c.foreign,
    lines: (c.lines ?? []).filter((l): l is NonNullable<typeof l> => !!l).map((l) => ({ base: n(l.base), rate: n(l.rate), vat: n(l.vat) })),
  })));
  if (input.fileIds?.length) {
    const F = await tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, firmId), inArray(files.id, input.fileIds)));
    if (F.length) await tx.insert(fileLinks).values(F.map((x) => ({ fileId: x.id, entityType: 'purchase', entityId: pur.id, role: 'source' }))).onConflictDoNothing();
  }

  if (status === 'posted') await postPurchase(tx, f, pur, actor.userId);
  else await unpostPurchase(tx, firmId, pur.id, actor.userId);

  // legacy `learnItemCodes`: remember the supplier's article code; `applySalePrices`: new sale prices.
  for (const s of stock) {
    if (partnerId && s.code) await tx.insert(itemSupplierCodes).values({ firmId, itemId: s.itemId!, partnerId, code: String(s.code), name: s.name ?? null }).onConflictDoNothing();
    if (!empty(s.sp) && n(s.sp) > 0) {
      const it = IT.get(s.itemId!)!;
      const locs = W ? await stockLocations(tx, firmId) : [];
      if (W && locs.find((l) => l.id === W)?.kind === 'store') {
        const d = (it.data ?? {}) as Record<string, unknown>;
        await tx.update(items).set({ data: { ...d, sp: { ...((d.sp as Record<string, unknown>) ?? {}), [W]: n(s.sp) } } }).where(eq(items.id, it.id));
        // TODO(phase7): a changed retail price in a store needs a levelling (нивелација) document — Phase 7 owns `nivel`.
      } else {
        await tx.update(items).set({ price: n4(n(s.sp) / (1 + it.vatRate / 100)) }).where(eq(items.id, it.id));
      }
    }
  }
  await audit(tx, { userId: actor.userId, firmId, action: existing ? 'editPur' : 'savePur', entityType: 'purchase', entityId: pur.id,
    data: { number, date: pur.date, status, total: n(pur.total), stockLines: fin.length } });
  return { id: pur.id, status, warnings, createdItems };
}

export async function approvePurchase(tx: Tx, firmId: string, id: string, actor: Actor): Promise<void> {
  if (pendingFor(actor)) throw new DocumentError('Немате право да одобрувате.');
  const f = await loadFirmForUpdate(tx, firmId);
  const [pur] = await tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.firmId, firmId))).for('update').limit(1);
  if (!pur) throw new DocumentError('Влезната фактура не постои.');
  if (pur.status !== 'pending') throw new DocumentError('Документот не чека одобрување.');
  const [u] = await tx.update(purchases).set({ status: 'posted', approvedBy: actor.userId, approvedAt: new Date() }).where(eq(purchases.id, id)).returning();
  await postPurchase(tx, f, u!, actor.userId);
  await audit(tx, { userId: actor.userId, firmId, action: 'approveDoc', entityType: 'purchase', entityId: id, data: { number: pur.number } });
}

export async function deletePurchase(tx: Tx, firmId: string, id: string, actor: Actor): Promise<void> {
  await loadFirmForUpdate(tx, firmId);
  const [pur] = await tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.firmId, firmId))).for('update').limit(1);
  if (!pur) throw new DocumentError('Влезната фактура не постои.');
  if (pendingFor(actor) && pur.status !== 'pending') throw new DocumentError('Прокнижен документ не може да се брише од порталот.');
  const [sc] = await tx.select({ n: supplierCredits.number }).from(supplierCredits).where(eq(supplierCredits.refPurchaseId, id)).limit(1);
  if (sc) throw new DocumentError(`На фактурата се однесува повратница/одобрение ${sc.n} – прво избришете го.`);
  await unpostPurchase(tx, firmId, id, actor.userId);
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, 'purchase'), eq(fileLinks.entityId, id)));
  await tx.delete(purchases).where(eq(purchases.id, id));
  await audit(tx, { userId: actor.userId, firmId, action: 'delPur', entityType: 'purchase', entityId: id, data: { number: pur.number, date: pur.date, total: n(pur.total) } });
}
