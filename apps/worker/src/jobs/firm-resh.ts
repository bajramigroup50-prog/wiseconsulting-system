/**
 * `ai.read-firm-resh` — read a registration decision (legacy `fsRead` 10578) before the firm exists. Electronic ЦРСМ /
 * УЈП documents (Решение за упис, Тековна состојба, Историјат, ДДВ решение / потврда — PDF with a text layer) are read
 * FIRST without AI (`firmReshFree`, model `noai`, „прочитано без AI – проверете“); the pages go to the model with
 * `FS_PROMPT` only for scans / photos or when the free read misses a required field (назив, ЕМБС / ЕДБ, ДДВ од).
 * When AI is off / not configured / fails, a partial free read is still shown (with what is missing); otherwise the
 * error is stored on the row (no retries).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { FS_PROMPT, normalizeResh } from '@wise/core/firms/resh';
import { reshMissing, type ReshFree } from '@wise/core/noai/firm-resh';
import { files, firmReshReads, getAiSettings, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { NOAI_MODEL } from '../ai/free-read';
import { firmReshFree } from '../ai/firm-resh-free';
import { AiReadError, fileContent, readContent } from '../ai/read-document';
import { readObject } from '../ai/storage';

export const AI_READ_FIRM_RESH = 'ai.read-firm-resh';
const SCAN_MSG = 'Документот нема текст што може да се прочита без AI (скен / слика) – потребно е AI или рачен внес.';

export async function runReadFirmResh(db: Tx, id: string): Promise<void> {
  const [row] = await db.select().from(firmReshReads).where(eq(firmReshReads.id, id)).limit(1);
  if (!row || !['queued', 'error', 'reading'].includes(row.status)) return;
  await db.update(firmReshReads).set({ status: 'reading', error: null }).where(eq(firmReshReads.id, id));
  const saveFree = (r: ReshFree, why?: string) =>
    db.update(firmReshReads).set({ status: 'done', result: why ? { ...r, warnings: [...r.warnings, why] } : r, model: NOAI_MODEL }).where(eq(firmReshReads.id, id));
  let free: ReshFree | null = null;
  try {
    const F = await db.select().from(files).where(and(inArray(files.id, row.fileIds), isNull(files.firmId), eq(files.status, 'ready')));
    if (!F.length) throw new AiReadError('Датотеката не е пронајдена.');
    const loaded: { file: (typeof F)[number]; bytes: Uint8Array }[] = [];
    for (const f of row.fileIds.map((x) => F.find((y) => y.id === x)).filter((x): x is (typeof F)[number] => !!x)) loaded.push({ file: f, bytes: await readObject(f.bucketKey) });

    // 1) free read of electronic documents
    free = await firmReshFree(loaded);
    if (free && !reshMissing(free).length) { await saveFree(free); return; }

    // 2) AI for scans / photos / incomplete text
    const S = await getAiSettings(db);
    if (!S.enabled || !aiConfigured()) {
      if (free) { await saveFree(free, S.enabled ? 'AI не е поставено – останатите полиња пополнете ги рачно' : 'AI-читањето е исклучено – останатите полиња пополнете ги рачно'); return; }
      throw S.enabled ? new AiUnavailableError(`${SCAN_MSG} ${new AiUnavailableError().message}`) : new AiReadError(`${SCAN_MSG} AI-читањето е исклучено.`);
    }
    const content = { blocks: [] as ReturnType<typeof fileContent>['blocks'], extra: '' };
    for (const { file, bytes } of loaded) {
      const c = fileContent(file, bytes);
      content.blocks.push(...c.blocks);
      content.extra += c.extra;
    }
    const r = await readContent<unknown>({ db, firmId: null as unknown as string, prompt: FS_PROMPT, tier: 'default', purpose: 'firmResh', refId: id, userId: row.createdBy }, content);
    await db.update(firmReshReads).set({ status: 'done', result: normalizeResh(r.data), model: r.model }).where(eq(firmReshReads.id, id));
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 500) || 'Не успеа читањето.';
    // AI failed, but the text gave part of the data: show it (with the reason) instead of an error
    if (free) { await saveFree(free, `AI не успеа: ${msg.slice(0, 200)}`); return; }
    await db.update(firmReshReads).set({ status: 'error', error: msg }).where(eq(firmReshReads.id, id));
  }
}

export const firmResh = defineJob<{ id: string }>({
  name: AI_READ_FIRM_RESH,
  async run(data, { db, log }) {
    await runReadFirmResh(db, data.id);
    log(`firm decision ${data.id} read`);
  },
});
