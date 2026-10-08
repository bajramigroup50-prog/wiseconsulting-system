/**
 * Stock service (Phase 7) — the bridge between the `stock_moves` / stock-document tables and the pure
 * `@wise/core` stock logic:
 *
 * - `loadStockContext` builds a core `StockContext` (items with retail prices and BOMs, locations from `codes`,
 *   moves, levellings, scheme, VAT status) for a firm;
 * - `replaceSourceMoves` / `removeSourceMoves` are the only writers of `stock_moves`: a source document replaces its
 *   moves as a set and its stock journal (`journals.source_type = 'stock:' || source_type`) is re-posted from the
 *   moves' line snapshots through `postJournal`, inside the caller's transaction.
 *
 * Other modules (Phase 3 purchases, invoices, dispatches) write their stock through `replaceSourceMoves` too.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { r2, r4 } from '@wise/core/stock/num';
import {
  normalizeLines, type PostingContext, type SchemeMap, type StockContext, type StockItem, type StockJournalLine,
  type StockLocation, type StockMove, type StockScheme, STOCK_SCHEME_DEFAULTS,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { assertOpenPeriod, postJournal, unpostSource } from './posting';
import {
  appSettings, boms, codes, firms, items, levellingDocs, partners, stockMoves, type Firm, type Item, type StockMoveKind,
  type StockMoveLine,
} from './schema/index';

/** A user-facing validation error of a stock document (Macedonian message). */
export class StockDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockDocError';
  }
}

/** Core location id ↔ DB `location_id` (null = virtual main warehouse). */
export const whId = (locationId: string | null | undefined): string => locationId || 'main';
export const dbLoc = (wh: string | null | undefined): string | null => (!wh || wh === 'main' ? null : wh);

/** `src` prefixes the core books use to recognise documents (legacy `move.src`). */
const SRC_PREFIX: Record<string, string> = {
  sales_daily: 'pos', transfer: 'prn', stock_count: 'mo', production: 'prod', purchase: 'pur', invoice: 'inv', dispatch: 'isp',
};
export const moveSrc = (sourceType: string, sourceId: string): string => `${SRC_PREFIX[sourceType] ?? sourceType}-${sourceId}`;
/** Inverse of {@link moveSrc} for the prefixes above. */
export function parseMoveSrc(src: string | undefined): { sourceType: string; sourceId: string } | null {
  const m = /^([a-z_]+)-(.+)$/.exec(String(src ?? ''));
  if (!m) return null;
  const t = Object.entries(SRC_PREFIX).find(([, p]) => p === m[1])?.[0] ?? m[1]!;
  return { sourceType: t, sourceId: m[2]! };
}

/* ------------------------------------------------------------------ settings */

const stockKeys = Object.keys(STOCK_SCHEME_DEFAULTS) as (keyof StockScheme)[];

export interface FirmStockSettings {
  /** Stock-scheme overrides (firm over global). */
  scheme: Partial<StockScheme>;
  vatRegistered: boolean;
  /** Posting context for `saleEntries` / `fiskEntries`. */
  posting: PostingContext;
  /** Fiscal options (legacy `firm.fiskOpt`). */
  fiskOpt: { wh?: string; cardK?: string; sc?: string; cashK?: string; meth?: string; offDays?: string; cashMax?: number; depDays?: number };
}

/** Firm (+ office-wide `app_settings.schemes`) posting and stock settings. Firm settings live in `firms.settings`. */
export async function firmStockSettings(tx: Tx, firm: Firm): Promise<FirmStockSettings> {
  const s = (firm.settings ?? {}) as Record<string, unknown>;
  const [g] = await tx.select().from(appSettings).where(eq(appSettings.key, 'schemes')).limit(1);
  const global = (g?.value ?? null) as PostingContext['global'];
  const fsch = (s.sch ?? {}) as SchemeMap;
  const gsch = (global?.sch ?? {}) as SchemeMap;
  const scheme: Partial<StockScheme> = {};
  for (const k of stockKeys) {
    const v = fsch[k] ?? gsch[k];
    if (v !== undefined && v !== null && v !== '') (scheme as Record<string, unknown>)[k] = v;
  }
  return {
    scheme,
    vatRegistered: firm.vatRegistered,
    posting: {
      firm: {
        sch: fsch, ddv: firm.vatRegistered,
        vatOut: s.vatOut as never, vatIn: s.vatIn as never, vatImp: s.vatImp as never, vatInKonto: (s.vatInKonto as string) ?? null,
        posK: (s.posK as string) ?? null, posPartnerId: (s.posPartnerId as string) ?? null,
      },
      global,
    },
    fiskOpt: (s.fiskOpt ?? {}) as FirmStockSettings['fiskOpt'],
  };
}

/* ------------------------------------------------------------------ context */

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** DB item (+ BOM) → core item. Retail prices per location `data.sp`, average fallback `data.cost`. */
export function toStockItem(it: Item, bom?: { labor: string; lines: { itemId: string; qty: number }[] }): StockItem {
  const d = (it.data ?? {}) as Record<string, unknown>;
  return {
    id: it.id, name: it.name, code: it.code ?? undefined, unit: it.unit ?? undefined, type: it.type,
    price: n(it.price), rate: it.vatRate, sp: (d.sp ?? undefined) as StockItem['sp'], cost: d.cost as number | undefined,
    rawK: it.rawAccount ?? undefined, costPrice: it.costPrice ?? undefined, costPct: it.costPct ?? undefined,
    min: it.minStock, konto: it.revenueAccount, mk: it.madeInMk,
    ...(bom ? { bom: bom.lines.map((l) => ({ item: l.itemId, qty: l.qty })), labor: n(bom.labor) } : {}),
  };
}

/** Warehouses and stores of a firm (`codes` cb warehouse/store). */
export async function loadLocations(tx: Tx, firmId: string): Promise<(StockLocation & { name: string })[]> {
  const rows = await tx.select().from(codes)
    .where(and(eq(codes.firmId, firmId), inArray(codes.cb, ['warehouse', 'store'])))
    .orderBy(asc(codes.code), asc(codes.name));
  return rows.map((c) => {
    const d = (c.data ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : undefined);
    return { id: c.id, kind: c.cb as 'warehouse' | 'store', code: c.code ?? undefined, name: c.name, konto: s('konto'), kMarg: s('kMarg'), kVat: s('kVat') };
  });
}

export const MAIN_LOCATION = { id: 'main', kind: 'warehouse' as const, code: '01', name: 'Главен магацин' };

/** DB move row → core move. */
export function toStockMove(m: typeof stockMoves.$inferSelect): StockMove {
  return {
    id: m.id, date: m.date, item: m.itemId, qty: n(m.qty), value: n(m.value), type: m.kind,
    src: moveSrc(m.sourceType, m.sourceId), label: m.label ?? undefined, wh: whId(m.locationId),
    lines: (m.lines ?? []).map((l) => ({ account: l.account, debit: n(l.debit), credit: n(l.credit), ...(l.partnerId ? { partner: l.partnerId } : {}), ...(l.note ? { note: l.note } : {}) })),
    ...(m.pending ? { pend: true } : {}), ...(m.partnerId ? { partner: m.partnerId } : {}),
  };
}

export interface LoadedStock {
  ctx: StockContext;
  firm: Firm;
  settings: FirmStockSettings;
  items: Map<string, Item>;
  locations: (StockLocation & { name: string })[];
  /** Location name (`main` → Главен магацин). */
  locName: (id: string | null | undefined) => string;
}

/**
 * Everything the core stock functions need for a firm. `excludeSource` leaves out the moves of a document being
 * edited (legacy `moOwn`: availability is checked without the document's own earlier issue).
 */
export async function loadStockContext(tx: Tx, firmId: string, opts: { excludeSource?: { sourceType: string; sourceId: string } } = {}): Promise<LoadedStock> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new StockDocError('Фирмата не постои.');
  const [settings, itemRows, bomRows, locations, moveRows, nivRows] = await Promise.all([
    firmStockSettings(tx, firm),
    tx.select().from(items).where(eq(items.firmId, firmId)).orderBy(asc(items.name)),
    tx.select().from(boms).where(eq(boms.firmId, firmId)),
    loadLocations(tx, firmId),
    tx.select().from(stockMoves).where(eq(stockMoves.firmId, firmId)).orderBy(asc(stockMoves.date), asc(stockMoves.createdAt), asc(stockMoves.sourceLine)),
    tx.select().from(levellingDocs).where(eq(levellingDocs.firmId, firmId)).orderBy(asc(levellingDocs.date), asc(levellingDocs.number)),
  ]);
  const bomOf = new Map(bomRows.map((b) => [b.productId, b]));
  const ex = opts.excludeSource;
  const ctx: StockContext = {
    items: itemRows.map((it) => toStockItem(it, bomOf.get(it.id))),
    locations,
    moves: moveRows.filter((m) => !(ex && m.sourceType === ex.sourceType && m.sourceId === ex.sourceId)).map(toStockMove),
    levellings: nivRows.map((d) => ({ id: d.id, number: d.number, date: d.date, wh: whId(d.locationId), lines: d.lines.map((l) => ({ ...l, item: l.itemId })) })),
    scheme: settings.scheme,
    vatRegistered: settings.vatRegistered,
  };
  const locName = (id: string | null | undefined) => (!id || id === 'main' ? MAIN_LOCATION.name : locations.find((l) => l.id === id)?.name ?? id);
  return { ctx, firm, settings, items: new Map(itemRows.map((i) => [i.id, i])), locations, locName };
}

/** Item id → tracked core item, or a user error. */
export function requireTracked(L: LoadedStock, itemId: string): StockItem {
  const it = L.ctx.items?.find((i) => i.id === itemId);
  if (!it) throw new StockDocError('Артиклот не постои во оваа фирма.');
  if (!it.type || it.type === 'service') throw new StockDocError(`„${it.name}“ е услуга – нема залиха.`);
  return it;
}

/** Location id from a form value: `main`/empty → null; otherwise must be a warehouse/store of the firm. */
export function requireLocation(L: LoadedStock, wh: string | null | undefined): string | null {
  const id = dbLoc(wh);
  if (id && !L.locations.some((l) => l.id === id)) throw new StockDocError('Објектот не постои.');
  return id;
}

/* ------------------------------------------------------------------ moves + stock journal */

export interface ReplaceMovesInput {
  firmId: string;
  sourceType: string;
  sourceId: string;
  /** Core moves (ids are ignored; `src` is informational). */
  moves: readonly StockMove[];
  /** Journal date and description of the stock journal. */
  date: string;
  description?: string;
  userId: string | null;
  /** Partner put on lines of partner accounts that carry none. */
  partnerId?: string | null;
  pending?: boolean;
}

const STOCK_JOURNAL = (sourceType: string) => 'stock:' + sourceType;

/** Sum move lines into one journal: per account, partner, location and side (debits and credits kept apart). */
export function stockJournalLines(moves: readonly (Pick<StockMove, 'lines' | 'wh'>)[]): { account: string; debit: number; credit: number; partnerId: string | null; locationId: string | null }[] {
  const M = new Map<string, { account: string; debit: number; credit: number; partnerId: string | null; locationId: string | null }>();
  for (const m of moves) {
    for (const l of normalizeLines(m.lines ?? [])) {
      const partnerId = (l.partner as string | undefined) ?? null;
      const locationId = dbLoc(m.wh);
      for (const side of ['debit', 'credit'] as const) {
        if (!l[side]) continue;
        const k = [l.account, partnerId ?? '', locationId ?? '', side].join('|');
        const x = M.get(k) ?? { account: l.account, debit: 0, credit: 0, partnerId, locationId };
        x[side] = r2(x[side] + l[side]);
        M.set(k, x);
      }
    }
  }
  return [...M.values()];
}

/**
 * Replace all moves of a source document and re-post (or remove) its stock journal. Checks the period lock for the
 * document date and for the dates of the moves being replaced. Returns the inserted move ids.
 */
export async function replaceSourceMoves(tx: Tx, a: ReplaceMovesInput): Promise<string[]> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!firm) throw new StockDocError('Фирмата не постои.');
  const old = await tx.select({ id: stockMoves.id, date: stockMoves.date }).from(stockMoves)
    .where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, a.sourceType), eq(stockMoves.sourceId, a.sourceId)));
  for (const o of old) assertOpenPeriod(firm, o.date);
  for (const m of a.moves) assertOpenPeriod(firm, m.date);
  if (old.length) await tx.delete(stockMoves).where(inArray(stockMoves.id, old.map((o) => o.id)));
  let ids: string[] = [];
  if (a.moves.length) {
    const rows = await tx.insert(stockMoves).values(a.moves.map((m, i) => {
      const q = r4(m.qty);
      return {
        firmId: a.firmId, itemId: m.item, locationId: dbLoc(m.wh), date: m.date, qty: q.toFixed(4), value: r2(m.value).toFixed(2),
        price: q ? r4(Math.abs(m.value / q)).toFixed(4) : null, direction: (q < 0 ? 'out' : 'in') as 'in' | 'out',
        kind: m.type as StockMoveKind, sourceType: a.sourceType, sourceId: a.sourceId, sourceLine: i, pending: !!(a.pending || m.pend),
        label: m.label ?? null, partnerId: (m.partner as string | undefined) ?? a.partnerId ?? null,
        lines: (m.lines ?? []).map((l): StockMoveLine => ({ account: l.account, debit: l.debit, credit: l.credit, ...(l.partner ? { partnerId: l.partner } : {}), ...(l.note ? { note: l.note } : {}) })),
        createdBy: a.userId,
      };
    })).returning({ id: stockMoves.id });
    ids = rows.map((r) => r.id);
  }
  await postStockJournal(tx, a);
  return ids;
}

/** (Re)post the stock journal of a source from the given moves; unpost it when they carry no lines or are pending. */
async function postStockJournal(tx: Tx, a: Pick<ReplaceMovesInput, 'firmId' | 'sourceType' | 'sourceId' | 'moves' | 'date' | 'description' | 'userId' | 'partnerId' | 'pending'>): Promise<void> {
  const lines = a.pending ? [] : stockJournalLines(a.moves.filter((m) => !m.pend)).map((l) => ({ ...l, partnerId: l.partnerId ?? (a.partnerId || null) }));
  const src = { firmId: a.firmId, sourceType: STOCK_JOURNAL(a.sourceType), sourceId: a.sourceId, userId: a.userId };
  if (!lines.some((l) => l.debit || l.credit)) {
    await unpostSource(tx, src);
    return;
  }
  await postJournal(tx, { ...src, date: a.date, kind: 'zaliha', description: a.description ?? null, lines });
}

/** Re-post the stock journal of a source from its stored moves (after `reaverage` re-valued them). */
export async function repostSourceMoves(tx: Tx, a: { firmId: string; sourceType: string; sourceId: string; date: string; description?: string; userId: string | null }): Promise<void> {
  const rows = await tx.select().from(stockMoves)
    .where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, a.sourceType), eq(stockMoves.sourceId, a.sourceId)));
  await postStockJournal(tx, { ...a, moves: rows.map(toStockMove) });
}

/** Delete the moves of a source and its stock journal. */
export async function removeSourceMoves(tx: Tx, a: { firmId: string; sourceType: string; sourceId: string; userId: string | null }): Promise<number> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!firm) throw new StockDocError('Фирмата не постои.');
  const old = await tx.select({ id: stockMoves.id, date: stockMoves.date }).from(stockMoves)
    .where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, a.sourceType), eq(stockMoves.sourceId, a.sourceId)));
  for (const o of old) assertOpenPeriod(firm, o.date);
  if (old.length) await tx.delete(stockMoves).where(inArray(stockMoves.id, old.map((o) => o.id)));
  await unpostSource(tx, { firmId: a.firmId, sourceType: STOCK_JOURNAL(a.sourceType), sourceId: a.sourceId, userId: a.userId });
  return old.length;
}

/* ------------------------------------------------------------------ misc helpers */

/** Set retail prices per location on items (`items.data.sp[wh]`), legacy `save('items', {...it, sp})`. */
export async function setRetailPrices(tx: Tx, firmId: string, wh: string, prices: ReadonlyMap<string, number>): Promise<void> {
  if (!prices.size) return;
  const rows = await tx.select().from(items).where(and(eq(items.firmId, firmId), inArray(items.id, [...prices.keys()])));
  for (const it of rows) {
    const d = { ...((it.data ?? {}) as Record<string, unknown>) };
    d.sp = { ...((d.sp ?? {}) as Record<string, unknown>), [wh]: prices.get(it.id) };
    await tx.update(items).set({ data: d }).where(eq(items.id, it.id));
  }
}

/** The "POS терминал" partner for card lines on 12x (legacy `posPid`), created on first use. */
export async function ensurePosPartner(tx: Tx, firmId: string, userId: string | null): Promise<string> {
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const pid = (f?.settings as Record<string, unknown> | undefined)?.posPartnerId as string | undefined;
  if (pid) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.id, pid))).limit(1);
    if (p) return p.id;
  }
  const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.name, POS_NAME))).limit(1);
  if (p) return p.id;
  const [c] = await tx.insert(partners).values({ firmId, name: POS_NAME, data: { pos: true } }).returning({ id: partners.id });
  await audit(tx, { userId, firmId, action: 'newS', entityType: 'partner', entityId: c!.id, data: { name: POS_NAME, auto: 'pos' } });
  return c!.id;
}
export const POS_NAME = 'POS терминал';

/** Locations filter helper for `codes` lookups (main or a firm location). */
export const locationWhere = (col: typeof stockMoves.locationId, wh: string | null) => (wh ? eq(col, wh) : isNull(col));

export type { StockJournalLine };
