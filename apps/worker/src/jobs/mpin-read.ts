/**
 * `mpin.read` — read one МПИН „Декларација за прием“ of the all-firms inbox (legacy `mpinAdd` → `mpinRead` 14058 / v453
 * 14152): the model reads the PDF or image (`MPIN_ASK`), `mpinNorm` normalises it, and the firm is found by ЕДБ / name
 * (`mpinFirmOf`). The model reads scanned PDFs directly, so the legacy pdf.js → image → OCR fallback is not needed.
 * Errors are stored on the row (no throw → no pg-boss retry spending tokens again).
 */
import { eq } from 'drizzle-orm';
import { mpinFirmOf, mpinNorm, mpinOk } from '@wise/core/law';
import { firms, files, mpinInbox, mpinInboxFallback, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { MPIN_ASK, MPIN_ASK_PDF } from '../ai/prompts';
import { AiReadError, fileContent, readContent } from '../ai/read-document';
import { readObject } from '../ai/storage';

export const MPIN_READ = 'mpin.read';

export async function runMpinRead(db: Tx, rowId: string, log: (m: string) => void = () => {}): Promise<void> {
  const [row] = await db.select().from(mpinInbox).where(eq(mpinInbox.id, rowId)).limit(1);
  if (!row || !['queued', 'reading', 'error', 'notm', 'ok'].includes(row.status)) return;
  await db.update(mpinInbox).set({ status: 'reading', error: null }).where(eq(mpinInbox.id, rowId));
  try {
    if (!aiConfigured()) throw new AiUnavailableError();
    const [f] = await db.select().from(files).where(eq(files.id, row.fileId)).limit(1);
    if (!f || f.status !== 'ready') throw new AiReadError('Датотеката не е пронајдена.');
    const content = fileContent(f, await readObject(f.bucketKey));
    const pdf = content.blocks.some((b) => b.type === 'document');
    const r = await readContent<unknown>({ db, firmId: f.firmId, prompt: pdf ? MPIN_ASK_PDF : MPIN_ASK, tier: 'default', purpose: 'mpin', refId: row.id, userId: row.createdBy }, content);
    const M = mpinNorm(r.data);
    M.how = pdf ? 'PDF' : 'слика';
    const F = await db.select({ id: firms.id, name: firms.name, edb: firms.edb }).from(firms).where(eq(firms.active, true));
    const firm = row.firmId ? null : mpinFirmOf(F, M.edb, M.name);
    await db.update(mpinInbox).set({
      status: mpinOk(M) ? 'ok' : 'notm', result: M as unknown as Record<string, unknown>, model: r.model, ...(firm ? { firmId: firm.id } : {}),
    }).where(eq(mpinInbox.id, rowId));
    log(`${rowId}: ${M.period} ${M.edb} → ${firm?.name ?? row.firmId ?? '?'}`);
    // a payroll file routed from the client inbox that is not an МПИН goes to the dossier (legacy irRoute → irArch)
    if (!mpinOk(M) && await db.transaction((tx) => mpinInboxFallback(tx, rowId))) log(`${rowId}: not an МПИН → dossier`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(mpinInbox).set({ status: 'error', error: msg || 'не успеа читањето' }).where(eq(mpinInbox.id, rowId));
    log(`${rowId}: ${msg}`);
  }
}

export const mpinRead = defineJob<{ rowId: string }>({
  name: MPIN_READ,
  async run(data, { db, log }) {
    if (data?.rowId) await runMpinRead(db, data.rowId, log);
  },
});
