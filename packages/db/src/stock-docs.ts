/**
 * Stock documents (Phase 7): transfers, levelling, stock counts / write-offs, daily sales (POS / Z / fiscal
 * reports), bills of materials, production orders and re-averaging. Each `save*` validates, writes the document,
 * its `stock_moves` and its journal(s), and an audit row — all inside the caller's transaction. Deleting a document
 * removes its moves and un-posts its journals. Period locks are enforced for old and new dates.
 *
 * The pure computations come from `@wise/core` (`postTransfer`, `levellingLines`/`levellingEntries`, `postOut`/
 * `postIn`, `dailySalesTotals`, `saleEntries`/`fiskEntries`, `runProduction`, `reaverage`).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { r2, r4 } from '@wise/core/stock/num';
import {
  bomCycle, cogsAccount, dailySalesTotals, fiskEntries, levellingEntries, levellingLines, levellingReversal, nextYearNumber, postIn,
  postOut, postTransfer, priceAt, productionNeeds, reaverage, runProduction, salesVatBases, schemeValue, stockAt, transferShortages, vbLines,
  type FiscalSchemeKey, type JournalLine, type LevellingDoc, type ProductionRecord, type SalesDoc, type StockContext, type StockItem,
  type StockMove,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { assertOpenPeriod, postJournal, unpostSource } from './posting';
import {
  boms, fileLinks, files, firms, journals, levellingDocs, productionOrders, salesDaily, stockCounts, stockMoves, transfers,
  type LevellingDocLine, type SalesDayRow, type SalesFiskInfo, type SalesGroupRow, type SalesItemLine, type StockCountLine,
  type TransferLine,
} from './schema/index';
import {
  StockDocError, dbLoc, ensurePosPartner, loadStockContext, removeSourceMoves, replaceSourceMoves, repostSourceMoves, requireLocation,
  requireTracked, setRetailPrices, whId, type LoadedStock,
} from './stock-service';

export interface Actor { firmId: string; userId: string | null }

const ACCOUNT_RE = /^\d{3,10}$/;
const fq = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const yearOf = (d: string) => d.slice(0, 4);
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function needDate(d: string): void {
  if (!isDate(d)) throw new StockDocError('Неважечки датум.');
}

/** Load an existing document of the firm or fail. */
async function own<T extends { firmId: string }>(rows: Promise<T[]>, what: string): Promise<T> {
  const [r] = await rows;
  if (!r) throw new StockDocError(`${what} не постои.`);
  return r;
}

/** Push moves into a live context so the next issue sees them (legacy sequential `await postOut`). */
const withMoves = (ctx: StockContext, ms: readonly StockMove[]): StockContext => ({ ...ctx, moves: [...ctx.moves, ...ms] });

/* ================================================================== transfers (преносници) */

export interface TransferInput {
  id?: string | null;
  date: string;
  from?: string | null;
  to?: string | null;
  /** `sp` = retail price incl. VAT at the destination (default: the item's current price there). */
  lines: readonly { itemId: string; qty: number; sp?: number | null }[];
  note?: string | null;
}

/**
 * Save a transfer warehouse → store (legacy `ACT.prSave` 17396): stock check at the source on the date, issue at
 * average cost from the source, receipt at the destination with `transferLines` (retail-value stores: D 6630 / C stock /
 * C 6694 / C 6640), retail prices of the destination updated (legacy `applySalePrices`).
 */
export async function saveTransfer(tx: Tx, a: Actor, input: TransferInput): Promise<{ id: string; number: string }> {
  needDate(input.date);
  const prev = input.id ? await own(tx.select().from(transfers).where(and(eq(transfers.id, input.id), eq(transfers.firmId, a.firmId))).limit(1), 'Преносницата') : null;
  const L = await loadStockContext(tx, a.firmId, prev ? { excludeSource: { sourceType: 'transfer', sourceId: prev.id } } : {});
  assertOpenPeriod(L.firm, input.date);
  if (prev) assertOpenPeriod(L.firm, prev.date);
  const from = requireLocation(L, input.from);
  const to = requireLocation(L, input.to);
  if (from === to) throw new StockDocError('Изберете различни објекти.');
  const lines = input.lines.filter((l) => l.itemId && r4(l.qty) > 0);
  if (!lines.length) throw new StockDocError('Внесете количина барем за еден артикл.');
  const its = lines.map((l) => requireTracked(L, l.itemId));
  const short = transferShortages(L.ctx, whId(from), input.date, lines.map((l) => ({ item: l.itemId, qty: l.qty })));
  if (short.length) {
    const nm = (id: string) => L.items.get(id)?.name ?? id;
    throw new StockDocError(`Нема доволно залиха во ${L.locName(from)} за ${short.length} артикли: ${short.slice(0, 3).map((s) => `${nm(s.item)} (има ${fq(s.have)}, бара ${fq(s.need)})`).join('; ')}${short.length > 3 ? ' …' : ''}`);
  }
  let number = prev?.number ?? '';
  if (!prev || yearOf(prev.date) !== yearOf(input.date)) {
    const ex = await tx.select({ number: transfers.number, date: transfers.date }).from(transfers).where(eq(transfers.firmId, a.firmId));
    number = nextYearNumber(ex, yearOf(input.date), 4);
  }
  const head = { date: input.date, fromLocationId: from, toLocationId: to, number, note: input.note?.trim() || null };
  const id = prev
    ? (await tx.update(transfers).set(head).where(eq(transfers.id, prev.id)).returning({ id: transfers.id }))[0]!.id
    : (await tx.insert(transfers).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: transfers.id }))[0]!.id;
  let live = L.ctx;
  const moves: StockMove[] = [];
  const docLines: TransferLine[] = [];
  lines.forEach((l, i) => {
    const r = postTransfer(live, {
      item: its[i]!, qty: r4(l.qty), date: input.date, from: whId(from), to: whId(to), src: 'prn-' + id,
      outLabel: `Преносница ${number} → ${L.locName(to)}`, inLabel: `Преносница ${number} од ${L.locName(from)}`,
      retailUnitPrice: l.sp, lineIndex: i,
    });
    moves.push(r.out, r.in);
    live = withMoves(live, [r.out, r.in]);
    docLines.push({ itemId: l.itemId, qty: r4(l.qty), nabU: r.unitCost, sp: r.retailUnitPrice });
  });
  await tx.update(transfers).set({ lines: docLines }).where(eq(transfers.id, id));
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'transfer', sourceId: id, moves, date: input.date, description: `Преносница ${number}: ${L.locName(from)} → ${L.locName(to)}`, userId: a.userId });
  const sp = new Map<string, number>();
  for (const l of lines) if (l.sp != null && Number.isFinite(l.sp)) sp.set(l.itemId, r2(l.sp));
  await setRetailPrices(tx, a.firmId, whId(to), sp);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'prSave', entityType: 'transfer', entityId: id, data: { number, date: input.date, from, to, lines: docLines.length, edit: !!prev } });
  return { id, number };
}

export async function deleteTransfer(tx: Tx, a: Actor, id: string): Promise<void> {
  const row = await own(tx.select().from(transfers).where(and(eq(transfers.id, id), eq(transfers.firmId, a.firmId))).limit(1), 'Преносницата');
  await assertDocOpen(tx, a.firmId, row.date);
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'transfer', sourceId: id, userId: a.userId });
  await tx.delete(transfers).where(eq(transfers.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'prDel', entityType: 'transfer', entityId: id, data: { number: row.number, date: row.date } });
}

async function assertDocOpen(tx: Tx, firmId: string, date: string): Promise<LoadedStock['firm']> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) throw new StockDocError('Фирмата не постои.');
  assertOpenPeriod(f, date);
  return f;
}

/* ================================================================== levelling (нивелација) */

export interface LevellingInput {
  id?: string | null;
  date: string;
  wh?: string | null;
  /** New retail price incl. VAT per item id. */
  prices: Readonly<Record<string, number | null | undefined>>;
  /** Imported quantities (Excel) per item; otherwise stock at the date. */
  qty?: Readonly<Record<string, number>>;
  /** Imported old prices per item; otherwise the current retail price. */
  old?: Readonly<Record<string, number>>;
  note?: string | null;
  /** Promotion until this date: an automatic price-back levelling is created for the next day. */
  promoTo?: string | null;
  /** "Today", for the current retail price on the items. */
  today: string;
}

const toCoreLevelling = (d: { id: string; number: string; date: string; locationId: string | null; lines: LevellingDocLine[] }): LevellingDoc => ({
  id: d.id, number: d.number, date: d.date, wh: whId(d.locationId), lines: d.lines.map((l) => ({ item: l.itemId, qty: l.qty, old: l.old, new: l.new })),
});

async function postLevelling(tx: Tx, a: Actor, ctx: StockContext, doc: LevellingDoc & { id: string }, locId: string | null): Promise<void> {
  const L = levellingEntries(ctx, doc);
  const src = { firmId: a.firmId, sourceType: 'levelling', sourceId: doc.id, userId: a.userId };
  if (!L.length) {
    await unpostSource(tx, src);
    return;
  }
  await postJournal(tx, { ...src, date: doc.date, kind: 'zaliha', description: `Нивелација ${doc.number ?? ''}`, lines: L.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, locationId: locId })) });
}

/** Current retail price per item at a location from the levellings (legacy `priceAt` on `today`), with a fallback. */
async function refreshRetailPrices(tx: Tx, firmId: string, wh: string, itemIds: readonly string[], today: string, fallback: ReadonlyMap<string, number>): Promise<void> {
  const docs = (await tx.select().from(levellingDocs).where(eq(levellingDocs.firmId, firmId)))
    .filter((d) => whId(d.locationId) === wh)
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const out = new Map<string, number>();
  for (const id of itemIds) {
    let p: number | null = null;
    for (const d of docs) {
      const l = d.lines.find((x) => x.itemId === id);
      if (!l) continue;
      if (d.date <= today) p = Number(l.new);
      else {
        if (p == null) p = Number(l.old);
        break;
      }
    }
    const v = p ?? fallback.get(id);
    if (v != null) out.set(id, v);
  }
  await setRetailPrices(tx, firmId, wh, out);
}

/**
 * Save a levelling (legacy `ACT.saveNivel` 13211 / correction 17188): one line per item whose price changes,
 * quantity = stock at the date (corrected `stockAt`), posted with `levellingEntries` where the location is kept at retail
 * value, item retail prices updated; with `promoTo` the price-back levelling is created for the day after.
 */
export async function saveLevelling(tx: Tx, a: Actor, input: LevellingInput): Promise<{ id: string; number: string; backNumber?: string }> {
  needDate(input.date);
  const prev = input.id ? await own(tx.select().from(levellingDocs).where(and(eq(levellingDocs.id, input.id), eq(levellingDocs.firmId, a.firmId))).limit(1), 'Нивелацијата') : null;
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, input.date);
  if (prev) assertOpenPeriod(L.firm, prev.date);
  const loc = requireLocation(L, input.wh);
  const W = whId(loc);
  // when correcting, the old prices are those of the document (not today's price, which the levelling itself set)
  const old: Record<string, number> = { ...(prev ? Object.fromEntries(prev.lines.map((l) => [l.itemId, l.old])) : {}), ...(input.old ?? {}) };
  const ctx: StockContext = prev ? { ...L.ctx, levellings: (L.ctx.levellings ?? []).filter((d) => d.id !== prev.id) } : L.ctx;
  const lines = levellingLines(ctx, { wh: W, prices: input.prices, qty: input.qty, old }, input.date);
  if (!lines.length) throw new StockDocError(prev ? 'Нема ставки – за бришење користете 🗑.' : 'Внесете барем една нова цена.');
  for (const l of lines) requireTracked(L, l.item);
  const docLines: LevellingDocLine[] = lines.map((l) => ({ itemId: l.item, qty: l.qty, old: l.old, new: l.new, ...(l.qtyImp ? { qtyImp: true } : {}) }));
  const existing = await tx.select({ number: levellingDocs.number, date: levellingDocs.date }).from(levellingDocs).where(eq(levellingDocs.firmId, a.firmId));
  const number = prev && yearOf(prev.date) === yearOf(input.date) ? prev.number : nextYearNumber(existing, yearOf(input.date));
  const promoTo = !prev && input.promoTo && input.promoTo >= input.date ? input.promoTo : null;
  const head = { number, date: input.date, locationId: loc, lines: docLines, note: input.note?.trim() || (promoTo ? `Акција до ${promoTo.split('-').reverse().join('.')}` : null), promoTo };
  const id = prev
    ? (await tx.update(levellingDocs).set(head).where(eq(levellingDocs.id, prev.id)).returning({ id: levellingDocs.id }))[0]!.id
    : (await tx.insert(levellingDocs).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: levellingDocs.id }))[0]!.id;
  const doc = { id, number, date: input.date, wh: W, lines };
  await postLevelling(tx, a, ctx, doc, loc);
  let backNumber: string | undefined;
  if (promoTo) {
    const rev = levellingReversal(doc, promoTo)!;
    backNumber = nextYearNumber([...existing, { number, date: input.date }], yearOf(rev.date));
    const [b] = await tx.insert(levellingDocs).values({
      firmId: a.firmId, number: backNumber, date: rev.date, locationId: loc, note: rev.note ?? null, promoBackOf: number, createdBy: a.userId,
      lines: rev.lines.map((l) => ({ itemId: l.item, qty: l.qty, old: l.old, new: l.new })),
    }).returning({ id: levellingDocs.id });
    await postLevelling(tx, a, ctx, { ...rev, id: b!.id, number: backNumber }, loc);
  }
  await refreshRetailPrices(tx, a.firmId, W, lines.map((l) => l.item), input.today, new Map(lines.map((l) => [l.item, l.new])));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveNivel', entityType: 'levelling', entityId: id, data: { number, date: input.date, wh: W, lines: lines.length, edit: !!prev, backNumber } });
  return { id, number, backNumber };
}

export async function deleteLevelling(tx: Tx, a: Actor, id: string, today: string): Promise<void> {
  const row = await own(tx.select().from(levellingDocs).where(and(eq(levellingDocs.id, id), eq(levellingDocs.firmId, a.firmId))).limit(1), 'Нивелацијата');
  await assertDocOpen(tx, a.firmId, row.date);
  await unpostSource(tx, { firmId: a.firmId, sourceType: 'levelling', sourceId: id, userId: a.userId });
  await tx.delete(levellingDocs).where(eq(levellingDocs.id, id));
  await refreshRetailPrices(tx, a.firmId, whId(row.locationId), row.lines.map((l) => l.itemId), today, new Map(row.lines.map((l) => [l.itemId, l.old])));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'nivDel', entityType: 'levelling', entityId: id, data: { number: row.number, date: row.date } });
}

/* ================================================================== stock counts (попис) and write-offs (отпис) */

export interface StockCountInput {
  id?: string | null;
  kind: 'count' | 'writeoff';
  date: string;
  wh?: string | null;
  /** Debit account of shortages / write-offs (default 4690). */
  shortageAccount?: string | null;
  /** Credit account of surpluses (default 7690). */
  surplusAccount?: string | null;
  /** Count: counted quantity `cnt`; write-off: `qty`. */
  lines: readonly { itemId: string; cnt?: number | null; qty?: number | null }[];
  note?: string | null;
}

const MO_PREFIX = { count: 'ПП', writeoff: 'ОТ' } as const;

/** Legacy `moNextNo(t, date)`: `ПП-001/26`, max + 1 within the year. */
export function retailDocNumber(prefix: string, existing: readonly { number: string; date: string }[], date: string): string {
  const y = yearOf(date);
  const mx = existing.filter((x) => x.date.startsWith(y)).reduce((m, x) => Math.max(m, parseInt(x.number.replace(/^\D+/, ''), 10) || 0), 0);
  return `${prefix}-${String(mx + 1).padStart(3, '0')}/${y.slice(2)}`;
}

/**
 * Save a stock count or write-off (legacy `moSaveDoc` 5772, kinds `pop` / `otp`). Count: system quantity = stock at the
 * date, only differing lines are kept; shortages are issued at average cost (D shortage account / C stock), surpluses
 * received at average cost (D stock / C surplus account), both at retail value in retail-value stores. Write-off: issue
 * at average cost to the shortage account, refused when the stock is insufficient.
 */
export async function saveStockCount(tx: Tx, a: Actor, input: StockCountInput): Promise<{ id: string; number: string; lines: number }> {
  needDate(input.date);
  const prev = input.id ? await own(tx.select().from(stockCounts).where(and(eq(stockCounts.id, input.id), eq(stockCounts.firmId, a.firmId))).limit(1), 'Документот') : null;
  const L = await loadStockContext(tx, a.firmId, prev ? { excludeSource: { sourceType: 'stock_count', sourceId: prev.id } } : {});
  assertOpenPeriod(L.firm, input.date);
  if (prev) assertOpenPeriod(L.firm, prev.date);
  const loc = requireLocation(L, input.wh);
  const W = whId(loc);
  const kind = prev?.kind ?? input.kind;
  const shortK = (input.shortageAccount || '4690').trim();
  const surK = (input.surplusAccount || '7690').trim();
  if (!ACCOUNT_RE.test(shortK) || (kind === 'count' && !ACCOUNT_RE.test(surK))) throw new StockDocError('Контото мора да има само цифри.');
  let docLines: StockCountLine[];
  if (kind === 'count') {
    docLines = [];
    for (const l of input.lines) {
      if (!l.itemId || l.cnt == null || !Number.isFinite(l.cnt)) continue;
      const it = requireTracked(L, l.itemId);
      const sys = stockAt(L.ctx, { item: it.id, wh: W, date: input.date }).qty;
      const diff = r4(l.cnt - sys);
      if (Math.abs(diff) > 1e-9) docLines.push({ itemId: it.id, sys, cnt: r4(l.cnt), diff, sp: priceAt(L.ctx, it, W, input.date) });
    }
    if (!docLines.length) throw new StockDocError('Нема разлики меѓу состојбата и пописот.');
  } else {
    docLines = input.lines.filter((l) => l.itemId && r4(l.qty ?? 0) > 0).map((l) => ({ itemId: l.itemId, qty: r4(l.qty ?? 0) }));
    if (!docLines.length) throw new StockDocError('Додадете барем еден артикл со количина.');
    const need = new Map<string, number>();
    for (const l of docLines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty!);
    for (const [id, q] of need) {
      const it = requireTracked(L, id);
      const av = stockAt(L.ctx, { item: id, wh: W, date: input.date }).qty;
      if (q > av + 1e-9) throw new StockDocError(`Нема доволно залиха од „${it.name}“ во ${L.locName(loc)} (има ${fq(av)}).`);
    }
  }
  let number = prev?.number ?? '';
  if (!prev || yearOf(prev.date) !== yearOf(input.date)) {
    const ex = await tx.select({ number: stockCounts.number, date: stockCounts.date }).from(stockCounts).where(and(eq(stockCounts.firmId, a.firmId), eq(stockCounts.kind, kind)));
    number = retailDocNumber(MO_PREFIX[kind], ex, input.date);
  }
  const head = { kind, number, date: input.date, locationId: loc, shortageAccount: shortK, surplusAccount: kind === 'count' ? surK : null, lines: docLines, note: input.note?.trim() || null };
  const id = prev
    ? (await tx.update(stockCounts).set(head).where(eq(stockCounts.id, prev.id)).returning({ id: stockCounts.id }))[0]!.id
    : (await tx.insert(stockCounts).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: stockCounts.id }))[0]!.id;
  const lab = (kind === 'count' ? 'Попис ' : 'Отпис ') + number;
  let live = L.ctx;
  const moves: StockMove[] = [];
  docLines.forEach((l, ix) => {
    const it = requireTracked(L, l.itemId);
    const src = `mo-${id}-${ix}`;
    let mv: StockMove;
    if (kind === 'writeoff') mv = postOut(live, { item: it, qty: l.qty!, date: input.date, type: 'writeoff', src, label: lab, debitAccount: shortK, wh: W }).move;
    else if (l.diff! < 0) mv = postOut(live, { item: it, qty: -l.diff!, date: input.date, type: 'popis', src, label: lab + ' – кусок', debitAccount: shortK, wh: W }).move;
    else mv = postIn(live, { item: it, qty: l.diff!, date: input.date, src, label: lab + ' – вишок', creditAccount: surK, wh: W }).move;
    moves.push(mv);
    live = withMoves(live, [mv]);
  });
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'stock_count', sourceId: id, moves, date: input.date, description: lab + ' · ' + L.locName(loc), userId: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'moSave', entityType: 'stock_count', entityId: id, data: { kind, number, date: input.date, wh: W, lines: docLines.length, edit: !!prev } });
  return { id, number, lines: docLines.length };
}

export async function deleteStockCount(tx: Tx, a: Actor, id: string): Promise<void> {
  const row = await own(tx.select().from(stockCounts).where(and(eq(stockCounts.id, id), eq(stockCounts.firmId, a.firmId))).limit(1), 'Документот');
  await assertDocOpen(tx, a.firmId, row.date);
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'stock_count', sourceId: id, userId: a.userId });
  await tx.delete(stockCounts).where(eq(stockCounts.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'moDel', entityType: 'stock_count', entityId: id, data: { kind: row.kind, number: row.number, date: row.date } });
}

/* ================================================================== daily sales: POS, Z / fiscal reports */

export interface SalesDayInput {
  id?: string | null;
  kind: 'pos' | 'fisk';
  date: string;
  wh?: string | null;
  /** Z number. */
  number?: string | null;
  /** Fiscal: turnover incl. VAT per VAT rate (`{18: 11800, 5: 105}`); POS: computed from `lines`. */
  gross?: Readonly<Record<string, number>>;
  /** Total incl. VAT (default Σ gross). */
  total?: number | null;
  card?: number | null;
  cardAccount?: string | null;
  count?: number | null;
  fisk?: SalesFiskInfo | null;
  days?: SalesDayRow[] | null;
  /** Macedonian-product turnover per rate (КДФИ). */
  mk?: Record<string, { g: number; v: number }> | null;
  /** POS cart / goods to issue. `price` incl. VAT; `rate` defaults to the item's rate. */
  lines?: readonly { itemId: string; qty: number; price: number; rate?: number | null; name?: string | null }[];
  /** Issue `lines` from stock (POS always; fiscal `trg` / plain reports when goods are chosen). */
  issue?: boolean;
  note?: string | null;
  /** VAT per rate as read from the fiscal report (legacy `r.vat[L]` 11451); otherwise computed from the gross. */
  vat?: Record<string, number> | null;
  /** Fiscal report for a date + location that already has one: replace it (legacy fixed id `zf-{wh}-{date}` + force). */
  replace?: boolean;
  /** Uploaded scan of the report (legacy `attach` 11450), linked to the record. */
  fileId?: string | null;
}

/** Revenue account of an item sold at retail (legacy: item `konto`, else `revRetail` for goods, else `REV_K[type]`). */
function retailRevenue(L: LoadedStock, it: StockItem | undefined): string {
  const P = L.settings.posting;
  if (it?.konto) return String(it.konto);
  if (it?.type === 'goods') return schemeValue(P, 'revRetail') || '7411';
  if (it?.type === 'service') return schemeValue(P, 'revService') || '7400';
  if (it?.type === 'product') return schemeValue(P, 'revProduct') || '7400';
  return schemeValue(P, 'revGoods') || '7400';
}

/**
 * Save a daily sales document (legacy `posSell` 9940 / `fkPost` 13101): POS days are posted like a cash sale with card
 * payments moved to the card account (`fiskEntries` without scheme); fiscal reports with the firm's fiscal scheme
 * (`trg`, `usl`, `trgNoVat`). Goods sold are issued at average cost (`postOut`, D COGS / C stock, or the retail-value
 * split in retail-value stores) as `stock_moves` with their own stock journal.
 */
export async function saveSalesDay(tx: Tx, a: Actor, input: SalesDayInput): Promise<{ id: string; total: number }> {
  needDate(input.date);
  const prev = input.id ? await own(tx.select().from(salesDaily).where(and(eq(salesDaily.id, input.id), eq(salesDaily.firmId, a.firmId))).limit(1), 'Дневниот промет') : null;
  const L = await loadStockContext(tx, a.firmId, prev ? { excludeSource: { sourceType: 'sales_daily', sourceId: prev.id } } : {});
  assertOpenPeriod(L.firm, input.date);
  if (prev) assertOpenPeriod(L.firm, prev.date);
  const loc = requireLocation(L, input.wh);
  const W = whId(loc);
  const kind = prev?.kind ?? input.kind;
  const fisk: SalesFiskInfo | null = kind === 'fisk' ? { ...(input.fisk ?? {}), ...(input.number ? { z: input.number } : {}) } : null;
  const sc = fisk?.sc;
  const nonVat = !L.settings.vatRegistered || !!fisk?.nonVat;
  const cart: SalesItemLine[] = (input.lines ?? []).filter((l) => (l.itemId || (kind === 'pos' && r2(l.price) < 0)) && r4(l.qty) > 0).map((l) => {
    // POS discount line (legacy `posSell` wrapper 9940: „Попуст (…)“, qty 1 × −amount per VAT rate, no item)
    if (!l.itemId) return { itemId: '', qty: r4(l.qty), price: r2(l.price), rate: nonVat ? 0 : Number(l.rate ?? 0), ...(l.name ? { name: l.name } : {}) };
    const it = L.ctx.items?.find((i) => i.id === l.itemId);
    if (!it) throw new StockDocError('Артиклот не постои во оваа фирма.');
    return { itemId: l.itemId, qty: r4(l.qty), price: r2(l.price), rate: nonVat ? 0 : Number(l.rate ?? it.rate ?? 18) };
  });
  let groups: SalesGroupRow[];
  let total: number;
  let mk = input.mk ?? null;
  if (kind === 'pos') {
    if (!cart.length) throw new StockDocError('Додадете барем еден артикл.');
    const t = dailySalesTotals(L.ctx, cart.map((l) => ({ item: l.itemId, qty: l.qty, price: l.price, rate: l.rate })), (it) => retailRevenue(L, it));
    groups = t.groups;
    total = t.total;
    mk = t.mk ?? null;
  } else {
    const rev = retailRevenue(L, { id: '', type: 'goods' });
    groups = Object.entries(input.gross ?? {})
      .filter(([, g]) => r2(g))
      .map(([rate, g]) => {
        const r = nonVat ? 0 : Number(rate);
        const rv = input.vat?.[rate];
        const vat = !r ? 0 : rv != null && Number.isFinite(rv) && rv > 0 ? r2(rv) : r2(g - g / (1 + r / 100));
        return { rate: r, konto: fisk?.rev || rev, base: r2(g - vat), vat };
      });
    const sum = r2(groups.reduce((s, g) => s + g.base + g.vat, 0));
    total = input.total != null && Number.isFinite(input.total) ? r2(input.total) : sum;
    if (!total) throw new StockDocError('Внесете промет.');
    if (nonVat && groups.length) groups = [{ rate: 0, konto: fisk?.rev || rev, base: total, vat: 0 }];
  }
  const card = Math.min(total, Math.max(0, r2(input.card ?? 0)));
  const cardAccount = input.cardAccount?.trim() || L.settings.fiskOpt.cardK || null;
  const head = {
    kind, date: input.date, locationId: loc, number: input.number?.trim() || null, groups, total: total.toFixed(2), card: card.toFixed(2),
    cardAccount, count: input.count ?? (kind === 'pos' ? 1 : 0), mk, days: input.days ?? null, fisk, lines: cart, note: input.note?.trim() || null,
  };
  let id: string;
  if (prev) id = (await tx.update(salesDaily).set(head).where(eq(salesDaily.id, prev.id)).returning({ id: salesDaily.id }))[0]!.id;
  else {
    if (kind === 'pos') {
      const [dup] = await tx.select({ id: salesDaily.id }).from(salesDaily).where(and(eq(salesDaily.firmId, a.firmId), eq(salesDaily.kind, 'pos'), eq(salesDaily.date, input.date), sql`coalesce(${salesDaily.locationId}::text, 'main') = ${loc ?? 'main'}`)).limit(1);
      if (dup) throw new StockDocError('За овој ден и објект веќе постои дневен промет од каса – дополнете го.');
    }
    if (kind === 'fisk') {
      // legacy 11414 / 11429: „⚠ За овој ден … веќе има промет во оваа каса“ — replace only when asked
      const D = await tx.select({ id: salesDaily.id }).from(salesDaily).where(and(eq(salesDaily.firmId, a.firmId), eq(salesDaily.kind, 'fisk'), eq(salesDaily.date, input.date), sql`coalesce(${salesDaily.locationId}::text, 'main') = ${loc ?? 'main'}`));
      if (D.length && !input.replace) throw new StockDocError(`За ${input.date.split('-').reverse().join('.')} во овој објект веќе има прокнижен фискален извештај – штиклирајте „замени го постојниот“ или изберете друг датум.`);
      for (const x of D) await deleteSalesDay(tx, a, x.id);
    }
    id = (await tx.insert(salesDaily).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: salesDaily.id }))[0]!.id;
  }
  if (input.fileId) {
    const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, input.fileId), eq(files.firmId, a.firmId))).limit(1);
    if (f) await tx.insert(fileLinks).values({ fileId: f.id, entityType: 'sales_daily', entityId: id, role: 'source' }).onConflictDoNothing();
  }
  // revenue journal
  const posting = { ...L.settings.posting, firm: { ...L.settings.posting.firm } };
  const posK = posting.firm.posK || schemeValue(posting, 'posCard');
  if (card > 0 && /^12/.test(cardAccount || posK)) posting.firm.posPartnerId = await ensurePosPartner(tx, a.firmId, a.userId);
  const doc: SalesDoc = {
    id, date: input.date, wh: W, total, groups, card, cardKonto: cardAccount ?? undefined,
    fisk: fisk?.sc ? { sc: sc as FiscalSchemeKey, cashK: fisk.cashK, rev: fisk.rev, nonVat: fisk.nonVat, from: fisk.from, to: fisk.to, z: fisk.z } : null,
  };
  // legacy `vbLines` 3451 (Каса): the off-balance VAT bases of the day's sales (Д 994… / П 999…)
  const J: JournalLine[] = [...fiskEntries(doc, posting), ...vbLines(salesVatBases(groups), posting)];
  const zLabel = kind === 'pos' ? 'Каса' : `Дн. фин. изв.${input.number ? ' Z бр. ' + input.number : ''}`;
  await postJournal(tx, {
    firmId: a.firmId, date: input.date, kind: 'kasa', sourceType: 'sales_daily', sourceId: id, userId: a.userId,
    description: `${zLabel} ${input.date.split('-').reverse().join('.')} · ${L.locName(loc)}`,
    lines: J.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId ?? null, note: l.note ?? null, doc: l.doc ?? null, locationId: loc })),
  });
  // goods issue
  const issue = kind === 'pos' || (!!input.issue && sc !== 'usl' && sc !== 'trgNoVat');
  let live = L.ctx;
  const moves: StockMove[] = [];
  if (issue)
    cart.forEach((l, ix) => {
      const it = L.ctx.items!.find((i) => i.id === l.itemId);
      if (!it || !it.type || it.type === 'service') return; // discount lines (legacy posSell wrapper 9940) have no item
      // FIX (Phase 10, legacy posSell 5845): a product with a BOM that is not on stock (a dish, a cocktail) issues its
      // BOM components instead of the product itself — the restaurant / POS discharges the raw materials.
      if (kind === 'pos' && it.type === 'product' && (it.bom ?? []).length) {
        const have = live.moves.filter((m) => m.item === it.id && (m.wh ?? 'main') === W && !m.pend).reduce((s, m) => s + m.qty, 0);
        if (have < l.qty - 1e-9) {
          for (const b of it.bom ?? []) {
            const mt = L.ctx.items!.find((i) => i.id === b.item);
            if (!mt || !mt.type || mt.type === 'service' || !Number(b.qty)) continue;
            const mv = postOut(live, { item: mt, qty: r4(l.qty * Number(b.qty)), date: input.date, type: 'sale', src: `pos-${id}-${ix}-${mt.id}`, label: `${zLabel} · ${it.name} (норматив)`, debitAccount: cogsAccount(L.ctx, mt), wh: W }).move;
            moves.push(mv);
            live = withMoves(live, [mv]);
          }
          return;
        }
      }
      const mv = postOut(live, { item: it, qty: l.qty, date: input.date, type: 'sale', src: `pos-${id}-${ix}`, label: `${zLabel} · ${L.locName(loc)}`, debitAccount: cogsAccount(L.ctx, it), wh: W }).move;
      moves.push(mv);
      live = withMoves(live, [mv]);
    });
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'sales_daily', sourceId: id, moves, date: input.date, description: `Излез на стока · ${zLabel} · ${L.locName(loc)}`, userId: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: kind === 'pos' ? 'posSell' : 'fkPost', entityType: 'sales_daily', entityId: id, data: { date: input.date, wh: W, total, card, sc: sc ?? null, issued: moves.length, edit: !!prev } });
  return { id, total };
}

/** Legacy `posSell`: add a cart to the POS day of the location (created on the first sale). */
export async function posSell(tx: Tx, a: Actor, input: { date: string; wh?: string | null; cart: SalesDayInput['lines']; card?: number | null }): Promise<{ id: string; total: number }> {
  const loc = dbLoc(input.wh);
  const [day] = await tx.select().from(salesDaily).where(and(eq(salesDaily.firmId, a.firmId), eq(salesDaily.kind, 'pos'), eq(salesDaily.date, input.date), sql`coalesce(${salesDaily.locationId}::text, 'main') = ${loc ?? 'main'}`)).limit(1);
  const lines = [...(day?.lines ?? []), ...(input.cart ?? [])];
  return saveSalesDay(tx, a, {
    id: day?.id ?? null, kind: 'pos', date: input.date, wh: loc, lines, issue: true,
    card: Number(day?.card ?? 0) + (input.card ?? 0), cardAccount: day?.cardAccount ?? null, count: (day?.count ?? 0) + 1, note: day?.note ?? null,
  });
}

export async function deleteSalesDay(tx: Tx, a: Actor, id: string): Promise<void> {
  const row = await own(tx.select().from(salesDaily).where(and(eq(salesDaily.id, id), eq(salesDaily.firmId, a.firmId))).limit(1), 'Дневниот промет');
  await assertDocOpen(tx, a.firmId, row.date);
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'sales_daily', sourceId: id, userId: a.userId });
  await unpostSource(tx, { firmId: a.firmId, sourceType: 'sales_daily', sourceId: id, userId: a.userId });
  await tx.delete(salesDaily).where(eq(salesDaily.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fkDel', entityType: 'sales_daily', entityId: id, data: { kind: row.kind, date: row.date, total: row.total } });
}

/* ================================================================== production */

/** Save the normativ of a product (legacy `saveBom` 13902); a BOM that contains the product itself is refused. */
export async function saveBom(tx: Tx, a: Actor, input: { productId: string; labor: number; lines: readonly { itemId: string; qty: number }[] }): Promise<void> {
  const L = await loadStockContext(tx, a.firmId);
  const p = L.ctx.items?.find((i) => i.id === input.productId);
  if (!p || p.type !== 'product') throw new StockDocError('Изберете готов производ.');
  const lines = input.lines.filter((l) => l.itemId && r4(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: r4(l.qty) }));
  for (const l of lines) {
    const it = L.ctx.items?.find((i) => i.id === l.itemId);
    if (!it || !it.type || it.type === 'service') throw new StockDocError('Составот може да содржи само материјали, стоки и производи.');
  }
  const cyc = bomCycle(L.ctx, p.id, lines.map((l) => ({ item: l.itemId, qty: l.qty })));
  if (cyc) throw new StockDocError(`Нормативот е кружен: ${cyc.map((id) => L.items.get(id)?.name ?? id).join(' → ')}.`);
  const labor = r2(input.labor || 0).toFixed(2);
  await tx.insert(boms).values({ firmId: a.firmId, productId: p.id, labor, lines })
    .onConflictDoUpdate({ target: [boms.firmId, boms.productId], set: { labor, lines } });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveBom', entityType: 'bom', entityId: p.id, data: { labor: Number(labor), lines: lines.length } });
}

/**
 * Run a work order (legacy `runProd` 5669): refuse when material is short, issue the components at average cost and
 * receive the product at material + labour cost; one stock journal (D 6000 / C stock, D 6000 / C 4900, D 6300 / C 6000).
 */
export async function runProductionOrder(tx: Tx, a: Actor, input: { date: string; productId: string; qty: number; wh?: string | null; note?: string | null }): Promise<{ id: string; number: string; unitCost: number }> {
  needDate(input.date);
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, input.date);
  const loc = requireLocation(L, input.wh);
  const p = L.ctx.items?.find((i) => i.id === input.productId);
  if (!p || p.type !== 'product') throw new StockDocError('Изберете готов производ.');
  if (!(p.bom ?? []).length) throw new StockDocError('Овој производ нема норматив.');
  const q = r4(input.qty);
  if (!(q > 0)) throw new StockDocError('Внесете количина за производство.');
  const needs = productionNeeds(L.ctx, p, q, whId(loc));
  const short = needs.lines.filter((x) => x.short);
  if (short.length) throw new StockDocError(`Недостига материјал на залиха: ${short.map((x) => `${x.item.name} (${fq(r4(x.need - x.have))})`).join(', ')}.`);
  const ex = await tx.select({ number: productionOrders.number, date: productionOrders.date }).from(productionOrders).where(eq(productionOrders.firmId, a.firmId));
  const number = nextYearNumber(ex, yearOf(input.date));
  const bom = (p.bom ?? []).map((b) => ({ itemId: b.item, qty: Number(b.qty) }));
  const [row] = await tx.insert(productionOrders).values({ firmId: a.firmId, number, date: input.date, productId: p.id, qty: q.toFixed(4), locationId: loc, bom, note: input.note?.trim() || null, createdBy: a.userId }).returning({ id: productionOrders.id });
  const id = row!.id;
  const r = runProduction(L.ctx, { id: 'prod-' + id, product: p, qty: q, date: input.date, wh: whId(loc) });
  await tx.update(productionOrders).set({ mat: r.record.mat.toFixed(2), lab: r.record.lab.toFixed(2), unitCost: String(r.record.unit ?? 0) }).where(eq(productionOrders.id, id));
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'production', sourceId: id, moves: r.moves, date: input.date, description: `Работен налог ${number} · ${p.name}`, userId: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'runProd', entityType: 'production', entityId: id, data: { number, product: p.id, qty: q, mat: r.record.mat, lab: r.record.lab } });
  return { id, number, unitCost: Number(r.record.unit ?? 0) };
}

/** Legacy `delProd` ("Сторнирај"): remove the work order, its moves and journal. */
export async function deleteProductionOrder(tx: Tx, a: Actor, id: string): Promise<void> {
  const row = await own(tx.select().from(productionOrders).where(and(eq(productionOrders.id, id), eq(productionOrders.firmId, a.firmId))).limit(1), 'Работниот налог');
  await assertDocOpen(tx, a.firmId, row.date);
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'production', sourceId: id, userId: a.userId });
  await tx.delete(productionOrders).where(eq(productionOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'delProd', entityType: 'production', entityId: id, data: { number: row.number, date: row.date } });
}

/* ================================================================== re-averaging (упросечување) */

/**
 * Legacy `reaverage()` / ACT `runUprosek`: re-value every issue at the running weighted average and re-post the
 * affected stock journals. Moves in the locked period are left unchanged (FIX: legacy rewrote locked history).
 */
export async function runStockReaverage(tx: Tx, a: Actor): Promise<{ changed: number; skippedLocked: number; sources: number }> {
  const L = await loadStockContext(tx, a.firmId);
  const lock = L.firm.lockDate;
  const prodRows = await tx.select().from(productionOrders).where(eq(productionOrders.firmId, a.firmId)).orderBy(asc(productionOrders.date));
  const prods: ProductionRecord[] = prodRows.map((p) => ({ id: 'prod-' + p.id, date: p.date, product: p.productId, qty: Number(p.qty), mat: Number(p.mat), lab: Number(p.lab) }));
  const res = reaverage(L.ctx, prods);
  const byId = new Map(res.moves.map((m) => [m.id, m]));
  const rows = res.changedMoves.length ? await tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, a.firmId), inArray(stockMoves.id, res.changedMoves))) : [];
  const sources = new Map<string, { sourceType: string; sourceId: string; date: string }>();
  let changed = 0;
  let skipped = 0;
  const lockedSources = new Set(rows.filter((r) => lock && r.date <= lock).map((r) => r.sourceType + '|' + r.sourceId));
  for (const r of rows) {
    const k = r.sourceType + '|' + r.sourceId;
    if (lockedSources.has(k)) {
      skipped++;
      continue;
    }
    const m = byId.get(r.id)!;
    const q = Number(r.qty);
    await tx.update(stockMoves).set({
      value: r2(m.value).toFixed(2), price: q ? r4(Math.abs(m.value / q)).toFixed(4) : null,
      lines: (m.lines ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, ...(l.partner ? { partnerId: l.partner } : {}), ...(l.note ? { note: l.note } : {}) })),
    }).where(eq(stockMoves.id, r.id));
    changed++;
    if (!sources.has(k)) sources.set(k, { sourceType: r.sourceType, sourceId: r.sourceId, date: r.date });
  }
  for (const p of res.production.filter((x) => res.changedProduction.includes(x.id))) {
    const id = p.id.replace(/^prod-/, '');
    if (lockedSources.has('production|' + id)) continue;
    await tx.update(productionOrders).set({ mat: r2(p.mat).toFixed(2), unitCost: String(p.unit ?? 0) }).where(eq(productionOrders.id, id));
  }
  for (const s of sources.values()) {
    const [j] = await tx.select({ date: journals.date, description: journals.description }).from(journals)
      .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, 'stock:' + s.sourceType), eq(journals.sourceId, s.sourceId))).limit(1);
    await repostSourceMoves(tx, { firmId: a.firmId, sourceType: s.sourceType, sourceId: s.sourceId, date: j?.date ?? s.date, description: j?.description ?? undefined, userId: a.userId });
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'runUprosek', entityType: 'stock', data: { changed, skippedLocked: skipped, sources: sources.size } });
  return { changed, skippedLocked: skipped, sources: sources.size };
}

/** Is an item stock-tracked (not a service)? */
export const isTracked = (it: Pick<StockItem, 'type'>): boolean => !!it.type && it.type !== 'service';

/**
 * Re-post the revenue journal of a stored daily turnover with the current schemes (legacy `schRepost` over
 * `S.data.sales`); the stored VAT groups and the goods issue stay as they are.
 */
export async function repostSalesDay(tx: Tx, a: Actor, id: string): Promise<void> {
  const [d] = await tx.select().from(salesDaily).where(and(eq(salesDaily.id, id), eq(salesDaily.firmId, a.firmId))).limit(1);
  if (!d || d.pending) return;
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, d.date);
  const fisk = d.fisk ?? null;
  const total = Number(d.total), card = Number(d.card);
  const posting = { ...L.settings.posting, firm: { ...L.settings.posting.firm } };
  const posK = posting.firm.posK || schemeValue(posting, 'posCard');
  if (card > 0 && /^12/.test(d.cardAccount || posK)) posting.firm.posPartnerId = await ensurePosPartner(tx, a.firmId, a.userId);
  const doc: SalesDoc = {
    id, date: d.date, wh: whId(d.locationId), total, groups: d.groups, card, cardKonto: d.cardAccount ?? undefined,
    fisk: fisk?.sc ? { sc: fisk.sc as FiscalSchemeKey, cashK: fisk.cashK, rev: fisk.rev, nonVat: fisk.nonVat, from: fisk.from, to: fisk.to, z: fisk.z } : null,
  };
  const zLabel = d.kind === 'pos' ? 'Каса' : `Дн. фин. изв.${d.number ? ' Z бр. ' + d.number : ''}`;
  await postJournal(tx, {
    firmId: a.firmId, date: d.date, kind: 'kasa', sourceType: 'sales_daily', sourceId: id, userId: a.userId, auditAction: 'schRepost',
    description: `${zLabel} ${d.date.split('-').reverse().join('.')} · ${L.locName(d.locationId)}`,
    lines: fiskEntries(doc, posting).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId ?? null, note: l.note ?? null, doc: l.doc ?? null, locationId: d.locationId })),
  });
}
