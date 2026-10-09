/**
 * `ai.read-document` — read one uploaded document (`ai_documents` row) and store review drafts.
 *
 * Purchases (legacy `aiReadPurchase` 4679): UBL XML is imported without AI (`ublToScan`); otherwise a quick read
 * (Haiku), and when lines / recapitulation / total do not agree a second, deeper read (Sonnet).
 * Sales invoices (legacy `aiReadSale` 8384): quick read, deeper read only when nothing usable came back.
 * Receipts, employee documents, bank statements, fiscal reports, inbox classification and BOM suggestions
 * (`RESULT_KINDS`, ../ai/kinds.ts) store only the parsed JSON in `result`; their screens map it and the user confirms.
 *
 * Errors (no API key, unreadable file, refusal) are stored on the row for the review UI; the job does not throw, so
 * pg-boss does not retry and spend tokens again.
 */
import { eq } from 'drizzle-orm';
import { fixRates, scanResultConsistent, scanInvoices, ublToScan, type ScanResult } from '@wise/core/sales';
import { aiDocuments, firms, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { PUR_PROMPT, SALE_PROMPT } from '../ai/prompts';
import { fileContent, loadFile, readContent } from '../ai/read-document';
import { purchaseDrafts, saleDrafts } from '../ai/drafts';
import { readObject } from '../ai/storage';
import { readResultKind, RESULT_KINDS } from '../ai/kinds';

export const AI_READ_DOCUMENT = 'ai.read-document';

const fx = (r: ScanResult | null) => { if (r) for (const x of scanInvoices(r)) fixRates(x); return r; };
const has = (r: ScanResult | null) => !!r && scanInvoices(r).some((x) => (x.lines ?? []).length || (x.groups ?? []).length);

/** The work of the job, separated for tests. */
export async function runReadDocument(db: Tx, docId: string, log: (m: string) => void = () => {}): Promise<void> {
  const [doc] = await db.select().from(aiDocuments).where(eq(aiDocuments.id, docId)).limit(1);
  if (!doc || !['queued', 'error', 'reading'].includes(doc.status)) return;
  const [f] = await db.select().from(firms).where(eq(firms.id, doc.firmId)).limit(1);
  if (!f) return;
  await db.update(aiDocuments).set({ status: 'reading', error: null }).where(eq(aiDocuments.id, docId));
  try {
    if (RESULT_KINDS.has(doc.kind)) {
      if (!aiConfigured()) throw new AiUnavailableError();
      const { result, model } = await readResultKind(db, doc, f);
      await db.update(aiDocuments).set({ status: 'done', result, drafts: [], model }).where(eq(aiDocuments.id, docId));
      log(`${docId}: ${doc.kind} read via ${model}`);
      return;
    }
    if (!doc.fileId) throw new Error('Датотеката не е пронајдена.');
    const file = await loadFile(db, f.id, doc.fileId);
    const bytes = await readObject(file.bucketKey);
    let result: ScanResult | null = null;
    let model: string | null = null;
    if (/\.xml$/i.test(file.name) || /xml/.test(file.mime)) {
      result = ublToScan(new TextDecoder('utf-8').decode(bytes));
      if (result) model = 'ubl';
    }
    if (!result) {
      if (!aiConfigured()) throw new AiUnavailableError();
      const content = fileContent(file, bytes);
      const prompt = doc.kind === 'sale' ? SALE_PROMPT(f) : PUR_PROMPT;
      const base = { db, firmId: f.id, prompt, purpose: doc.kind, refId: doc.id, userId: doc.createdBy };
      let quick: ScanResult | null = null;
      try {
        const r = await readContent<ScanResult>({ ...base, tier: 'quick' }, content);
        quick = fx(r.data);
        model = r.model;
      } catch (e) {
        if (e instanceof AiUnavailableError) throw e;
        log(`quick read failed: ${(e as Error).message}`);
      }
      const good = doc.kind === 'sale' ? scanResultConsistent(quick) || has(quick) : scanResultConsistent(quick);
      if (good) result = quick;
      else {
        const r = await readContent<ScanResult>({ ...base, tier: 'default' }, content);
        result = fx(r.data) ?? quick;
        model = r.model;
      }
    }
    if (!result || !scanInvoices(result).length) throw new Error('Документот не е прочитан јасно. Пробајте појасна слика.');
    const opts = doc.options as { cash?: boolean; warehouseId?: string | null; costOnly?: boolean };
    const drafts = doc.kind === 'sale' ? await saleDrafts(db, f, result) : await purchaseDrafts(db, f, result, opts);
    await db.update(aiDocuments).set({ status: 'done', result, drafts, model }).where(eq(aiDocuments.id, docId));
    log(`${docId}: ${drafts.length} draft(s) via ${model}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(aiDocuments).set({ status: 'error', error: msg }).where(eq(aiDocuments.id, docId));
    log(`${docId}: ${msg}`);
  }
}

export const aiReadDocument = defineJob<{ docId: string }>({
  name: AI_READ_DOCUMENT,
  async run(data, { db, log }) {
    if (data?.docId) await runReadDocument(db, data.docId, log);
  },
});
