'use server';
/**
 * Start AI reads for the current firm and poll their state (the generic upload → `ai.read-document` → poll → review
 * flow of `skan`, for receipts, employee documents, bank statements, fiscal reports and BOM suggestions).
 * Office inbox classification starts from `klInbox/actions.ts` (the firm of the message, not the session firm).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { aiErrCodeOf, aiErrText, type AiErrCode } from '@wise/core/ai/errors';
import { z } from 'zod';
import { aiDocuments, audit, files, reusableReads, undismissReads } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { actionError, firmAction } from '@/lib/books';
import { db } from '@/lib/db';
import { AI_RESULT_KIND_ACTION, dispatchAiReads, isAiInputError, isAiResultKind, queueAiReads } from '@/lib/ai';

const Start = z.object({
  kind: z.enum(['blg', 'emp', 'bank', 'fisk', 'bom', 'cmp', 'imp', 'scr', 'ob', 'rec',
    'vreg',
    'rcdoc', 'rclic',
    'tk', 'zm',
    'kontrola',
  ]),
  fileIds: z.array(z.uuid()).max(100).default([]),
  productId: z.uuid().optional(),
  /** Read all files together as ONE document (fiscal report photographed in several parts, legacy `fkTiles`). */
  group: z.boolean().optional(),
  /**
   * A file whose content (sha256) already has a read of this kind in the firm — finished or still running — gets that
   * read back instead of a new one (bank statements dropped again: no second AI read, no waiting).
   */
  reuse: z.boolean().optional(),
});

/** Register uploaded files (or, for `bom`, the product) for reading; one job per row. */
export async function startAiRead(input: z.input<typeof Start>): Promise<{ ids?: string[]; reused?: number; error?: string }> {
  try {
    const v = Start.parse(input);
    const { u, firm } = await firmAction(AI_RESULT_KIND_ACTION[v.kind]);
    if (v.kind === 'bom' ? !v.productId : !v.fileIds.length) return { error: v.kind === 'bom' ? 'Изберете производ.' : 'Изберете датотека.' };
    const grouped = !!v.group && v.kind === 'fisk' && v.fileIds.length > 1;
    if (grouped) {
      // the extra files must belong to the firm as well (queueAiReads checks the first one)
      const ok = await db().select({ id: files.id }).from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, v.fileIds), eq(files.status, 'ready')));
      if (ok.length !== new Set(v.fileIds).size) return { error: 'Датотеката не е пронајдена.' };
    }
    if (v.reuse && !grouped && v.kind !== 'bom') {
      const found = await reusableReads(db(), { firmId: firm.id, kind: v.kind, fileIds: v.fileIds });
      const fresh = [...new Set(v.fileIds.filter((id) => !found.has(id)))];
      const made = fresh.length ? await db().transaction(async (tx) => {
        const ids = await queueAiReads(tx, { firmId: firm.id, userId: u.id, kind: v.kind, fileIds: fresh });
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'aiRead', entityType: 'ai_document', data: { kind: v.kind, count: ids.length, reused: found.size } });
        return ids;
      }) : [];
      const byFile = new Map(fresh.map((f, i) => [f, made[i]!]));
      // a read dismissed earlier and dropped again is offered again
      const again = [...found.values()].filter((r) => r.status === 'done').map((r) => r.id);
      if (again.length) await undismissReads(db(), { firmId: firm.id, ids: again });
      if (made.length) await dispatchAiReads(made);
      return { ids: v.fileIds.map((f) => found.get(f)?.id ?? byFile.get(f)!), reused: found.size };
    }
    const ids = await db().transaction(async (tx) => {
      const ids = await queueAiReads(tx, {
        firmId: firm.id, userId: u.id, kind: v.kind, fileIds: v.kind === 'bom' ? null : grouped ? v.fileIds.slice(0, 1) : v.fileIds,
        ...(v.kind === 'bom' ? { options: { productId: v.productId } } : grouped ? { options: { extraFileIds: v.fileIds.slice(1) } } : {}),
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'aiRead', entityType: 'ai_document', data: { kind: v.kind, count: ids.length, ...(v.productId ? { productId: v.productId } : {}) } });
      return ids;
    });
    await dispatchAiReads(ids);
    return { ids };
  } catch (e) {
    if (isAiInputError(e) || e instanceof z.ZodError) return { error: e instanceof z.ZodError ? 'Неважечки податоци.' : e.message };
    const r = actionError(e);
    return { error: r.error };
  }
}

export interface AiReadState {
  id: string; kind: string; status: string; error: string | null; model: string | null; result: unknown;
  /** Kind of failure (credit, auth, rate, overloaded, timeout, nokey, off, noai, other) — the list offers the free import paths. */
  errCode?: AiErrCode | null;
  /** A large document read in parts: „дел 2/5“. */
  progress?: string | null;
  /** Why AI was used instead of the free reader („скенирано – PDF без текст / слика“, „не се совпаѓаат збировите“). */
  aiWhy?: string | null;
  /** The result was reused from an earlier read of the same file (sha256), no new AI cost. */
  cached?: boolean;
}

/** Current state of reads (only rows of firms the user may read them for). */
export async function aiReadStatus(ids: string[]): Promise<AiReadState[]> {
  const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!ok.length) return [];
  await requireUser();
  const D = await db().select().from(aiDocuments).where(inArray(aiDocuments.id, ok));
  const out: AiReadState[] = [];
  for (const d of D) {
    if (!isAiResultKind(d.kind)) continue;
    try { await requireCan(AI_RESULT_KIND_ACTION[d.kind], d.firmId); } catch { continue; }
    const ec = (d.options as { errCode?: unknown }).errCode;
    out.push({
      id: d.id, kind: d.kind, status: d.status, error: d.error ? aiErrText(d.error, ec) : d.error, model: d.model,
      result: d.status === 'done' || d.status === 'saved' ? d.result : null, errCode: d.status === 'error' ? aiErrCodeOf(d.error, ec) : null,
      progress: d.status === 'reading' ? ((d.options as { progress?: unknown }).progress as string | undefined) ?? null : null,
      aiWhy: (d.options as { aiWhy?: string }).aiWhy ?? null, cached: !!(d.options as { cachedFrom?: string }).cachedFrom,
    });
  }
  return out;
}

/** A read waiting / reading this long may be restarted by the user („↻ Повторно“ on a stuck read). */
const STUCK_MS = 150_000;

/**
 * „↻ Повторно“ on a failed read: queued again, AI is tried even after a recent credit / key failure.
 * With `deep` („🔍 Детално читање“): read again with the detailed model (Opus) — the only way Opus is used.
 * With `stuck`: also a read still `queued` / `reading` that has not changed for a few minutes (its job was lost in a
 * worker restart) — a read that is actually progressing is refused, so it is not paid twice.
 */
export async function retryAiRead(id: string, o: { stuck?: boolean; deep?: boolean } = {}): Promise<{ error?: string }> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Неважечки податоци.' };
    const u = await requireUser();
    const [d] = await db().select().from(aiDocuments).where(eq(aiDocuments.id, id)).limit(1);
    const stuck = !!o.stuck && (d?.status === 'queued' || d?.status === 'reading');
    if (!d || !isAiResultKind(d.kind) || (d.status !== 'error' && !stuck)) return { error: 'Читањето не е пронајдено.' };
    if (stuck && Date.now() - d.updatedAt.getTime() < STUCK_MS) return { error: 'Читањето сè уште трае – почекајте уште малку.' };
    await requireCan(AI_RESULT_KIND_ACTION[d.kind], d.firmId);
    await db().update(aiDocuments).set({ status: 'queued', error: null, options: sql`(${aiDocuments.options} - 'errCode' - 'errDetail' - 'cancelled' - 'progress') || ${o.deep ? '{"retry":true,"deep":true}' : '{"retry":true}'}::jsonb` }).where(eq(aiDocuments.id, id));
    await audit(db(), { userId: u.id, firmId: d.firmId, action: 'aiRead', entityType: 'ai_document', entityId: id, data: { retry: true, ...(stuck ? { stuck: true } : {}), ...(o.deep ? { deep: true } : {}) } });
    await dispatchAiReads([id]);
    return {};
  } catch (e) { return { error: actionError(e).error }; }
}
