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
 * pg-boss does not retry and spend tokens again. Provider errors (credit exhausted, key refused, rate limit, overload,
 * timeout) are stored as a clear Macedonian message (`@wise/core/ai/errors`) with the code and the raw text in
 * `options.errCode` / `options.errDetail`; credit / key failures are remembered office-wide (`app_settings.ai`).
 *
 * Without AI (switched off in Систем, no key, credit / key failure in the last 15 minutes, or the AI call failed):
 * bank statements, trial balances and invoices with a text layer / XML / CSV are read by the free readers
 * (`../ai/free-read.ts`, model `noai`); other documents get the message with the free import paths.
 */
import { and, eq } from 'drizzle-orm';
import { fixRates, scanResultConsistent, scanInvoices, ublToScan, type ScanResult } from '@wise/core/sales';
import { aiDocuments, firms, type DB, type Tx } from '@wise/db';
import { s3Store, storeFile, type ObjectStore } from '../storage';
import { splitInvoicePdf } from '../ai/split';
import { defineJob } from '../job';
import { AI_ERR_BLOCKING, AI_ERR_MSG, aiProviderError, type AiErrCode } from '@wise/core/ai/errors';
import { clearAiFailure, getAiSettings, noteAiFailure } from '@wise/db';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { FREE_KINDS, freeRead, NOAI_MODEL } from '../ai/free-read';
import { PUR_PROMPT, SALE_PROMPT } from '../ai/prompts';
import { fileContent, loadFile, readContent } from '../ai/read-document';
import { purchaseDrafts, saleDrafts } from '../ai/drafts';
import { readObject } from '../ai/storage';
import { readResultKind, RESULT_KINDS } from '../ai/kinds';

export const AI_READ_DOCUMENT = 'ai.read-document';

const fx = (r: ScanResult | null) => { if (r) for (const x of scanInvoices(r)) fixRates(x); return r; };
/** A failure with a user message and a code (stored on the row). */
class ReadFail extends Error { constructor(public code: AiErrCode, msg: string, public detail = '') { super(msg); } }
const BLOCK_MS = 15 * 60_000;

const has = (r: ScanResult | null) => !!r && scanInvoices(r).some((x) => (x.lines ?? []).length || (x.groups ?? []).length);

/** The work of the job, separated for tests. */
export async function runReadDocument(db: Tx, docId: string, log: (m: string) => void = () => {}, store: ObjectStore = s3Store): Promise<void> {
  const [doc] = await db.select().from(aiDocuments).where(eq(aiDocuments.id, docId)).limit(1);
  if (!doc || !['queued', 'error', 'reading'].includes(doc.status)) return;
  // legacy „Откажи читање“ (`outCancel`): a cancelled read is not started, and a running one does not overwrite it
  if ((doc.options as { cancelled?: boolean }).cancelled) return;
  const [f] = await db.select().from(firms).where(eq(firms.id, doc.firmId)).limit(1);
  if (!f) return;
  await db.update(aiDocuments).set({ status: 'reading', error: null }).where(eq(aiDocuments.id, docId));
  const S = await getAiSettings(db);
  const retry = !!(doc.options as { retry?: boolean }).retry;
  const blocked = !!S.lastFail && !retry && Date.now() - Date.parse(S.lastFail.at) < BLOCK_MS;
  /** Why AI is not used for this read (null = use AI). */
  const noAi: AiErrCode | null = !S.enabled ? 'off' : !aiConfigured() ? 'nokey' : blocked ? S.lastFail!.code : null;
  /** Free read of the document's file; null when not possible. */
  const free = async (): Promise<unknown | null> => {
    if (!FREE_KINDS.has(doc.kind) || !doc.fileId) return null;
    try {
      const file = await loadFile(db, f.id, doc.fileId);
      return await freeRead(doc.kind, file, await readObject(file.bucketKey), { ownEdb: f.edb });
    } catch (e) {
      // ambiguous amounts („10.000“) that the totals do not decide: flagged, never guessed
      if (e instanceof Error && e.name === 'AmbiguousAmountsError') throw new ReadFail('noai', e.message);
      return null;
    }
  };
  /** AI not usable / failed: try the free reader, otherwise fail with the code's message. */
  const fallback = async (code: AiErrCode, detail = ''): Promise<{ result: unknown; model: string }> => {
    const r = await free();
    if (r) return { result: r, model: NOAI_MODEL };
    throw new ReadFail(code, code === 'nokey' ? new AiUnavailableError().message : AI_ERR_MSG[code], detail);
  };
  /** Run an AI read; provider errors are classified, blocking ones remembered, then the free reader is tried. */
  const viaAi = async <T>(f0: () => Promise<T>): Promise<T | { result: unknown; model: string; free: true }> => {
    try {
      const r = await f0();
      if (S.lastFail) await clearAiFailure(db);
      return r;
    } catch (e) {
      if (e instanceof AiUnavailableError) return { ...(await fallback('nokey')), free: true };
      const p = aiProviderError(e);
      if (!p) throw e;
      if (AI_ERR_BLOCKING.has(p.code)) await noteAiFailure(db, p.code, p.detail);
      return { ...(await fallback(p.code, p.detail)), free: true };
    }
  };
  try {
    if (RESULT_KINDS.has(doc.kind)) {
      const { result, model } = noAi ? await fallback(noAi) : await viaAi(() => readResultKind(db, doc, f));
      await db.update(aiDocuments).set({ status: 'done', result, drafts: [], model }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
      log(`${docId}: ${doc.kind} read via ${model}`);
      return;
    }
    if (!doc.fileId) throw new Error('Датотеката не е пронајдена.');
    const file = await loadFile(db, f.id, doc.fileId);
    const bytes = await readObject(file.bucketKey);
    // legacy `invSplit` (13685): a PDF with several invoices is cut into one PDF per invoice, each read on its own
    const opts0 = doc.options as { split?: boolean; noSplit?: boolean };
    if (!opts0.split && !opts0.noSplit && !noAi && (file.mime === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      const parts = await splitInvoicePdf({ db, firmId: f.id, refId: doc.id, userId: doc.createdBy, name: file.name, bytes, purpose: doc.kind });
      if (parts) {
        const ids: string[] = [];
        for (const pt of parts) {
          const fileId = await storeFile(db as unknown as DB, store, { firmId: f.id, name: pt.name, mime: 'application/pdf', ext: 'pdf', body: pt.bytes, userId: doc.createdBy });
          const [c] = await db.insert(aiDocuments).values({ firmId: f.id, fileId, kind: doc.kind, batchId: doc.batchId, createdBy: doc.createdBy, options: { ...doc.options, split: true, parentId: doc.id } }).returning({ id: aiDocuments.id });
          ids.push(c!.id);
        }
        await db.update(aiDocuments).set({ status: 'done', drafts: [], result: { split: ids }, batchId: null, options: { ...doc.options, inline: true } }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
        log(`${docId}: split into ${ids.length} invoices`);
        for (const id of ids) await runReadDocument(db, id, log, store);
        return;
      }
    }
    let result: ScanResult | null = null;
    let model: string | null = null;
    if (/\.xml$/i.test(file.name) || /xml/.test(file.mime)) {
      result = ublToScan(new TextDecoder('utf-8').decode(bytes));
      if (result) model = 'ubl';
    }
    if (!result && noAi) {
      const r = await fallback(noAi);
      result = r.result as ScanResult; model = r.model;
    }
    if (!result) {
      const content = fileContent(file, bytes);
      const prompt = doc.kind === 'sale' ? SALE_PROMPT(f) : PUR_PROMPT;
      const base = { db, firmId: f.id, prompt, purpose: doc.kind, refId: doc.id, userId: doc.createdBy };
      let quick: ScanResult | null = null;
      // legacy `outDeep` / `outRunDeep`: a deeper read straight away (no quick read)
      const deep = !!(doc.options as { deep?: boolean }).deep;
      const R = await viaAi(async () => {
        if (!deep) try {
          const r = await readContent<ScanResult>({ ...base, tier: 'quick' }, content);
          quick = fx(r.data);
          model = r.model;
        } catch (e) {
          if (e instanceof AiUnavailableError || aiProviderError(e)) throw e;
          log(`quick read failed: ${(e as Error).message}`);
        }
        const good = doc.kind === 'sale' ? scanResultConsistent(quick) || has(quick) : scanResultConsistent(quick);
        if (good) return { result: quick, model };
        const r = await readContent<ScanResult>({ ...base, tier: 'default' }, content);
        return { result: fx(r.data) ?? quick, model: r.model };
      });
      result = R.result as ScanResult | null;
      model = R.model;
    }
    if (!result || !scanInvoices(result).length) throw new Error('Документот не е прочитан јасно. Пробајте појасна слика.');
    const opts = doc.options as { cash?: boolean; warehouseId?: string | null; costOnly?: boolean };
    const drafts = doc.kind === 'sale' ? await saleDrafts(db, f, result) : await purchaseDrafts(db, f, result, opts);
    await db.update(aiDocuments).set({ status: 'done', result, drafts, model }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
    log(`${docId}: ${drafts.length} draft(s) via ${model}`);
  } catch (e) {
    const p = e instanceof ReadFail ? { code: e.code, msg: e.message, detail: e.detail } : aiProviderError(e);
    const msg = p ? p.msg : e instanceof Error ? e.message : String(e);
    const options = p ? { ...doc.options, errCode: p.code, ...(p.detail ? { errDetail: p.detail.slice(0, 1000) } : {}) } : doc.options;
    await db.update(aiDocuments).set({ status: 'error', error: msg, options }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
    log(`${docId}: ${p ? p.code + ' ' + (p.detail || msg) : msg}`);
  }
}

export const aiReadDocument = defineJob<{ docId: string }>({
  name: AI_READ_DOCUMENT,
  async run(data, { db, log }) {
    if (data?.docId) await runReadDocument(db, data.docId, log);
  },
});
