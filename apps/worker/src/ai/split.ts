/**
 * Multi-invoice PDF split (legacy `invSplit` 13685 / `invSplitAll` 13698, used by `scanFile`, `batchRun` and `outRun`):
 * a PDF of 2–60 pages may hold several invoices scanned one after another. The model groups the pages (prompt
 * verbatim from legacy), pdf-lib cuts one PDF per invoice, and every part is stored as its own file so each saved
 * invoice keeps only its own pages. Anything unexpected → the file is read as one document (legacy `return [file]`).
 */
import { PDFDocument } from 'pdf-lib';
import type Anthropic from '@anthropic-ai/sdk';
import { readContent } from './read-document';
import type { Tx } from '@wise/db';

/** Legacy inline prompt of `invSplit` (13689). */
export const SPLIT_PROMPT = (n: number) => 'This PDF has ' + n + ' pages and may contain SEVERAL separate invoices (фактури / сметки) one after another, possibly from different suppliers or with different numbers. Group the pages: consecutive pages that belong to the same invoice go together (continuation pages, totals page, attachments of that invoice). A new invoice starts when a new invoice number / new header appears. Reply with ONLY JSON: {"groups":[{"from":1,"to":1,"number":"invoice number or empty"}]} covering every page 1..' + n + ' in order without gaps.';

export interface SplitGroup { from: number; to: number; number: string }

/** Validate the model's page groups (legacy 13693–13694): ≥2 groups, contiguous, covering 1..n. */
export function splitGroups(raw: unknown, n: number): SplitGroup[] | null {
  const G = (((raw as { groups?: unknown[] } | null)?.groups ?? []) as { from?: unknown; to?: unknown; number?: unknown }[])
    .map((g) => ({ from: Number(g.from), to: Number(g.to), number: String(g.number ?? '') }))
    .filter((g) => g.from >= 1 && g.to >= g.from && g.to <= n).sort((a, b) => a.from - b.from);
  if (G.length < 2) return null;
  if (G[0]!.from !== 1 || G[G.length - 1]!.to !== n) return null;
  for (let i = 1; i < G.length; i++) if (G[i]!.from !== G[i - 1]!.to + 1) return null;
  return G;
}

/** Legacy `fn` (3258). */
const fn = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_');

/**
 * Split a PDF when it holds several invoices. Returns the parts (name + bytes) or null (read the file as it is).
 */
export async function splitInvoicePdf(a: { db: Tx; firmId: string; refId: string; userId: string | null; name: string; bytes: Uint8Array; purpose: string }): Promise<{ name: string; bytes: Uint8Array }[] | null> {
  let src: PDFDocument, n: number;
  try { src = await PDFDocument.load(a.bytes, { ignoreEncryption: true }); n = src.getPageCount(); } catch { return null; }
  if (n < 2 || n > 60) return null;
  const blocks: Anthropic.ContentBlockParam[] = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(a.bytes).toString('base64') } }];
  let G: SplitGroup[] | null = null;
  try {
    const r = await readContent<unknown>({ db: a.db, firmId: a.firmId, prompt: SPLIT_PROMPT(n), tier: 'quick', purpose: a.purpose + ':split', refId: a.refId, userId: a.userId, maxTokens: 2000 }, { blocks, extra: '' });
    G = splitGroups(r.data, n);
  } catch { return null; }
  if (!G) return null;
  const base = a.name.replace(/\.pdf$/i, '');
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const [k, g] of G.entries()) {
    const d = await PDFDocument.create();
    const pages = await d.copyPages(src, Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from - 1 + i));
    pages.forEach((p) => d.addPage(p));
    out.push({ name: base + '_' + (k + 1) + (g.number ? '_' + fn(g.number).slice(0, 30) : '') + '.pdf', bytes: await d.save() });
  }
  return out;
}
