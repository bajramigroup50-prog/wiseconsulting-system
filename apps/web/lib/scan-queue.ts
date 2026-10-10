import 'server-only';
/**
 * Scan queue (legacy `S.scanQ` / `nextScan` 4642 and the batch `S.batchOpen` flow of `purEditor` 4507): after a scanned
 * draft is saved the next unsaved draft of the same run opens automatically. A run is the batch (`masovno`) or, for the
 * single-scan screen, the user's documents of the same kind read in the last 24 hours without a batch.
 */
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { aiDocuments, files, type AiDocument } from '@wise/db';
import { db } from './db';

export interface ScanPos { docId: string; i: number }
export interface ScanQueueInfo {
  /** Unsaved drafts left in the run besides the open one. */
  rest: number;
  next: ScanPos | null;
  batchId: string | null;
  /** File name of the open draft (`name #k/n` when the file held several invoices). */
  name: string;
}

const isUuid = (x: string | undefined | null): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x);

async function runOf(firmId: string, doc: AiDocument): Promise<AiDocument[]> {
  if (doc.batchId) {
    return db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.batchId, doc.batchId))).orderBy(asc(aiDocuments.createdAt));
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  return db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, doc.kind), isNull(aiDocuments.batchId),
    gt(aiDocuments.createdAt, since), doc.createdBy ? eq(aiDocuments.createdBy, doc.createdBy) : undefined)).orderBy(asc(aiDocuments.createdAt));
}

/** Position of an open scanned draft in its run, and the next one to open after saving or skipping it. */
export async function scanQueue(firmId: string, docId: string | undefined, index: number): Promise<ScanQueueInfo | null> {
  if (!isUuid(docId)) return null;
  const [doc] = await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.firmId, firmId))).limit(1);
  if (!doc) return null;
  const run = await runOf(firmId, doc);
  const open: ScanPos[] = [];
  for (const d of run) {
    if (d.status !== 'done') continue;
    d.drafts.forEach((x, i) => { if (!x.savedId && !(d.id === docId && i === index)) open.push({ docId: d.id, i }); });
  }
  // the next one after the current position (wrapping to the first)
  const order = (p: ScanPos) => run.findIndex((d) => d.id === p.docId) * 1000 + p.i;
  const here = order({ docId, i: index });
  const next = open.find((p) => order(p) > here) ?? open[0] ?? null;
  const [f] = doc.fileId ? await db().select({ n: files.name }).from(files).where(eq(files.id, doc.fileId)).limit(1) : [];
  const name = (f?.n ?? '') + (doc.drafts.length > 1 ? ` #${index + 1}/${doc.drafts.length}` : '');
  // documents still being read count as waiting in the queue (legacy „уште N во редица“)
  const reading = run.filter((d) => d.status === 'queued' || d.status === 'reading').length;
  return { rest: open.length + reading, next, batchId: doc.batchId, name };
}

/** Editor URL of a scanned draft (purchase → /vlez, sale → /izlez). */
export async function scanEditorHref(firmId: string, p: ScanPos, back: string): Promise<string> {
  const [d] = await db().select({ kind: aiDocuments.kind }).from(aiDocuments).where(and(eq(aiDocuments.id, p.docId), eq(aiDocuments.firmId, firmId))).limit(1);
  const ed = d?.kind === 'sale' ? '/izlez' : '/vlez';
  return `${ed}?scan=${p.docId}&i=${p.i}&back=${encodeURIComponent(back)}`;
}
