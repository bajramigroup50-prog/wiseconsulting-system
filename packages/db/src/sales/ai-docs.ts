/** Review-side helpers for `ai_documents` (the worker writes them, the review UI consumes the drafts). */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { ScanPurchaseDraft } from '@wise/core/sales';
import type { Tx } from '../audit';
import { aiDocuments, invoices, purchases, type AiDocument } from '../schema/index';
import { DocumentError } from './context';
import type { PurchaseInput } from './purchases';

export async function loadAiDocument(tx: Tx, firmId: string, id: string): Promise<AiDocument> {
  const [d] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firmId))).limit(1);
  if (!d) throw new DocumentError('Скенираниот документ не постои.');
  return d;
}

/** Every draft is done: saved or left out („Прескокни“). */
const allDone = (D: AiDocument['drafts']) => D.every((x) => x.savedId || x.skipped);

/** Record that draft `index` of a read document was saved as `savedId`; the document is `saved` when all are. */
export async function markDraftSaved(tx: Tx, firmId: string, docId: string, index: number, savedId: string): Promise<void> {
  const d = await loadAiDocument(tx, firmId, docId);
  const drafts = d.drafts.map((x, i) => (i === index ? { ...x, savedId, skipped: undefined, deleted: undefined } : x));
  await tx.update(aiDocuments).set({ drafts, status: allDone(drafts) ? 'saved' : d.status }).where(eq(aiDocuments.id, docId));
}

/** Shown on a draft whose saved document was deleted ({@link AiDraft.deleted}). */
export const DELETED_DOC_NOTE = 'документот е избришан – може повторно да се зачува';

const UUID = /^[0-9a-f-]{36}$/i;

/** The kind of read whose drafts are saved as `invoices` (sale) / `purchases` (purchase). */
export type SavedDocKind = 'purchase' | 'sale';

/** New status of a document after its drafts changed: `saved` when every draft is done and one is saved. */
const docStatus = (d: Pick<AiDocument, 'status'>, drafts: AiDocument['drafts']): AiDocument['status'] =>
  allDone(drafts) && drafts.some((y) => y.savedId) ? 'saved' : d.status === 'saved' ? 'done' : d.status;

/**
 * The documents `ids` saved from reads of `kind` were deleted (not cancelled): their drafts are no longer saved — the
 * draft keeps its own check status, is marked {@link AiDraft.deleted} („документот е избришан – може повторно да се
 * зачува“) and is saved again by the editor / „Зачувај ги сите спремни“ without a new AI read. `to`: the documents were
 * replaced by another one (merged calculations) — the drafts point to it instead and stay saved. Returns the drafts changed.
 */
export async function releaseScanDrafts(tx: Tx, firmId: string, kind: SavedDocKind, ids: readonly string[], to?: string | null): Promise<number> {
  const S = [...new Set(ids.filter(Boolean))];
  if (!S.length) return 0;
  const D = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, kind),
    or(...S.map((id) => sql`${aiDocuments.drafts} @> ${JSON.stringify([{ savedId: id }])}::jsonb`))));
  const at = new Date().toISOString();
  let n = 0;
  for (const d of D) {
    const drafts = d.drafts.map((x) => {
      if (!x.savedId || !S.includes(x.savedId)) return x;
      n++;
      if (to) return { ...x, savedId: to };
      const { savedId: _s, ...rest } = x;
      return { ...rest, deleted: at };
    });
    await tx.update(aiDocuments).set({ drafts, status: docStatus(d, drafts) }).where(eq(aiDocuments.id, d.id));
  }
  return n;
}

/**
 * Drafts saved before {@link releaseScanDrafts} existed whose purchase / invoice is gone (deleted with its nalog): they
 * are released now — called where the scan lists are shown and before a save, so such a read is never stuck as
 * „зачувано“ (and never needs a new AI read). A cancelled (сторно) invoice keeps its row, so its draft stays saved.
 */
export async function releaseDeletedScanDrafts(tx: Tx, firmId: string, kinds: readonly SavedDocKind[] = ['purchase', 'sale']): Promise<number> {
  let n = 0;
  for (const kind of kinds) {
    const t = kind === 'sale' ? invoices : purchases;
    const D = await tx.select({ drafts: aiDocuments.drafts }).from(aiDocuments).where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, kind),
      sql`exists (select 1 from jsonb_array_elements(${aiDocuments.drafts}) e where e->>'savedId' is not null
        and not exists (select 1 from ${t} x where x.id = case when e->>'savedId' ~* '^[0-9a-f-]{36}$' then (e->>'savedId')::uuid end))`));
    const ids = [...new Set(D.flatMap((d) => d.drafts.flatMap((x) => (x.savedId ? [x.savedId] : []))))];
    if (!ids.length) continue;
    const uu = ids.filter((x) => UUID.test(x));
    const live = new Set(uu.length ? (await tx.select({ id: t.id }).from(t).where(inArray(t.id, uu))).map((x) => x.id) : []);
    n += await releaseScanDrafts(tx, firmId, kind, ids.filter((x) => !live.has(x)));
  }
  return n;
}

/**
 * „Прескокни“ / „Врати“: one invoice of a read document is left out (a duplicate, a page that is no invoice) or taken
 * back; the other invoices of the same file are not touched. A saved invoice cannot be skipped.
 */
export async function skipDraft(tx: Tx, firmId: string, docId: string, index: number, skip = true): Promise<void> {
  const d = await loadAiDocument(tx, firmId, docId);
  const x = d.drafts[index];
  if (!x) throw new DocumentError('Фактурата не постои во документот.');
  if (x.savedId) throw new DocumentError('Фактурата е веќе зачувана.');
  const drafts = d.drafts.map((y, i) => (i === index ? { ...y, skipped: skip || undefined } : y));
  await tx.update(aiDocuments).set({ drafts, status: docStatus(d, drafts) }).where(eq(aiDocuments.id, docId));
}

/** „2-3“ / „1,4“ / „2“ → [2, 3] / [1, 4] / [2] (1-based); [] when not readable. */
export function pageList(p: string | null | undefined): number[] {
  const out: number[] = [];
  for (const part of String(p ?? '').split(/[,;]/)) {
    const m = /^\s*(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?\s*$/.exec(part);
    if (!m) continue;
    const a = +m[1]!, b = m[2] ? +m[2] : a;
    for (let k = a; k <= b && k - a < 200; k++) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The files to link to the purchase saved from draft `index` of a read document: the read file — for photos read
 * together (`extraFileIds`, one photo per page) only the photos of this invoice's pages (all of them when the pages
 * are not known). `shared`: the file holds several invoices, so each purchase links it (`sharedSource`).
 */
export function draftSourceFiles(doc: Pick<AiDocument, 'fileId' | 'options' | 'drafts'>, index: number): { fileIds: string[]; shared: boolean; pages: string } {
  const all = [doc.fileId, ...(((doc.options ?? {}) as { extraFileIds?: string[] }).extraFileIds ?? [])].filter((x): x is string => !!x);
  const dr = (doc.drafts[index]?.draft ?? {}) as { pages?: string };
  const pages = String(dr.pages ?? '');
  const shared = doc.drafts.length > 1;
  if (all.length > 1) {
    const P = pageList(pages).filter((k) => k <= all.length);
    const mine = P.length ? P.map((k) => all[k - 1]!) : all;
    // a photo shared with another invoice (an invoice ending and the next one starting on the same page)
    return { fileIds: mine, shared: shared || mine.length < all.length, pages };
  }
  return { fileIds: all, shared, pages };
}

/**
 * A reviewed purchase draft as service input (batch save, „Зачувај ги сите спремни“). Each invoice of a file is its
 * own purchase with its own journal; the source file is linked to every one of them, with the pages of the invoice.
 */
export function purchaseInputFromDraft(d: ScanPurchaseDraft, src: { fileIds: string[]; shared: boolean; pages?: string }): PurchaseInput {
  const data = { ...(d.bankAcc ? { bankAcc: d.bankAcc } : {}), ...(src.shared && src.pages ? { srcPages: src.pages } : {}) };
  return {
    number: d.number, date: d.date, docDate: d.docDate || null, due: d.due || null, partnerId: d.partnerId || null,
    supplierName: d.supplierName, supplierEdb: d.supplierEdb, ptype: d.ptype, art32: d.art32, cash: d.cash, warehouseId: d.warehouseId,
    groups: d.groups.map((g) => ({ account: g.konto, rate: g.rate, base: g.base, vat: g.vat })),
    stock: d.stock.map((s) => ({ itemId: s.itemId || null, name: s.name, code: s.code, barcode: s.barcode, unit: s.unit, qty: s.qty, price: s.price, amount: s.amount, sp: s.sp === '' ? null : s.sp, type: s.type, rate: s.rate })),
    fileIds: src.fileIds, scanned: true, ...(src.shared ? { sharedSource: true } : {}), ...(Object.keys(data).length ? { data } : {}),
  };
}
