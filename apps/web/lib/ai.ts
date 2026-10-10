import 'server-only';
/**
 * AI reads started from the web (the reading itself is the worker job `ai.read-document`, see
 * `apps/worker/src/ai/kinds.ts`). One `ai_documents` row per file (or one without a file for `bom`), enqueued after the
 * transaction through `enqueue` (lib/jobs.ts). The screen polls the rows (`aiReadStatus`, app/(app)/_ai/actions.ts)
 * and lets the user apply the result — nothing is saved from the read itself.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { aiDocuments, files, type AiDocKind, type AiDocument, type Tx } from '@wise/db';
import { db } from './db';
import { enqueue } from './jobs';

export const AI_READ_DOCUMENT = 'ai.read-document';

/** Kinds whose result the web maps itself, and the permission needed to start / read them. */
export const AI_RESULT_KIND_ACTION = { blg: 'blgSave', emp: 'write', bank: 'write', fisk: 'fkPost', bom: 'saveBom', classify: 'office', cmp: 'del', imp: 'savePur', scr: 'write' } as const;
export type AiResultKind = keyof typeof AI_RESULT_KIND_ACTION;
export const isAiResultKind = (k: unknown): k is AiResultKind => typeof k === 'string' && k in AI_RESULT_KIND_ACTION;

class AiInputError extends Error {}

/** Insert the read requests (inside the caller's transaction, after its `requireCan`); returns the row ids. */
export async function queueAiReads(tx: Tx, a: { firmId: string; userId: string | null; kind: AiDocKind; fileIds: string[] | null; options?: Record<string, unknown> }): Promise<string[]> {
  const opts = a.options ?? {};
  if (a.fileIds === null) {
    const [d] = await tx.insert(aiDocuments).values({ firmId: a.firmId, fileId: null, kind: a.kind, options: opts, createdBy: a.userId }).returning({ id: aiDocuments.id });
    return [d!.id];
  }
  if (!a.fileIds.length) throw new AiInputError('Изберете датотека.');
  const F = await tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, a.firmId), inArray(files.id, a.fileIds), eq(files.status, 'ready')));
  if (F.length !== new Set(a.fileIds).size) throw new AiInputError('Датотеката не е пронајдена.');
  const R = await tx.insert(aiDocuments).values(a.fileIds.map((fileId) => ({ firmId: a.firmId, fileId, kind: a.kind, options: opts, createdBy: a.userId })))
    .returning({ id: aiDocuments.id });
  return R.map((r) => r.id);
}

/** Enqueue the reads (after the transaction committed). */
export async function dispatchAiReads(ids: string[]): Promise<void> {
  for (const id of ids) await enqueue(AI_READ_DOCUMENT, { docId: id });
}

export const isAiInputError = (e: unknown): e is Error => e instanceof AiInputError;

/** A finished read of the firm (for pages that prefill an editor from `?ai=<id>`). */
export async function loadAiResult(firmId: string, id: string | undefined, kind: AiDocKind): Promise<AiDocument | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, kind))).limit(1);
  return d && (d.status === 'done' || d.status === 'saved') ? d : null;
}

/** Mark reads as used (the user saved what was read). */
export async function markAiReadsSaved(tx: Tx, firmId: string, ids: string[]): Promise<void> {
  const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ok.length) await tx.update(aiDocuments).set({ status: 'saved' }).where(and(eq(aiDocuments.firmId, firmId), inArray(aiDocuments.id, ok)));
}
