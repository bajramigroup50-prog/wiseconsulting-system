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
 * A read blocked by an earlier failure says so („AI е привремено паузирано поради претходна грешка … во HH:MM“, not
 * „the credit is exhausted“), and when that failure is older than 2 minutes the reader first runs a quick automatic
 * `ai.ping` (at most once per 2 minutes, `./ai-ping.ts`) — a topped-up credit is picked up without user action.
 *
 * Without AI (switched off in Систем, no key, credit / key failure in the last 15 minutes, or the AI call failed):
 * bank statements, trial balances and invoices with a text layer / XML / CSV are read by the free readers
 * (`../ai/free-read.ts`, model `noai`); other documents get the message with the free import paths. Inspection acts
 * (`kontrola`) as text PDF / Word / TXT are read the same way (Word / TXT always, the model does not take them); a scan
 * gets „Скенирана слика – потребно е AI или рачен внес“ with the reason AI was not used.
 *
 * Cost control: with AI available the free reader still runs FIRST for those kinds and its result is used when its own
 * checks pass; an earlier AI read of the same file (sha256) is reused; the monthly AI limit pauses AI (code `budget`)
 * while the free readers continue (../ai/free-first.ts, ../ai/budget.ts, docs/AI-TROSHOK.md).
 */
import { and, eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { boughtByOwnFirm, fixRates, isOwnParty, type SaleVatRule, issuedByOwnFirm, mergeAttachedInvoices, scanResultConsistent, scanInvoices, ublToScanAll, type ScanResult } from '@wise/core/sales';
import { aiDocuments, firms, type DB, type Tx } from '@wise/db';
import { s3Store, storeFile, type ObjectStore } from '../storage';
import { splitInvoicePdf } from '../ai/split';
import { defineJob } from '../job';
import { AI_ERR_BLOCKING, AI_ERR_MSG, aiBlockedMsg, aiProviderError, type AiErrCode } from '@wise/core/ai/errors';
import { runAiPing, shouldAutoPing } from './ai-ping';
import { clearAiFailure, getAiSettings, noteAiFailure } from '@wise/db';
import { aiConfigured, AiUnavailableError } from '../ai/client';
import { FREE_FIRST_KINDS, FREE_KINDS, freeAccepted, freeOnlyFile, freeRead, NOAI_MODEL } from '../ai/free-read';
import { KONTROLA_SCAN_MSG } from '@wise/core/noai/kontrola';
import { DOC_TYPE_ADD, INV_MULTI_ADD, INV_PAGES_NOTE, PUR_BANK_ADD, PUR_DEBT_ADD, PUR_PROMPT, SALE_PROMPT, VAT_NOTE_ADD } from '../ai/prompts';
import { AiReadError, fileContent, loadFile, readContent } from '../ai/read-document';
import { purchaseDrafts, saleDrafts, SCAN_RULES_V } from '../ai/drafts';
import { readObject } from '../ai/storage';
import { readResultKind, RESULT_KINDS } from '../ai/kinds';
import { AiBudgetError, aiBudgetPaused } from '../ai/budget';
import { preRead } from '../ai/free-first';

export const AI_READ_DOCUMENT = 'ai.read-document';

const fx = (r: ScanResult | null) => { if (r) for (const x of scanInvoices(r)) fixRates(x); return r; };
/** A failure with a user message and a code (stored on the row). */
class ReadFail extends Error { constructor(public code: AiErrCode, msg: string, public detail = '') { super(msg); } }
const BLOCK_MS = 15 * 60_000;

const hasRows = (r: unknown) => !!r && (((r as { rows?: unknown[] }).rows?.length ?? 0) > 0 || ((r as { items?: unknown[] }).items?.length ?? 0) > 0);

const own7 = (e: unknown) => String(e ?? '').replace(/\D/g, '').slice(-7);
/** Some invoice of the read names this firm (ЕДБ) as the buyer. */
const ownAsBuyer = (r: ScanResult | null, f: { edb: string | null; name: string }) => !!r && scanInvoices(r).some((x) => isOwnParty(x.buyerName, x.buyerEdb, f.edb, f.name));
const has = (r: ScanResult | null) => !!r && scanInvoices(r).some((x) => (x.lines ?? []).length || (x.groups ?? []).length);

/** The work of the job, separated for tests. */
export async function runReadDocument(db: Tx, docId: string, log: (m: string) => void = () => {}, store: ObjectStore = s3Store): Promise<void> {
  const [doc] = await db.select().from(aiDocuments).where(eq(aiDocuments.id, docId)).limit(1);
  if (!doc || !['queued', 'error', 'reading'].includes(doc.status)) return;
  // legacy „Откажи читање“ (`outCancel`): a cancelled read is not started, and a running one does not overwrite it
  if ((doc.options as { cancelled?: boolean }).cancelled) return;
  // the same file sent to reading twice (a double click, the same upload again): only the first read runs – no second
  // AI cost, no duplicate drafts
  if (doc.fileId && !(doc.options as { retry?: boolean }).retry) {
    const [first] = await db.select({ id: aiDocuments.id }).from(aiDocuments)
      .where(and(eq(aiDocuments.firmId, doc.firmId), eq(aiDocuments.fileId, doc.fileId), eq(aiDocuments.kind, doc.kind), sql`${aiDocuments.status} <> 'error'`, sql`coalesce((${aiDocuments.options}->>'cancelled')::boolean, false) = false`))
      .orderBy(aiDocuments.createdAt, aiDocuments.id).limit(1);
    if (first && first.id !== doc.id) {
      await db.update(aiDocuments).set({ status: 'error', error: 'Истиот документ веќе се чита – двојното праќање е прескокнато.', options: sql`${aiDocuments.options} || '{"cancelled":true}'::jsonb` }).where(eq(aiDocuments.id, docId));
      log(`${docId}: the same file is already read (${first.id}) – skipped`);
      return;
    }
  }
  const [f] = await db.select().from(firms).where(eq(firms.id, doc.firmId)).limit(1);
  if (!f) return;
  await db.update(aiDocuments).set({ status: 'reading', error: null, options: sql`${aiDocuments.options} - 'progress'` }).where(eq(aiDocuments.id, docId));
  doc.options = Object.fromEntries(Object.entries(doc.options ?? {}).filter(([k]) => k !== 'progress'));
  /** „дел 2/5…“ of a read in parts (shown by the screen while it polls); merged in SQL, a concurrent cancel stays. */
  const progress = (p: string) => db.update(aiDocuments).set({ options: sql`${aiDocuments.options} || jsonb_build_object('progress', ${p}::text)` }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
  let S = await getAiSettings(db);
  const retry = !!(doc.options as { retry?: boolean }).retry;
  let blocked = !!S.lastFail && !retry && Date.now() - Date.parse(S.lastFail.at) < BLOCK_MS;
  // blocked by an older credit / key failure: a quick automatic check (at most once per 2 minutes) picks up a top-up
  if (blocked && aiConfigured() && shouldAutoPing(S)) {
    const p = await runAiPing(db, { auto: true });
    log(`auto ai.ping: ${p.ok ? 'ok' : p.code}`);
    if (p.ok) { S = await getAiSettings(db); blocked = false; }
  }
  /** Why AI is not used for this read (null = use AI). */
  const noAi: AiErrCode | null = !S.enabled ? 'off' : !aiConfigured() ? 'nokey' : blocked ? S.lastFail!.code
    // monthly AI limit reached (office or firm, ../ai/budget.ts): AI paused, the free readers continue
    : (await aiBudgetPaused(db, f.id)) ? 'budget' : null;
  /** Free read of the document's file; null when not possible. */
  const free = async (): Promise<unknown | null> => {
    if (!FREE_KINDS.has(doc.kind) || !doc.fileId) return null;
    try {
      const file = await loadFile(db, f.id, doc.fileId);
      return await freeRead(doc.kind, file, await readObject(file.bucketKey), { ownEdb: f.edb });
    } catch (e) {
      // ambiguous amounts („10.000“) that the totals do not decide: flagged, never guessed
      if (e instanceof Error && e.name === 'AmbiguousAmountsError') throw new ReadFail('noai', e.message);
      // a statement table found but not readable: the reason (row / column) instead of the generic message
      if (e instanceof Error && e.name === 'BankPdfError') throw new ReadFail('noai', e.message);
      return null;
    }
  };
  /** AI not usable / failed: try the free reader, otherwise fail with the code's message. */
  const fallback = async (code: AiErrCode, detail = ''): Promise<{ result: unknown; model: string }> => {
    const r = await free();
    if (r) return { result: r, model: NOAI_MODEL };
    // not a fresh provider error: AI was skipped because of an earlier credit / key failure — say so (with its time)
    const why = code === 'nokey' ? new AiUnavailableError().message
      : blocked && !detail && S.lastFail && code === S.lastFail.code ? aiBlockedMsg(code, S.lastFail.at) : AI_ERR_MSG[code];
    // inspection act without a text layer: say it is a scan and what to do next (AI or manual entry), then why AI failed
    if (doc.kind === 'kontrola') throw new ReadFail(code, `${KONTROLA_SCAN_MSG} (${/^.*?[.!](?=\s|$)/.exec(why)?.[0] ?? why})`, detail);
    throw new ReadFail(code, why, detail);
  };
  /** Files only the free reader takes (an inspection act as .docx / .txt): read without AI even when AI works. */
  const freeOnly = async (): Promise<{ result: unknown; model: string } | null> => {
    if (!doc.fileId || !FREE_KINDS.has(doc.kind)) return null;
    const file = await loadFile(db, f.id, doc.fileId);
    if (!freeOnlyFile(doc.kind, file)) return null;
    const r = await free();
    if (r) return { result: r, model: NOAI_MODEL };
    throw new ReadFail('noai', 'Документот нема текст што може да се прочита – внесете ги наодите рачно.');
  };
  /** Run an AI read; provider errors are classified, blocking ones remembered, then the free reader is tried. */
  const viaAi = async <T>(f0: () => Promise<T>): Promise<T | { result: unknown; model: string; free: true }> => {
    try {
      const r = await f0();
      if (S.lastFail) await clearAiFailure(db);
      return r;
    } catch (e) {
      if (e instanceof AiUnavailableError) return { ...(await fallback('nokey')), free: true };
      if (e instanceof AiBudgetError) return { ...(await fallback('budget')), free: true };
      const p = aiProviderError(e);
      if (!p) throw e;
      if (AI_ERR_BLOCKING.has(p.code)) await noteAiFailure(db, p.code, p.detail);
      return { ...(await fallback(p.code, p.detail)), free: true };
    }
  };
  /**
   * Cost control (../ai/free-first.ts): before AI, the free reader (accepted when its own checks pass: the statement
   * reconciles, debit = credit, base × rate = VAT, header + findings) and then an earlier AI read of the same file
   * (sha256). The reason AI is still needed is kept in `options.aiWhy` („скенирано“, „не се совпаѓаат збировите“).
   */
  const pre = async (): Promise<{ result: unknown; model: string } | null> => {
    if (noAi) return null;
    // an explicit „↻ Прочитај повторно“ (`reread`): a NEW AI read — never the free reader or an earlier read of the file
    if ((doc.options as { reread?: boolean }).reread) return null;
    const p = await preRead(db, doc, f).catch(() => ({ hit: false as const, why: '' }));
    if (p.hit) {
      if (p.cachedFrom) {
        doc.options = { ...doc.options, cachedFrom: p.cachedFrom };
        await db.update(aiDocuments).set({ options: doc.options }).where(eq(aiDocuments.id, docId));
      }
      log(`${docId}: ${doc.kind} ${p.model === NOAI_MODEL ? 'read without AI (checks pass)' : 'reused from an earlier read of the same file'}`);
      return { result: p.result, model: p.model };
    }
    if (p.why) {
      doc.options = { ...doc.options, aiWhy: p.why };
      await db.update(aiDocuments).set({ options: doc.options }).where(eq(aiDocuments.id, docId));
    }
    return null;
  };
  try {
    if (RESULT_KINDS.has(doc.kind)) {
      const hit = await pre();
      if (hit) {
        await db.update(aiDocuments).set({ status: 'done', result: hit.result, drafts: [], model: hit.model }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
        return;
      }
      // a bank statement PDF with a text layer whose balances reconcile (opening + movements = closing) is read
      // exactly without AI — no tokens, no misread digits; otherwise (scan, no balances, not reconciling) AI reads it.
      // The same for a trial balance whose every printed total matches (`freeAccepted`)
      let freeR: unknown = null;
      if (!noAi && FREE_FIRST_KINDS.has(doc.kind) && !(doc.options as { reread?: boolean }).reread) {
        try { freeR = await free(); } catch { freeR = null; }
        if (freeAccepted(doc.kind, freeR)) {
          await db.update(aiDocuments).set({ status: 'done', result: freeR, drafts: [], model: NOAI_MODEL }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
          log(`${docId}: ${doc.kind} read from the PDF text (reconciled), no AI`);
          return;
        }
      }
      const { result, model } = noAi ? await fallback(noAi) : (await freeOnly()) ?? await viaAi(async () => {
        try { return await readResultKind(db, doc, f, undefined, progress); } catch (e) {
          // the AI read failed for good (too large, unreadable): a free read of the text layer, even unbalanced, is
          // better than nothing — its warnings say what to check
          if (e instanceof AiReadError) {
            const fr = freeR ?? await free().catch(() => null);
            if (hasRows(fr)) { log(`${docId}: AI read failed (${e.message}), the free read is used`); return { result: fr, model: NOAI_MODEL }; }
          }
          throw e;
        }
      });
      await db.update(aiDocuments).set({ status: 'done', result, drafts: [], model }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
      log(`${docId}: ${doc.kind} read via ${model}`);
      return;
    }
    if (!doc.fileId) throw new Error('Датотеката не е пронајдена.');
    const file = await loadFile(db, f.id, doc.fileId);
    const bytes = await readObject(file.bucketKey);
    // free reader / earlier read of the same file first (an invoice whose sums agree costs no AI and is not split)
    const hit = /\.xml$/i.test(file.name) || /xml/.test(file.mime) ? null : await pre();
    // legacy `invSplit` (13685): a PDF with several invoices is cut into one PDF per invoice, each read on its own
    const opts0 = doc.options as { split?: boolean; noSplit?: boolean };
    if (!hit && !opts0.split && !opts0.noSplit && !noAi && (file.mime === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      const parts = await splitInvoicePdf({ db, firmId: f.id, refId: doc.id, userId: doc.createdBy, name: file.name, bytes, purpose: doc.kind });
      if (parts) {
        const ids: string[] = [];
        for (const pt of parts) {
          const fileId = await storeFile(db as unknown as DB, store, { firmId: f.id, name: pt.name, mime: 'application/pdf', ext: 'pdf', body: pt.bytes, userId: doc.createdBy });
          const [c] = await db.insert(aiDocuments).values({ firmId: f.id, fileId, kind: doc.kind, batchId: doc.batchId, createdBy: doc.createdBy, options: { ...doc.options, split: true, parentId: doc.id, pages: pt.pages } }).returning({ id: aiDocuments.id });
          ids.push(c!.id);
        }
        await db.update(aiDocuments).set({ status: 'done', drafts: [], result: { split: ids }, batchId: null, options: { ...doc.options, inline: true } }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading')));
        log(`${docId}: split into ${ids.length} invoices`);
        for (const id of ids) await runReadDocument(db, id, log, store);
        return;
      }
    }
    let result: ScanResult | null = hit ? fx(hit.result as ScanResult) : null;
    let model: string | null = hit ? hit.model : null;
    if (!result && /\.xml$/i.test(file.name) || /xml/.test(file.mime)) {
      result = ublToScanAll(new TextDecoder('utf-8').decode(bytes));
      if (result) model = 'ubl';
    }
    if (!result && noAi) {
      const r = await fallback(noAi);
      result = r.result as ScanResult; model = r.model;
    }
    // the kind the document turned out to be when read again (a supplier's invoice uploaded in „Излезни“)
    let readAs: 'sale' | 'purchase' | null = null;
    if (!result) {
      const content = fileContent(file, bytes);
      // several photos / scans uploaded together (`extraFileIds`): the pages of one or several invoices, read in one
      // call and grouped by invoice header (each invoice its own draft, `pages` = the photos it is on)
      const extra = ((doc.options ?? {}) as { extraFileIds?: string[] }).extraFileIds ?? [];
      if (extra.length) {
        for (const id of extra) {
          const ef = await loadFile(db, f.id, id);
          content.blocks.push(...fileContent(ef, await readObject(ef.bucketKey)).blocks);
        }
        content.extra += INV_PAGES_NOTE(extra.length + 1);
      }
      // the rule of the bank import: several invoices in the file → `invoices[]`, one object (one draft) per invoice
      const prompt = (doc.kind === 'sale' ? SALE_PROMPT(f) : PUR_PROMPT + PUR_BANK_ADD + PUR_DEBT_ADD) + VAT_NOTE_ADD + DOC_TYPE_ADD + INV_MULTI_ADD;
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
      // a sales invoice read with OUR firm as the buyer (the issuer at the bottom / right was taken for the customer):
      // read once more, deeper, saying so – the customer is the other party
      if (doc.kind === 'sale' && ownAsBuyer(result, f)) {
        log(`${docId}: the buyer read is this firm – read again`);
        const again = await viaAi(async () => {
          const r = await readContent<ScanResult>({ ...base, tier: 'default', prompt: prompt + `
WARNING: a first read returned the issuer "${f.name}" (ЕДБ ${f.edb}) as the buyer – that is wrong. Find the OTHER party (the customer) and return it as buyer.` }, content);
          return { result: fx(r.data), model: r.model };
        }).catch(() => null);
        if (again?.result && scanInvoices(again.result as ScanResult).length && !ownAsBuyer(again.result as ScanResult, f)) { result = again.result as ScanResult; model = again.model; }
        // still our firm as the buyer: it IS a supplier's invoice to us – read it as a purchase (supplier = the issuer)
        else {
          const pur = await viaAi(async () => {
            const r = await readContent<ScanResult>({ ...base, tier: 'default', purpose: 'purchase', prompt: PUR_PROMPT + PUR_BANK_ADD + PUR_DEBT_ADD + VAT_NOTE_ADD + DOC_TYPE_ADD + INV_MULTI_ADD }, content);
            return { result: fx(r.data), model: r.model };
          }).catch(() => null);
          if (pur?.result && scanInvoices(pur.result as ScanResult).length) { result = pur.result as ScanResult; model = pur.model; readAs = 'purchase'; log(`${docId}: a supplier's invoice to this firm – read as a purchase`); }
        }
      }
    }
    if (!result || !scanInvoices(result).length) throw new Error('Документот не е прочитан јасно. Пробајте појасна слика.');
    // attached pages (an EVN bill's „спецификација на потрошувачка“, a „прилог“, the same number on the next page) are
    // part of the invoice before them, never a draft of their own
    result = mergeAttachedInvoices(result);
    // a part cut from a multi-invoice PDF (`split`): its invoice is on these pages of the original file
    const srcPages = (doc.options as { pages?: string }).pages;
    if (srcPages && scanInvoices(result).length === 1) scanInvoices(result)[0]!.pages ??= srcPages;
    const opts = doc.options as { cash?: boolean; warehouseId?: string | null; costOnly?: boolean };
    // this firm's own sales invoices uploaded in „Влезни“: they become sales drafts (izlez), not a purchase from itself
    // and a supplier's invoice to this firm uploaded in „Излезни“ becomes a purchase draft
    const kind = readAs ?? (doc.kind === 'purchase' && issuedByOwnFirm(result, f.edb, f.name) ? 'sale' : doc.kind === 'sale' && boughtByOwnFirm(result, f.edb, f.name) ? 'purchase' : doc.kind);
    if (kind !== doc.kind) log(`${docId}: read as a ${kind} (the firm's own ЕДБ on the other side)`);
    // drafts (with the partners created from the document) and the result in one transaction: a read cancelled
    // meanwhile leaves no new partners behind
    const res = result;
    const n = await db.transaction(async (tx) => {
      const drafts = kind === 'sale' ? await saleDrafts(tx, f, res, { userId: doc.createdBy, vatRule: (doc.options as { vatRule?: SaleVatRule }).vatRule ?? null }) : await purchaseDrafts(tx, f, res, { ...opts, docId }, { userId: doc.createdBy });
      const up = await tx.update(aiDocuments).set({ status: 'done', kind, result: res, drafts, model, options: sql`${aiDocuments.options} || ${JSON.stringify({ rulesV: SCAN_RULES_V })}::jsonb` }).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.status, 'reading'))).returning({ id: aiDocuments.id });
      if (!up.length) tx.rollback();
      return drafts.length;
    }).catch((e: unknown) => { if (e instanceof TransactionRollbackError) return -1; throw e; });
    log(n < 0 ? `${docId}: cancelled meanwhile` : `${docId}: ${n} draft(s) via ${model}`);
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
  // failures are stored on the row and never thrown; a job that still fails (DB down) or expires is not repeated by
  // pg-boss — a repeated read pays for the same tokens again. Reads lost in a restart are queued again by
  // `requeueStaleReads` on worker startup.
  queue: { retryLimit: 0, expireInSeconds: 30 * 60 },
  // a pile of receipts / invoices is read 4 at a time (one by one took ~20 s each)
  concurrency: 4,
  async run(data, { db, log }) {
    if (data?.docId) await runReadDocument(db, data.docId, log);
  },
});
