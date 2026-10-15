/**
 * Hard AI cost control, applied to EVERY model call (`readContent`, `askText`):
 *
 *   1. guard   — the office / firm monthly limit (`app_settings.aiBudget`, `@wise/core/ai/cost`) reached → `AiBudgetError`
 *               (no call is made; the document jobs then use the free readers, see ai-read-document.ts);
 *   2. reserve — before the call an `ai_usage` row is written with the ESTIMATED cost (so parallel jobs and a crash
 *               mid-call still count against the limit);
 *   3. settle  — after the call the row gets the real tokens and USD (or 0 when the provider rejected the call);
 *   4. alert   — crossing 80 % / 100 % is remembered once per month for the owner (top-bar badge, „💲 AI трошок“).
 *
 * Plus the model tier policy (Opus only on an explicit detailed read) and the PDF page cap / blank-page removal.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { PDFArray, PDFDocument, PDFName, PDFStream, type PDFDict } from 'pdf-lib';
import { type AiBudgetCfg } from '@wise/core/ai/cost';
import { DEMO_AI_PURPOSE } from '@wise/core/demo';
import { aiBudgetStatus, aiUsage, isDemoFirmId, noteAiBudgetAlert, type Tx } from '@wise/db';
import { AI_PRICES, costUsd, type AiTier, type AiUsage } from './client';

export class AiBudgetError extends Error {
  readonly code = 'budget' as const;
  constructor(message: string) { super(message); this.name = 'AiBudgetError'; }
}

/** Message for a PDF over the page cap (thrown by `readContent` as `AiReadError`). */
export const pagesMsg = (pages: number, max: number) =>
  `Документот има ${pages} страници – над лимитот од ${max} страници за едно AI-читање (Систем › 💲 AI трошок). Поделете го на помали делови или побарајте од сопственикот да го зголеми лимитот.`;

/** Throws `AiBudgetError` when the office's or the firm's monthly AI limit is reached; returns the settings. */
export async function aiBudgetGuard(db: Tx, firmId: string | null): Promise<AiBudgetCfg> {
  const s = await aiBudgetStatus(db, firmId);
  if (s.paused) throw new AiBudgetError(s.msg);
  return s.cfg;
}

/** Is AI paused for this firm right now (for the document job: go straight to the free reader)? */
export async function aiBudgetPaused(db: Tx, firmId: string | null): Promise<string | null> {
  const s = await aiBudgetStatus(db, firmId);
  return s.paused ? s.msg : null;
}

/** Tier actually used: Opus (`complex`) only when the read was asked for in detail („🔍 Детално читање“). */
export const effectiveTier = (tier: AiTier, deep: boolean | undefined, cfg: Pick<AiBudgetCfg, 'opusOnlyDeep'>): AiTier =>
  tier === 'complex' && cfg.opusOnlyDeep && !deep ? 'default' : tier;

/* ---------------- estimate ---------------- */

/** Rough tokens of one PDF page sent as a document block (page image ≈ 1.5k + its text layer). */
export const TOKENS_PER_PDF_PAGE = 2300;
/** One image (the API scales it to ≤ 1568 px on the long side ≈ 1.6k tokens). */
export const TOKENS_PER_IMAGE = 1600;
/** Output tokens assumed for the estimate (JSON of a typical document). */
export const EST_OUTPUT_TOKENS = 2500;

const pdfPagesQuick = (b64: string): number => {
  // `/Type /Page` objects in the raw bytes (good enough for the estimate; exact count comes from pdf-lib when pruning)
  const s = Buffer.from(b64, 'base64').toString('latin1');
  return Math.max(1, (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length);
};

/** Estimated input tokens of a request (prompt + document / images / text). */
export function estimateInputTokens(blocks: readonly Anthropic.ContentBlockParam[], text: string): number {
  let t = Math.ceil(text.length / 3);
  for (const b of blocks) {
    if (b.type === 'document' && b.source.type === 'base64') t += pdfPagesQuick(b.source.data) * TOKENS_PER_PDF_PAGE;
    else if (b.type === 'image') t += TOKENS_PER_IMAGE;
    else if (b.type === 'text') t += Math.ceil(b.text.length / 3);
  }
  return t;
}

export function estimateCost(model: string, inputTokens: number, maxTokens: number): number {
  return costUsd(model, { inputTokens, outputTokens: Math.min(maxTokens, EST_OUTPUT_TOKENS), cacheReadTokens: 0, cacheWriteTokens: 0 });
}

/** Typical cost of one document of `pages` PDF pages for a model (docs / report: „колку чини еден документ“). */
export function typicalDocCost(model: string, pages: number, outTokens = EST_OUTPUT_TOKENS, promptTokens = 1500): number {
  return costUsd(model, { inputTokens: promptTokens + pages * TOKENS_PER_PDF_PAGE, outputTokens: outTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
}
export { AI_PRICES };

/* ---------------- reserve / settle ---------------- */

export interface CallRow { firmId: string | null; userId?: string | null; purpose: string; tier: AiTier; model: string; refId?: string | null }

/** Write the call's `ai_usage` row with the estimated cost BEFORE the call. */
export async function reserveAiCall(db: Tx, r: CallRow, estUsd: number): Promise<number> {
  // 🎭 calls for a demo firm are tagged `demo:<purpose>` (the demo cap and the report tell them apart)
  const purpose = r.firmId && !r.purpose.startsWith(DEMO_AI_PURPOSE + ':') && await isDemoFirmId(db, r.firmId) ? `${DEMO_AI_PURPOSE}:${r.purpose}` : r.purpose;
  const [x] = await db.insert(aiUsage).values({ firmId: r.firmId, userId: r.userId ?? null, purpose, tier: r.tier, model: r.model, costUsd: estUsd.toFixed(6), refId: r.refId ?? null }).returning({ id: aiUsage.id });
  return x!.id;
}

/** AFTER the call: the real tokens and cost (0 when the call failed before the provider charged it). */
export async function settleAiCall(db: Tx, id: number, firmId: string | null, usage: AiUsage | null, cost: number): Promise<void> {
  const u = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  await db.update(aiUsage).set({ ...u, costUsd: cost.toFixed(6) }).where(eq(aiUsage.id, id));
  if (cost > 0) await noteAiBudgetAlert(db, firmId).catch(() => null);
}

/* ---------------- PDF pages ---------------- */

const streamSize = (doc: PDFDocument, x: unknown): number => {
  const o = x instanceof PDFStream ? x : doc.context.lookup(x as never);
  return o instanceof PDFStream ? o.getContentsSize() : 0;
};

/** A page that draws nothing: (almost) empty content stream and no images / forms. */
function blankPage(doc: PDFDocument, i: number): boolean {
  const node = doc.getPage(i).node;
  const res = node.Resources() as PDFDict | undefined;
  const xo = res?.lookup(PDFName.of('XObject'));
  if (xo && (xo as PDFDict).keys?.().length) return false;
  const c = node.Contents();
  if (!c) return true;
  const size = c instanceof PDFArray ? c.asArray().reduce((s, r) => s + streamSize(doc, r), 0) : streamSize(doc, c);
  return size <= 16;
}

/**
 * Before a PDF goes to the model: flag one with more pages than the cap (`aiBudget.maxPages`, the owner sets it;
 * `readContent` refuses it) and drop blank pages (they are billed like any page). Returns the bytes to send (unchanged when nothing dropped).
 */
export async function preparePdf(bytes: Uint8Array, maxPages: number): Promise<{ bytes: Uint8Array; pages: number; dropped: number; over: boolean }> {
  try { return await preparePdf0(bytes, maxPages); } catch {
    // not parsable by pdf-lib: sent as it is (the model reads what it can)
    return { bytes, pages: 0, dropped: 0, over: false };
  }
}

async function preparePdf0(bytes: Uint8Array, maxPages: number): Promise<{ bytes: Uint8Array; pages: number; dropped: number; over: boolean }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const n = doc.getPageCount();
  const blank = Array.from({ length: n }, (_, i) => i).filter((i) => { try { return blankPage(doc, i); } catch { return false; } });
  const pages = n - (blank.length === n ? 0 : blank.length);
  if (pages > maxPages) return { bytes, pages, dropped: 0, over: true };
  if (!blank.length || blank.length === n) return { bytes, pages: n, dropped: 0, over: false };
  for (const i of [...blank].reverse()) doc.removePage(i);
  return { bytes: await doc.save(), pages, dropped: blank.length, over: false };
}

/** Apply `preparePdf` to the document blocks of a request. */
export async function prepareBlocks(blocks: readonly Anthropic.ContentBlockParam[], maxPages: number): Promise<{ blocks: Anthropic.ContentBlockParam[]; dropped: number; over: number }> {
  let dropped = 0, over = 0;
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type === 'document' && b.source.type === 'base64' && b.source.media_type === 'application/pdf') {
      const r = await preparePdf(new Uint8Array(Buffer.from(b.source.data, 'base64')), maxPages);
      dropped += r.dropped;
      if (r.over) over = Math.max(over, r.pages);
      out.push(r.dropped ? { ...b, source: { ...b.source, data: Buffer.from(r.bytes).toString('base64') } } : b);
    } else out.push(b);
  }
  return { blocks: out, dropped, over };
}
