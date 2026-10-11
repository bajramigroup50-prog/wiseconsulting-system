/**
 * Stock / production / codebook parity services (legacy features missing from the first port). Each function runs in
 * the caller's transaction and writes `audit_log`; the permission check (`requireCan`) is the caller's job.
 *
 * - `deleteItemsStock` — legacy `ACT.lgDel` 17006 (admin): delete the stock of selected items (optionally at one
 *   location). FIX vs legacy: moves owned by posted documents with their own journal (purchases, invoices, dispatches,
 *   supplier credits, POS / fiscal days, production) are not torn out of those documents — they are counted and
 *   reported; moves in the locked period are skipped; both legs of a transfer go together (legacy item 12 left the
 *   paired move at the other location); the stock journal of every touched source is re-posted.
 * - `runCustomProductionOrder` — legacy `pcRun` 13987 (materials changed / added for one work order, optionally saved
 *   as the normativ) and `pnbRun` 13933 (no normativ: materials as % of the sale price).
 * - `importCodebook`, `importAccounts` — Excel / CSV import for the codebook editors and the chart of accounts.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { r2, r4 } from '@wise/core/stock/num';
import { NEW_ACCOUNT_CODE_RE, runProduction, nextYearNumber, type StockItem } from '@wise/core';
import { pnbPlan, rnItems } from '@wise/core/parity-stock';
import { cbInput, cbIsGlobal, type CbKey } from '@wise/core/codebooks';
import { audit, type Tx } from './audit';
import { assertOpenPeriod, unpostSource } from './posting';
import { accounts, codes, firms, productionOrders, stockCounts, stockMoves, transfers } from './schema/index';
import { saveBom, type Actor } from './stock-docs';
import { saveCode } from './codebooks';
import { StockDocError, loadStockContext, replaceSourceMoves, repostSourceMoves, requireLocation, whId } from './stock-service';

/* ================================================================== bulk delete of stock (lgDel) */

/** Sources whose moves may be deleted by the bulk delete (their only posting is the stock journal). */
const DELETABLE = new Set(['opening', 'stock_import', 'manual_move', 'transfer', 'stock_count']);

export interface DeleteItemsStockResult { deleted: number; locked: number; kept: Record<string, number>; docsRemoved: number }

export async function deleteItemsStock(tx: Tx, a: Actor, input: { itemIds: readonly string[]; wh?: string | null }): Promise<DeleteItemsStockResult> {
  const ids = [...new Set(input.itemIds)];
  if (!ids.length) throw new StockDocError('Изберете артикли (кутичката лево).');
  const [firm] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!firm) throw new StockDocError('Фирмата не постои.');
  const lock = firm.lockDate;
  const W = input.wh ? (input.wh === 'main' ? null : input.wh) : undefined;
  const sel = await tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, a.firmId), inArray(stockMoves.itemId, ids),
    W === undefined ? undefined : W === null ? isNull(stockMoves.locationId) : eq(stockMoves.locationId, W)));
  // both legs of a transfer leave together
  const trIds = [...new Set(sel.filter((m) => m.sourceType === 'transfer').map((m) => m.sourceId))];
  const legs = trIds.length ? await tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, 'transfer'), inArray(stockMoves.sourceId, trIds), inArray(stockMoves.itemId, ids))) : [];
  const all = new Map([...sel, ...legs].map((m) => [m.id, m]));
  const kept: Record<string, number> = {};
  let locked = 0;
  const lockedSrc = new Set([...all.values()].filter((m) => lock && m.date <= lock).map((m) => m.sourceType + '|' + m.sourceId));
  const del: (typeof sel)[number][] = [];
  for (const m of all.values()) {
    if (!DELETABLE.has(m.sourceType)) { kept[m.sourceType] = (kept[m.sourceType] ?? 0) + 1; continue; }
    if (lockedSrc.has(m.sourceType + '|' + m.sourceId)) { locked++; continue; }
    del.push(m);
  }
  if (del.length) await tx.delete(stockMoves).where(inArray(stockMoves.id, del.map((m) => m.id)));
  const sources = new Map<string, { t: string; id: string; date: string }>();
  for (const m of del) sources.set(m.sourceType + '|' + m.sourceId, { t: m.sourceType, id: m.sourceId, date: m.date });
  let docsRemoved = 0;
  const gone = new Set(ids);
  for (const s of sources.values()) {
    const left = await tx.select({ n: sql<number>`count(*)::int` }).from(stockMoves).where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, s.t), eq(stockMoves.sourceId, s.id)));
    const empty = !(left[0]?.n);
    if (s.t === 'transfer') {
      const [tr] = await tx.select().from(transfers).where(and(eq(transfers.id, s.id), eq(transfers.firmId, a.firmId))).limit(1);
      if (tr) {
        const lines = tr.lines.filter((l) => !gone.has(l.itemId));
        if (empty || !lines.length) { await tx.delete(transfers).where(eq(transfers.id, tr.id)); docsRemoved++; }
        else await tx.update(transfers).set({ lines }).where(eq(transfers.id, tr.id));
      }
    } else if (s.t === 'stock_count') {
      const [sc] = await tx.select().from(stockCounts).where(and(eq(stockCounts.id, s.id), eq(stockCounts.firmId, a.firmId))).limit(1);
      if (sc) {
        const lines = sc.lines.filter((l) => !gone.has(l.itemId));
        if (empty || !lines.length) { await tx.delete(stockCounts).where(eq(stockCounts.id, sc.id)); docsRemoved++; }
        else await tx.update(stockCounts).set({ lines }).where(eq(stockCounts.id, sc.id));
      }
    }
    if (empty) await unpostSource(tx, { firmId: a.firmId, sourceType: 'stock:' + s.t, sourceId: s.id, userId: a.userId });
    else await repostSourceMoves(tx, { firmId: a.firmId, sourceType: s.t, sourceId: s.id, date: s.date, userId: a.userId });
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'lgDel', entityType: 'stock', data: { items: ids.length, wh: input.wh ?? null, deleted: del.length, locked, kept, docsRemoved } });
  return { deleted: del.length, locked, kept, docsRemoved };
}

/* ================================================================== work order with own materials / without BOM */

export interface CustomProductionInput {
  date: string;
  productId: string;
  qty: number;
  wh?: string | null;
  /** `custom`: the materials typed for this order (total quantities); `pct`: no normativ, % of the sale price. */
  mode: 'custom' | 'pct';
  lines?: readonly { itemId: string; qty: number }[];
  pct?: number;
  /** Save the typed materials (per unit) as the product's normativ (legacy checkbox „зачувај го ова како норматив“). */
  saveAsBom?: boolean;
  note?: string | null;
}

export async function runCustomProductionOrder(tx: Tx, a: Actor, input: CustomProductionInput): Promise<{ id: string; number: string; unitCost: number; warnings: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new StockDocError('Неважечки датум.');
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, input.date);
  const loc = requireLocation(L, input.wh);
  const wh = whId(loc);
  const p = L.ctx.items?.find((i) => i.id === input.productId);
  if (!p || p.type !== 'product') throw new StockDocError('Изберете готов производ.');
  const q = r4(input.qty);
  if (!(q > 0)) throw new StockDocError('Внесете количина за производство.');
  let totals: { itemId: string; qty: number }[];
  let labor = 0;
  let note = input.note?.trim() || '';
  if (input.mode === 'pct') {
    const pct = Number(input.pct);
    if (!(pct > 0 && pct <= 100)) throw new StockDocError('Учеството на суровините мора да е од 1 до 100 %.');
    if (!(Number(p.price) > 0)) throw new StockDocError('Производот нема продажна цена – внесете ја во Артикли.');
    const plan = pnbPlan(L.ctx, p, q, wh, pct, rnItems((L.ctx.items ?? []).map((i) => ({ ...i, active: L.items.get(i.id)?.active }))));
    if (!plan.lines.length) throw new StockDocError('Нема суровини на залиха во овој објект.');
    totals = plan.lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
    note = note || `без норматив ${pct}%`;
  } else {
    totals = (input.lines ?? []).filter((l) => l.itemId && r4(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: r4(l.qty) }));
    if (!totals.length) throw new StockDocError('Додајте материјали со количина.');
    for (const l of totals) {
      const it = L.ctx.items?.find((i) => i.id === l.itemId);
      if (!it || !it.type || it.type === 'service' || it.id === p.id) throw new StockDocError('Материјалите може да бидат само суровини, стоки и производи (не самиот производ).');
    }
    labor = r2(Number(p.labor ?? 0) * q);
    note = note || 'изменети материјали';
  }
  // run as one "unit" whose BOM is the total quantities, then set the received quantity (exact totals, no per-unit rounding)
  const clone: StockItem = { ...p, bom: totals.map((l) => ({ item: l.itemId, qty: l.qty })), labor };
  const ex = await tx.select({ number: productionOrders.number, date: productionOrders.date }).from(productionOrders).where(eq(productionOrders.firmId, a.firmId));
  const number = nextYearNumber(ex, input.date.slice(0, 4));
  const perUnit = totals.map((l) => ({ itemId: l.itemId, qty: r4(l.qty / q) }));
  const [row] = await tx.insert(productionOrders).values({ firmId: a.firmId, number, date: input.date, productId: p.id, qty: q.toFixed(4), locationId: loc, bom: perUnit, note, createdBy: a.userId }).returning({ id: productionOrders.id });
  const id = row!.id;
  const r = runProduction(L.ctx, { id: 'prod-' + id, product: clone, qty: 1, date: input.date, wh });
  const last = r.moves[r.moves.length - 1]!;
  last.qty = q;
  if (input.mode === 'pct') last.label = `Производство ${p.name ?? ''} (без норматив)`;
  const tot = r2(r.record.mat + r.record.lab);
  const unit = r2(tot / q);
  await tx.update(productionOrders).set({ mat: r.record.mat.toFixed(2), lab: r.record.lab.toFixed(2), unitCost: String(unit) }).where(eq(productionOrders.id, id));
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'production', sourceId: id, moves: r.moves, date: input.date, description: `Работен налог ${number} · ${p.name ?? ''}`, userId: a.userId });
  if (input.saveAsBom && input.mode === 'custom') await saveBom(tx, a, { productId: p.id, labor: Number(p.labor ?? 0), lines: perUnit });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: input.mode === 'pct' ? 'pnbRun' : 'pcRun', entityType: 'production', entityId: id, data: { number, product: p.id, qty: q, mat: r.record.mat, lab: r.record.lab, mode: input.mode, pct: input.pct ?? null, saveAsBom: !!input.saveAsBom } });
  return { id, number, unitCost: unit, warnings: r.warnings.length };
}

/* ================================================================== codebook / chart imports */

export interface CodeImportResult { add: number; upd: number; skip: string[] }

/** Import rows `{code, name, …fields}` into a codebook: same code (or same name without code) = update. */
export async function importCodebook(tx: Tx, a: { userId: string; firmId: string | null; k: CbKey; rows: readonly Record<string, unknown>[] }): Promise<CodeImportResult> {
  const R: CodeImportResult = { add: 0, upd: 0, skip: [] };
  const scope = cbIsGlobal(a.k) ? null : a.firmId;
  for (const raw of a.rows) {
    const inp = cbInput(a.k, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? '' : String(v)])));
    const label = String(raw.code ?? raw.name ?? '?');
    if ('error' in inp) { R.skip.push(label + ': ' + inp.error); continue; }
    try {
      await tx.transaction(async (t2) => {
        const t = t2 as unknown as Tx;
        const [ex] = await t.select({ id: codes.id }).from(codes).where(and(eq(codes.cb, a.k), scope ? eq(codes.firmId, scope) : isNull(codes.firmId),
          inp.code ? eq(codes.code, inp.code) : eq(codes.name, inp.name))).limit(1);
        await saveCode(t, { userId: a.userId, firmId: a.firmId, k: a.k, id: ex?.id ?? null, input: inp });
        if (ex) R.upd++; else R.add++;
      });
    } catch (e) { R.skip.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  }
  await audit(tx, { userId: a.userId, firmId: scope, action: 'cbImport', entityType: `code:${a.k}`, data: { add: R.add, upd: R.upd, skip: R.skip.length } });
  return R;
}

/** Import `{code, name}` rows into the firm's chart of accounts (legacy `saveAcc` per row). */
export async function importAccounts(tx: Tx, a: { userId: string; firmId: string; rows: readonly { code?: unknown; name?: unknown }[] }): Promise<CodeImportResult> {
  const R: CodeImportResult = { add: 0, upd: 0, skip: [] };
  for (const r of a.rows) {
    const code = String(r.code ?? '').trim().replace(/\s/g, '');
    const name = String(r.name ?? '').trim();
    if (!NEW_ACCOUNT_CODE_RE.test(code)) { R.skip.push((code || '?') + ': бројот на контото мора да има 3–8 цифри'); continue; }
    if (!name) { R.skip.push(code + ': нема назив'); continue; }
    const [ex] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, a.firmId), eq(accounts.code, code))).limit(1);
    await tx.insert(accounts).values({ firmId: a.firmId, code, name })
      .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { name, hidden: false } });
    if (ex) R.upd++; else R.add++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'accImport', entityType: 'account', data: { add: R.add, upd: R.upd, skip: R.skip.length } });
  return R;
}
