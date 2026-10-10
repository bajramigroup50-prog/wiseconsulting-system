/**
 * `ai.read-firm-resh` — read a scanned registration decision (legacy `fsRead` 10578) before the firm exists: the pages
 * (office-wide files) go to the model together with `FS_PROMPT`; the normalised result is stored on the
 * `firm_resh_reads` row for the review form. Errors are stored on the row (no retries).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { FS_PROMPT, normalizeResh } from '@wise/core/firms/resh';
import { files, firmReshReads, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { AiReadError, fileContent, readContent } from '../ai/read-document';
import { readObject } from '../ai/storage';

export const AI_READ_FIRM_RESH = 'ai.read-firm-resh';

export async function runReadFirmResh(db: Tx, id: string): Promise<void> {
  const [row] = await db.select().from(firmReshReads).where(eq(firmReshReads.id, id)).limit(1);
  if (!row || !['queued', 'error', 'reading'].includes(row.status)) return;
  await db.update(firmReshReads).set({ status: 'reading', error: null }).where(eq(firmReshReads.id, id));
  try {
    if (!aiConfigured()) throw new AiUnavailableError();
    const F = await db.select().from(files).where(and(inArray(files.id, row.fileIds), isNull(files.firmId), eq(files.status, 'ready')));
    if (!F.length) throw new AiReadError('Датотеката не е пронајдена.');
    const content = { blocks: [] as ReturnType<typeof fileContent>['blocks'], extra: '' };
    for (const f of row.fileIds.map((x) => F.find((y) => y.id === x)).filter((x): x is (typeof F)[number] => !!x)) {
      const c = fileContent(f, await readObject(f.bucketKey));
      content.blocks.push(...c.blocks);
      content.extra += c.extra;
    }
    const r = await readContent<unknown>({ db, firmId: null as unknown as string, prompt: FS_PROMPT, tier: 'default', purpose: 'firmResh', refId: id, userId: row.createdBy }, content);
    await db.update(firmReshReads).set({ status: 'done', result: normalizeResh(r.data), model: r.model }).where(eq(firmReshReads.id, id));
  } catch (e) {
    await db.update(firmReshReads).set({ status: 'error', error: (e as Error).message?.slice(0, 500) || 'Не успеа читањето.' }).where(eq(firmReshReads.id, id));
  }
}

export const firmResh = defineJob<{ id: string }>({
  name: AI_READ_FIRM_RESH,
  async run(data, { db, log }) {
    await runReadFirmResh(db, data.id);
    log(`firm decision ${data.id} read`);
  },
});
