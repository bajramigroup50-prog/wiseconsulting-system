/**
 * Shared loaders for the Phase 3 document services: posting context (scheme + VAT accounts of a firm), stock
 * context (moves, items, locations), the domain error type and the actor.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FirmPostingSettings, PostingContext, SchemeSettings, StockContext, StockItem, StockLocation, StockMove } from '@wise/core';
import type { Tx } from '../audit';
import { appSettings, codes, firms, items, stockMoves, type Firm } from '../schema/index';
import { PostingError } from '../posting';

/**
 * A business-rule violation while saving a document (Macedonian message for the UI). Extends the posting error so
 * the existing web `actionError` shows it to the user.
 */
export class DocumentError extends PostingError {
  constructor(message: string) {
    super('not_found', message);
    this.name = 'DocumentError';
  }
}

/** Who saves the document. A `klient` user's documents are stored as `pending` and not booked. */
export interface Actor { userId: string | null; role: string }
export const pendingFor = (a: Actor) => a.role === 'klient';

const S = (f: Pick<Firm, 'settings'>) => (f.settings ?? {}) as Record<string, unknown>;

/** Posting context of a firm: firm overrides (`settings.sch`, `vatOut/vatIn/vatImp/vatInKonto`, `posK`) + office scheme. */
export async function firmPostingContext(tx: Tx, f: Firm): Promise<PostingContext> {
  const s = S(f);
  const [g] = await tx.select().from(appSettings).where(eq(appSettings.key, 'schemes')).limit(1);
  const firm: FirmPostingSettings = {
    ddv: f.vatRegistered,
    sch: (s.sch as FirmPostingSettings['sch']) ?? null,
    vatOut: (s.vatOut as FirmPostingSettings['vatOut']) ?? null,
    vatIn: (s.vatIn as FirmPostingSettings['vatIn']) ?? null,
    vatImp: (s.vatImp as FirmPostingSettings['vatImp']) ?? null,
    vatInKonto: (s.vatInKonto as string) ?? null,
    posK: (s.posK as string) ?? null,
  };
  return { firm, global: (g?.value as SchemeSettings | undefined) ?? null };
}

export async function loadFirmForUpdate(tx: Tx, firmId: string): Promise<Firm> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new DocumentError('Фирмата не постои.');
  return f;
}

/** Warehouse / store rows of a firm as stock locations. */
export async function stockLocations(tx: Tx, firmId: string): Promise<StockLocation[]> {
  const rows = await tx.select().from(codes).where(and(eq(codes.firmId, firmId), inArray(codes.cb, ['warehouse', 'store'])));
  return rows.map((r) => {
    const d = r.data as Record<string, unknown>;
    return { id: r.id, kind: r.cb === 'store' ? 'store' : 'warehouse', code: r.code ?? undefined, name: r.name,
      konto: (d.konto as string) || undefined, kMarg: (d.kMarg as string) || undefined, kVat: (d.kVat as string) || undefined };
  });
}

export const toStockItem = (r: typeof items.$inferSelect): StockItem => {
  const d = r.data as Record<string, unknown>;
  return {
    id: r.id, name: r.name, code: r.code ?? undefined, unit: r.unit ?? undefined, type: r.type, price: r.price ?? 0, rate: r.vatRate,
    sp: (d.sp as StockItem['sp']) ?? undefined, cost: (d.cost as number | undefined) ?? undefined,
    rawK: r.rawAccount ?? undefined, costPrice: r.costPrice ?? undefined, costPct: r.costPct ?? undefined,
  };
};

/**
 * Stock context for computing issues of `itemIds`: all their non-pending moves (except those of `exclude`, the
 * document being re-saved), the items, the firm's locations and scheme overrides.
 */
export async function stockContextFor(tx: Tx, f: Firm, itemIds: readonly string[], ctx: PostingContext, exclude?: { sourceType: string; sourceId: string }[]): Promise<StockContext> {
  const ids = [...new Set(itemIds)];
  const [M, I, L] = await Promise.all([
    ids.length ? tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, f.id), inArray(stockMoves.itemId, ids), eq(stockMoves.pending, false))) : [],
    ids.length ? tx.select().from(items).where(and(eq(items.firmId, f.id), inArray(items.id, ids))) : [],
    stockLocations(tx, f.id),
  ]);
  const ex = new Set((exclude ?? []).map((e) => e.sourceType + '|' + e.sourceId));
  const moves: StockMove[] = M.filter((m) => !ex.has(m.sourceType + '|' + m.sourceId)).map((m) => ({
    id: m.id, date: m.date, item: m.itemId, qty: Number(m.qty), value: Number(m.value), type: m.moveType,
    src: m.sourceType + ':' + m.sourceId, wh: m.warehouseId ?? 'main',
  }));
  const sch = (ctx.firm.sch ?? {}) as Record<string, unknown>;
  const g = (ctx.global?.sch ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (sch[k] !== undefined && sch[k] !== '' ? sch[k] : g[k] !== undefined && g[k] !== '' ? g[k] : undefined);
  const scheme: Record<string, unknown> = {};
  for (const k of ['stock', 'material', 'product', 'cogs', 'cogsP', 'retailMethod', 'whSaleMethod', 'retailStock', 'retailMarg', 'retailVat', 'whStock', 'whMarg', 'whVat']) {
    const v = pick(k);
    if (v !== undefined) scheme[k] = v;
  }
  return { moves, items: I.map(toStockItem), locations: L, scheme, vatRegistered: f.vatRegistered };
}

/** `null`/'main' → null warehouse id. */
export const whId = (w: string | null | undefined) => (w && w !== 'main' ? w : null);

/** Items of a firm by id (validates ownership). */
export async function firmItems(tx: Tx, firmId: string, ids: readonly string[]) {
  const U = [...new Set(ids.filter(Boolean))];
  if (!U.length) return new Map<string, typeof items.$inferSelect>();
  const rows = await tx.select().from(items).where(and(eq(items.firmId, firmId), inArray(items.id, U)));
  if (rows.length !== U.length) throw new DocumentError('Артиклот не постои во оваа фирма.');
  return new Map(rows.map((r) => [r.id, r]));
}

/** Codes row must be a warehouse/store of the firm. */
export async function assertLocation(tx: Tx, firmId: string, id: string | null): Promise<void> {
  if (!id) return;
  const [r] = await tx.select({ id: codes.id }).from(codes).where(and(eq(codes.id, id), eq(codes.firmId, firmId), inArray(codes.cb, ['warehouse', 'store']), or(isNull(codes.active), eq(codes.active, true)))).limit(1);
  if (!r) throw new DocumentError('Магацинот / продавницата не постои.');
}
