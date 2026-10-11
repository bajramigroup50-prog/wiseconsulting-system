'use server';
/**
 * Start AI reads for the current firm and poll their state (the generic upload → `ai.read-document` → poll → review
 * flow of `skan`, for receipts, employee documents, bank statements, fiscal reports and BOM suggestions).
 * Office inbox classification starts from `klInbox/actions.ts` (the firm of the message, not the session firm).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { aiDocuments, audit, files } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { actionError, firmAction } from '@/lib/books';
import { db } from '@/lib/db';
import { AI_RESULT_KIND_ACTION, dispatchAiReads, isAiInputError, isAiResultKind, queueAiReads } from '@/lib/ai';

const Start = z.object({
  kind: z.enum(['blg', 'emp', 'bank', 'fisk', 'bom', 'cmp', 'imp', 'scr', 'ob', 'rec',
    'vreg',
    'rcdoc', 'rclic',
    'tk', 'zm',
  ]),
  fileIds: z.array(z.uuid()).max(100).default([]),
  productId: z.uuid().optional(),
  /** Read all files together as ONE document (fiscal report photographed in several parts, legacy `fkTiles`). */
  group: z.boolean().optional(),
});

/** Register uploaded files (or, for `bom`, the product) for reading; one job per row. */
export async function startAiRead(input: z.input<typeof Start>): Promise<{ ids?: string[]; error?: string }> {
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

export interface AiReadState { id: string; kind: string; status: string; error: string | null; model: string | null; result: unknown }

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
    out.push({ id: d.id, kind: d.kind, status: d.status, error: d.error, model: d.model, result: d.status === 'done' || d.status === 'saved' ? d.result : null });
  }
  return out;
}
