/** Review-side helpers for `ai_documents` (the worker writes them, the review UI consumes the drafts). */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../audit';
import { aiDocuments, type AiDocument } from '../schema/index';
import { DocumentError } from './context';

export async function loadAiDocument(tx: Tx, firmId: string, id: string): Promise<AiDocument> {
  const [d] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firmId))).limit(1);
  if (!d) throw new DocumentError('Скенираниот документ не постои.');
  return d;
}

/** Record that draft `index` of a read document was saved as `savedId`; the document is `saved` when all are. */
export async function markDraftSaved(tx: Tx, firmId: string, docId: string, index: number, savedId: string): Promise<void> {
  const d = await loadAiDocument(tx, firmId, docId);
  const drafts = d.drafts.map((x, i) => (i === index ? { ...x, savedId } : x));
  await tx.update(aiDocuments).set({ drafts, status: drafts.every((x) => x.savedId) ? 'saved' : d.status }).where(eq(aiDocuments.id, docId));
}
