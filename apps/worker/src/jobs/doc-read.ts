/**
 * `ai.read-doc` — read a document that fills a record (`doc_reads`): `travel` = a travel order (патен налог) made by
 * the transport client → driver, vehicle, foreign countries with entry / exit times (for the per diems abroad). Text
 * `tripcost` = road-expense receipts of a trip (fuel, tolls, parking… from any country, the cash-receipt reader).
 * PDFs and scans / photos go to the model; the cleaned result is stored on the row. Errors are stored (no retries).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { normalizeTravelRead, TRAVEL_ORDER_PROMPT } from '@wise/core/industry';
import { docReads, files, getAiSettings, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { AiReadError, fileContent, readContent } from '../ai/read-document';
import { readObject } from '../ai/storage';
import { BLG_PAGES_ADD, BLG_PROMPT } from '../ai/prompts';
import { readReceipts } from '@wise/core/ai/receipts';

export const AI_READ_DOC = 'ai.read-doc';

export async function runDocRead(db: Tx, id: string): Promise<void> {
  const [row] = await db.select().from(docReads).where(eq(docReads.id, id)).limit(1);
  if (!row || !['queued', 'error'].includes(row.status)) return;
  await db.update(docReads).set({ status: 'reading', error: null }).where(eq(docReads.id, id));
  try {
    const S = await getAiSettings(db);
    if (!S.enabled) throw new AiReadError('AI-читањето е исклучено – внесете го рачно.');
    if (!aiConfigured()) throw new AiUnavailableError();
    const F = await db.select().from(files).where(and(inArray(files.id, row.fileIds), eq(files.firmId, row.firmId), eq(files.status, 'ready')));
    if (!F.length) throw new AiReadError('Датотеката не е пронајдена.');
    const content = { blocks: [] as ReturnType<typeof fileContent>['blocks'], extra: '' };
    for (const f of F) { const c = fileContent(f, await readObject(f.bucketKey)); content.blocks.push(...c.blocks); content.extra += c.extra; }
    const cost = row.kind === 'tripcost';
    const r = await readContent<unknown>({ db, firmId: row.firmId, prompt: cost ? BLG_PROMPT + BLG_PAGES_ADD : TRAVEL_ORDER_PROMPT, tier: 'default', purpose: cost ? 'tripCost' : 'travelOrder', refId: id, userId: row.createdBy }, content);
    const result = cost ? { receipts: readReceipts(r.data) } : normalizeTravelRead(r.data);
    await db.update(docReads).set({ status: 'done', result: result as unknown as Record<string, unknown>, model: r.model }).where(eq(docReads.id, id));
  } catch (e) {
    await db.update(docReads).set({ status: 'error', error: ((e as Error).message || 'Не успеа читањето.').slice(0, 500) }).where(eq(docReads.id, id));
  }
}

export const docRead = defineJob<{ id: string }>({
  name: AI_READ_DOC,
  queue: { retryLimit: 0, expireInSeconds: 5 * 60 },
  async run(data, { db, log }) {
    await runDocRead(db as unknown as Tx, data.id);
    log(`doc read ${data.id}`);
  },
});
