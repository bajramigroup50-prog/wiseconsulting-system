/**
 * Shared loaders for the Phase 3 document services: posting context (scheme + VAT accounts of a firm), locations,
 * the domain error type and the actor. Stock context and moves come from Phase 7 (`stock-service.ts`).
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FirmPostingSettings, PostingContext, SchemeSettings, StockLocation } from '@wise/core';
import type { Tx } from '../audit';
import { appSettings, codes, firms, items, type Firm } from '../schema/index';
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
export interface DocActor { userId: string | null; role: string }
export const pendingFor = (a: DocActor) => a.role === 'klient';

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
