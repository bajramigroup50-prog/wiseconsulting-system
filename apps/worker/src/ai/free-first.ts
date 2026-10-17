/**
 * Free first, AI only when needed (cost control). For every kind with a free reader (`FREE_KINDS`: bank, ob, purchase,
 * sale, kontrola) the free reader runs FIRST on text PDFs / Excel / CSV / XML / Word, and its result is accepted when
 * its own checks pass:
 *
 *   bank      the statement reconciles (opening + movements = closing) and nothing was flagged
 *   ob        debit = credit and the printed account totals match the lines
 *   purchase  every invoice: base × rate = VAT, groups (+ VAT) = total, lines = groups
 *   sale      (same)
 *   kontrola  a header (authority / document / number / date) and at least one finding
 *
 * Purchase / sale also: no invoice with two VAT groups of the SAME rate (the sign of several invoices read as one —
 * the reader keeps one group per rate unless it says which is goods and which services, `kind`), and on a PDF the page
 * count must be plausible for the invoices found ({@link plausiblePages}): a 46-page scan whose text layer gave ONE
 * invoice is many invoices, read by AI (split per invoice), never one bogus purchase.
 *
 * Otherwise AI reads it, and the reason is kept on the read (`options.aiWhy`): „скенирано – PDF без текст“,
 * „не се совпаѓаат збировите“, … Also: an earlier read of the SAME file (sha256) of the same kind is reused instead of a
 * second AI read (`findCachedRead`).
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { buildOpening, type ParsedSheet } from '@wise/core';
import { scanConsistent, scanInvoices, type ScanResult } from '@wise/core/sales';
import { aiDocuments, files, type AiDocument, type Tx } from '@wise/db';
import { FREE_KINDS, freeRead, NOAI_MODEL } from './free-read';
import { pdfPageCount } from './chunked';
import { loadFile } from './read-document';
import { readObject } from './storage';

export interface FreeVerdict { ok: boolean; why: string }

const n = (v: unknown) => { const x = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(x) ? x : 0; };

export const WHY = {
  scan: 'скенирано – PDF без текст / слика',
  sums: 'не се совпаѓаат збировите',
  format: 'форматот не се чита без AI',
  empty: 'не е пронајдена табела / податоци',
  ambiguous: 'нејасни износи (формат на броеви)',
  header: 'нема заглавие или наоди',
  pages: 'повеќе страници / фактури – чита AI',
} as const;

/**
 * Pages one invoice may plausibly take in a PDF read without AI: a VAT recapitulation only (no lines) is 1 page, at
 * most 3 with an attached specification / delivery note; an invoice with item lines may run over several pages (a long
 * item list), at most 6. More pages than that per invoice found → the text layer did not show every invoice.
 */
export const PAGES_PER_INVOICE = { noLines: 3, lines: 6 } as const;

/** Is `pages` (the PDF's page count) plausible for the invoices of a free read? */
export function plausiblePages(r: unknown, pages: number | null): boolean {
  if (!pages || pages <= 1) return true;
  const I = scanInvoices(r as ScanResult);
  if (!I.length) return false;
  const per = I.every((x) => (x.lines ?? []).length) ? PAGES_PER_INVOICE.lines : PAGES_PER_INVOICE.noLines;
  return pages <= per * I.length;
}

/** Two VAT groups of the same rate in one invoice, not told apart by their `kind` (goods / services / …). */
export function sameRateGroups(x: { groups?: { rate?: unknown; base?: unknown; kind?: string }[] }): boolean {
  const G = (x.groups ?? []).filter((g) => n(g.base));
  for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) {
    if (n(G[i]!.rate) !== n(G[j]!.rate)) continue;
    const a = G[i]!.kind ?? '', b = G[j]!.kind ?? '';
    // the reader distinguishes them only with two different, meaningful kinds („other“ is the reader's default)
    if (!(a && b && a !== b && a !== 'other' && b !== 'other')) return true;
  }
  return false;
}

/** Does the free reader's result pass its own checks? */
export function acceptFree(kind: string, r: unknown): FreeVerdict {
  if (!r || typeof r !== 'object') return { ok: false, why: WHY.empty };
  // fiscal reports / receipts: the free reader returns only results whose own checks passed (./free-docs.ts)
  if (kind === 'fisk' || kind === 'blg') return { ok: true, why: '' };
  if (kind === 'bank') {
    const b = r as { balanced?: boolean | null; warnings?: unknown[]; blocking?: unknown[]; items?: { amount?: unknown }[]; openingBalance?: unknown; closingBalance?: unknown };
    if (!b.items?.length) return { ok: false, why: WHY.empty };
    if (b.warnings?.length || b.blocking?.length) return { ok: false, why: WHY.sums };
    if (b.balanced === true) return { ok: true, why: '' };
    // PDF text: no balances to check (null) or not reconciling (false) → AI
    if (b.balanced === false || b.balanced === null) return { ok: false, why: WHY.sums };
    // structured files (XML / CSV / MT940): exact data; when both balances are given they must reconcile
    const o = n(b.openingBalance), c = n(b.closingBalance);
    if (!o && !c) return { ok: true, why: '' };
    const sum = b.items.reduce((s, x) => s + n(x.amount), 0);
    return Math.abs(o + sum - c) < 0.01 ? { ok: true, why: '' } : { ok: false, why: WHY.sums };
  }
  if (kind === 'ob') {
    const o = r as { rows?: ParsedSheet['rows']; totals?: ParsedSheet['totals'] };
    if (!o.rows?.length) return { ok: false, why: WHY.empty };
    const { control } = buildOpening({ rows: o.rows, totals: o.totals ?? [], src: 'excel' }, { full: true });
    if (!control.n) return { ok: false, why: WHY.empty };
    const ok = Math.abs(control.D - control.P) < 1 && !control.bad.length;
    return ok ? { ok: true, why: '' } : { ok: false, why: WHY.sums };
  }
  if (kind === 'purchase' || kind === 'sale') {
    const I = scanInvoices(r as ScanResult);
    if (!I.length) return { ok: false, why: WHY.empty };
    const ok = I.every((x) => n(x.total) > 0 && (x.groups ?? []).some((g) => n(g.base)) && scanConsistent(x));
    if (!ok) return { ok: false, why: WHY.sums };
    // the same VAT rate twice in one invoice: several invoices merged by the reader (each group may check on its own)
    if (I.some(sameRateGroups)) return { ok: false, why: WHY.pages };
    return { ok: true, why: '' };
  }
  if (kind === 'kontrola') {
    const k = r as { auth?: string; doc?: string; docNo?: string; docDate?: string; findings?: unknown[] };
    const head = !!(k.auth || k.docNo || (k.doc && k.docDate));
    return head && (k.findings?.length ?? 0) >= 1 ? { ok: true, why: '' } : { ok: false, why: WHY.header };
  }
  if (kind === 'classify') {
    // the free classifier answers only when the title words / UBL seller say it clearly
    return (r as { kind?: string }).kind ? { ok: true, why: '' } : { ok: false, why: WHY.header };
  }
  return { ok: false, why: WHY.format };
}

const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f: { name: string; mime: string }) => /^image\//.test(f.mime) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name);

/**
 * Run the free reader first. `result` is set only when its checks pass; otherwise `why` says why AI is needed.
 * Never throws (an ambiguous / unreadable table is a reason for AI here, not an error).
 */
export async function freeFirst(kind: string, file: { name: string; mime: string }, bytes: Uint8Array, o: { ownEdb?: string | null } = {}): Promise<{ result: unknown | null; why: string }> {
  if (!FREE_KINDS.has(kind)) return { result: null, why: WHY.format };
  if (isImage(file)) return { result: null, why: WHY.scan };
  let r: unknown = null;
  try { r = await freeRead(kind, file, bytes, o); } catch (e) {
    return { result: null, why: e instanceof Error && e.name === 'AmbiguousAmountsError' ? WHY.ambiguous : WHY.sums };
  }
  if (!r) return { result: null, why: isPdf(file) ? WHY.scan : WHY.format };
  const v = acceptFree(kind, r);
  if (!v.ok) return { result: null, why: v.why };
  // a multi-page PDF whose text layer (often a scanner's OCR) gave too few invoices: AI reads it (split per invoice)
  if ((kind === 'purchase' || kind === 'sale') && isPdf(file) && !plausiblePages(r, await pdfPageCount(bytes))) return { result: null, why: WHY.pages };
  return { result: r, why: '' };
}

/** Only real sha256 values identify a file's content. */
const SHA = /^[0-9a-f]{64}$/;

/**
 * An earlier successful AI read of a file with the same content (sha256) and kind in the same firm — reused instead
 * of reading it again with AI. Free reads are not reused (they cost nothing and the reader may have improved);
 * a detailed read („🔍“) only reuses another detailed read.
 */
export async function findCachedRead(db: Tx, doc: Pick<AiDocument, 'id' | 'firmId' | 'kind' | 'fileId' | 'options'>): Promise<{ id: string; result: unknown; model: string } | null> {
  if (!doc.fileId) return null;
  const opts = (doc.options ?? {}) as { deep?: boolean; extraFileIds?: string[]; retry?: boolean };
  if (opts.extraFileIds?.length) return null;
  const [f] = await db.select({ sha: files.sha256 }).from(files).where(eq(files.id, doc.fileId)).limit(1);
  if (!f || !SHA.test(f.sha)) return null;
  const same = db.select({ id: files.id }).from(files).where(and(eq(files.firmId, doc.firmId), eq(files.sha256, f.sha)));
  const R = await db.select({ id: aiDocuments.id, result: aiDocuments.result, model: aiDocuments.model, options: aiDocuments.options }).from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, doc.firmId), eq(aiDocuments.kind, doc.kind), ne(aiDocuments.id, doc.id), inArray(aiDocuments.status, ['done', 'saved']),
      inArray(aiDocuments.fileId, same), sql`${aiDocuments.model} is not null and ${aiDocuments.model} not in (${NOAI_MODEL}, 'ubl')`, sql`${aiDocuments.result} is not null`))
    .orderBy(desc(aiDocuments.updatedAt)).limit(10);
  for (const x of R) {
    const o = (x.options ?? {}) as { deep?: boolean; extraFileIds?: string[]; inline?: boolean };
    if (o.extraFileIds?.length) continue;
    if (opts.deep && !o.deep) continue;
    // a split parent (`{split: [...]}`) is not a read of its own
    if (x.result && typeof x.result === 'object' && 'split' in (x.result as object)) continue;
    return { id: x.id, result: x.result, model: x.model! };
  }
  return null;
}

/**
 * Before any AI read of a document job: (1) the free reader, accepted when its checks pass; (2) an earlier AI read of
 * the same file. `why` is the reason AI is still needed (stored as `options.aiWhy`). A detailed read („🔍“) skips (1).
 */
export async function preRead(db: Tx, doc: AiDocument, firm: { id: string; edb?: string | null }): Promise<{ hit: true; result: unknown; model: string; cachedFrom?: string } | { hit: false; why: string }> {
  if (!doc.fileId || doc.kind === 'cmp' || doc.kind === 'bom' || doc.kind === 'bankcls') return { hit: false, why: '' };
  const deep = !!(doc.options as { deep?: boolean } | null)?.deep;
  let why = '';
  if (FREE_KINDS.has(doc.kind) && !deep) {
    const file = await loadFile(db, firm.id, doc.fileId);
    const r = await freeFirst(doc.kind, file, await readObject(file.bucketKey), { ownEdb: firm.edb });
    if (r.result) return { hit: true, result: r.result, model: NOAI_MODEL };
    why = r.why;
  }
  const c = await findCachedRead(db, doc);
  if (c) return { hit: true, result: c.result, model: c.model, cachedFrom: c.id };
  return { hit: false, why };
}
