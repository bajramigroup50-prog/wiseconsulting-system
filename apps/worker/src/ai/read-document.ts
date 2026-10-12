/**
 * Generic "read this uploaded document with a prompt and return JSON" (legacy `aiInput` + `sampleDoc`).
 *
 *   const { data } = await readDocument({ db, firmId, fileId, prompt: PUR_PROMPT, tier: 'quick', purpose: 'purchase' });
 *
 * PDFs go to the model as a document block and images as image blocks (no browser-side PDF rendering or Tesseract
 * OCR any more — the model reads scanned PDFs directly); XML / CSV / TXT are passed as text like legacy `aiInput0`.
 * Every call is logged in `ai_usage` with its cost for the firm: reserved with an estimate before the call, settled with
 * the real tokens after it, and refused when the monthly AI limit is reached (`./budget.ts`).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { files, type Tx } from '@wise/db';
import { AI_MODELS, aiMessages, costUsd, type AiTier, type AiUsage } from './client';
import { readObject } from './storage';
import { aiBudgetGuard, effectiveTier, estimateCost, estimateInputTokens, pagesMsg, prepareBlocks, reserveAiCall, settleAiCall } from './budget';

export class AiReadError extends Error {
  constructor(message: string) { super(message); this.name = 'AiReadError'; }
}

export type Validator<T> = { parse(x: unknown): T } | ((x: unknown) => T);

export interface ReadDocumentArgs<T> {
  db: Tx;
  /** Null for office-wide reads (e.g. the all-firms МПИН inbox, the law robot). */
  firmId: string | null;
  fileId: string;
  prompt: string;
  tier?: AiTier;
  /** Logged in `ai_usage.purpose` (`purchase`, `sale`, `blg`, `emp`, …). */
  purpose: string;
  /** Logged in `ai_usage.ref_id` (e.g. the `ai_documents` id). */
  refId?: string | null;
  userId?: string | null;
  /** Validates / narrows the parsed JSON (a zod schema or a function). */
  schema?: Validator<T>;
  maxTokens?: number;
  /** An explicit „🔍 Детално читање“: the only case where Opus (`complex`) is used (see ./budget.ts). */
  deep?: boolean;
  /** false: send the PDF as it is (no page cap / blank-page removal — the multi-invoice split needs the page numbers). */
  prune?: boolean;
}
export interface ReadDocumentResult<T> { data: T; model: string; usage: AiUsage; costUsd: number }

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** File → content blocks plus extra prompt text (legacy `aiInput0`). */
export function fileContent(f: { name: string; mime: string }, bytes: Uint8Array): { blocks: Anthropic.ContentBlockParam[]; extra: string } {
  const nm = f.name.toLowerCase();
  const b64 = () => Buffer.from(bytes).toString('base64');
  if (f.mime === 'application/pdf' || nm.endsWith('.pdf')) {
    return { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64() } }], extra: '' };
  }
  const img = (IMAGE_TYPES as readonly string[]).includes(f.mime) ? (f.mime as ImageType)
    : /\.jpe?g$/.test(nm) ? 'image/jpeg' : nm.endsWith('.png') ? 'image/png' : nm.endsWith('.webp') ? 'image/webp' : null;
  if (img) return { blocks: [{ type: 'image', source: { type: 'base64', media_type: img, data: b64() } }], extra: '' };
  if (/\.(xml|txt|csv)$/.test(nm) || /^text\/|xml/.test(f.mime)) {
    const t = new TextDecoder('utf-8').decode(bytes);
    return { blocks: [], extra: '\n\nStatement content (' + (nm.split('.').pop() || 'text') + '):\n' + t };
  }
  throw new AiReadError('Овој тип на датотека не може да се прочита автоматски (PDF, JPG, PNG, WEBP, XML, CSV, TXT).');
}

/** JSON object from a model reply (tolerates code fences / text around it). */
export function parseModelJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const a = t.search(/[[{]/);
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a < 0 || b < a) throw new AiReadError('Документот не е прочитан јасно. Пробајте појасна слика.');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new AiReadError('Документот не е прочитан јасно. Пробајте појасна слика.'); }
}

const EFFORT: Record<AiTier, 'low' | 'medium' | 'high'> = { quick: 'low', default: 'medium', complex: 'high' };

/** Load a firm's uploaded file (must be `ready` and belong to the firm). */
export async function loadFile(db: Tx, firmId: string, fileId: string) {
  const [f] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.firmId, firmId))).limit(1);
  if (!f || f.status !== 'ready') throw new AiReadError('Датотеката не е пронајдена.');
  return f;
}

/** Call the model with an already prepared content (used by `readDocument` and by jobs that re-read the same bytes). */
export async function readContent<T>(a: Omit<ReadDocumentArgs<T>, 'fileId'>, content: { blocks: Anthropic.ContentBlockParam[]; extra: string }): Promise<ReadDocumentResult<T>> {
  const api = aiMessages();
  // cost control (./budget.ts): monthly limit → AiBudgetError before any call; Opus only on a detailed read
  const cfg = await aiBudgetGuard(a.db, a.firmId);
  const tier = effectiveTier(a.tier ?? 'default', a.deep, cfg);
  const model = AI_MODELS[tier];
  let blocks = content.blocks;
  if (a.prune !== false) {
    const p = await prepareBlocks(blocks, cfg.maxPages);
    if (p.over) throw new AiReadError(pagesMsg(p.over, cfg.maxPages));
    blocks = p.blocks;
  }
  const text = a.prompt + content.extra;
  const maxTokens = a.maxTokens ?? 16000;
  const rid = await reserveAiCall(a.db, { firmId: a.firmId, userId: a.userId, purpose: a.purpose, tier, model, refId: a.refId }, estimateCost(model, estimateInputTokens(blocks, text), maxTokens));
  let msg: Anthropic.Message;
  try {
    msg = await api.create({
      model, max_tokens: maxTokens, output_config: { effort: EFFORT[tier] },
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
    });
  } catch (e) {
    await settleAiCall(a.db, rid, a.firmId, null, 0);
    throw e;
  }
  const usage: AiUsage = {
    inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
    cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
  };
  const cost = costUsd(model, usage);
  await settleAiCall(a.db, rid, a.firmId, usage, cost);
  if (msg.stop_reason === 'refusal') throw new AiReadError('Моделот одби да го прочита документот.');
  const out = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'max_tokens' && !out.trim().endsWith('}')) throw new AiReadError('Документот е преголем за едно читање – поделете го на помали делови.');
  const json = parseModelJson(out);
  const s = a.schema;
  const data = (s ? (typeof s === 'function' ? s(json) : s.parse(json)) : json) as T;
  return { data, model, usage, costUsd: cost };
}

/** Read an uploaded file of a firm with a prompt and return the parsed JSON. */
export async function readDocument<T = unknown>(a: ReadDocumentArgs<T> & { firmId: string }): Promise<ReadDocumentResult<T>> {
  const f = await loadFile(a.db, a.firmId, a.fileId);
  const bytes = await readObject(f.bucketKey);
  return readContent(a, fileContent(f, bytes));
}
