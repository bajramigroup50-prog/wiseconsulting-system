/**
 * `doc_reads` kind `tripbundle` — „📦 Пакет на патувањето“: ONE PDF (or photo) with the whole trip of a transport client.
 * 1. the model groups the pages (invoice / CMR / travel order / receipts / other, `TRIP_BUNDLE_PROMPT`) and pdf-lib cuts
 *    one file per group;
 * 2. the travel order is read (countries, border times) → the trip (or, for a trip given with the upload, its countries);
 * 3. the invoice is read and saved as an outgoing invoice when its read is clean (else it waits for review);
 * 4. the CMR / other papers are attached to the trip, the receipts read (any country, own currency);
 * 5. the trip is booked in ONE nalog opened with the invoice number (per diems + road expenses + the invoice).
 * Every step that cannot be done automatically is written in `result.notes`; the dossier shows the rest to finish.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { bundleGroups, frPerDiems, TRIP_BUNDLE_PROMPT, type BundleKind, type TravelRead } from '@wise/core/industry';
import { fxRate } from '@wise/core';
import {
  aiDocuments, bookTrip, docReads, fileLinks, files, freightTours, industryConfigOf, loadFirm, loadFxSources, saveSelectedScanDrafts, tourFromTravelRead,
  TRIP_FILE_ENTITY, users, type DB, type Tx,
} from '@wise/db';
import { AiReadError, fileContent, readContent } from '../ai/read-document';
import { readObject } from '../ai/storage';
import { s3Store, storeFile, type ObjectStore } from '../storage';
import { runReadDocument } from './ai-read-document';

export interface BundlePart { kind: BundleKind; fileId: string; pages: string; number: string; aiDocId?: string; readId?: string; invoiceId?: string }
export interface BundleResult { parts: BundlePart[]; tourId: string | null; nalog: string | null; notes: string[] }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });
const isPdf = (f: { mime: string; name: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);

export async function runTripBundle(db: Tx, row: typeof docReads.$inferSelect, runRead: (id: string) => Promise<void>, store: ObjectStore = s3Store): Promise<BundleResult> {
  const F = await db.select().from(files).where(and(inArray(files.id, row.fileIds), eq(files.firmId, row.firmId), eq(files.status, 'ready')));
  if (!F.length) throw new AiReadError('Датотеката не е пронајдена.');
  const notes: string[] = [];
  const parts: BundlePart[] = [];
  // 1. split by kind
  for (const f of F) {
    const bytes = await readObject(f.bucketKey);
    let n = 1;
    let src: PDFDocument | null = null;
    if (isPdf(f)) {
      try { src = await PDFDocument.load(bytes, { ignoreEncryption: true }); n = src.getPageCount(); } catch { throw new AiReadError(`„${f.name}“ не може да се отвори како PDF.`); }
      if (n > 80) throw new AiReadError(`„${f.name}“ има ${n} страници – најмногу 80 во еден пакет.`);
    }
    const c = fileContent(f, bytes);
    const r = await readContent<unknown>({ db, firmId: row.firmId, prompt: TRIP_BUNDLE_PROMPT(n), tier: 'quick', purpose: 'tripBundle:split', refId: row.id, userId: row.createdBy, maxTokens: 2000, prune: false }, c);
    const G = bundleGroups(r.data, n);
    if (!G) throw new AiReadError(`Не успеа поделбата на „${f.name}“ – прикачете ги документите посебно.`);
    if (G.length === 1 || !src) { parts.push({ kind: G[0]!.kind, fileId: f.id, pages: n > 1 ? `1-${n}` : '1', number: G[0]!.number }); continue; }
    const base = f.name.replace(/\.pdf$/i, '');
    for (const g of G) {
      const d = await PDFDocument.create();
      (await d.copyPages(src, Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from - 1 + i))).forEach((p) => d.addPage(p));
      const pages = g.from === g.to ? String(g.from) : `${g.from}-${g.to}`;
      const fileId = await storeFile(db as unknown as DB, store, { firmId: row.firmId, name: `${base}_${g.kind}_${pages}.pdf`, mime: 'application/pdf', ext: 'pdf', body: await d.save(), userId: row.createdBy });
      parts.push({ kind: g.kind, fileId, pages, number: g.number });
    }
  }
  const [usr] = row.createdBy ? await db.select({ role: users.role }).from(users).where(eq(users.id, row.createdBy)).limit(1) : [];
  const a = { firmId: row.firmId, userId: row.createdBy, role: usr?.role ?? 'admin' };
  let tourId = row.refId;
  // 2. travel order → the trip / its countries
  for (const p of parts.filter((x) => x.kind === 'travel')) {
    const [tr] = await db.insert(docReads).values({ firmId: row.firmId, kind: 'travel', fileIds: [p.fileId], createdBy: row.createdBy }).returning({ id: docReads.id });
    p.readId = tr!.id;
    await runRead(tr!.id);
    const [rd] = await db.select().from(docReads).where(eq(docReads.id, tr!.id)).limit(1);
    if (rd?.status !== 'done') { notes.push(`Патниот налог (стр. ${p.pages}) не е прочитан: ${rd?.error ?? ''}`); continue; }
    if (!tourId) {
      try { tourId = await db.transaction((tx) => tourFromTravelRead(tx as unknown as Tx, a, tr!.id)); }
      catch (e) { notes.push(`Патувањето не е креирано од патниот налог: ${(e as Error).message}`); }
    } else {
      const x = rd.result as unknown as TravelRead;
      const [t] = await db.select().from(freightTours).where(eq(freightTours.id, tourId)).limit(1);
      if (t && !(t.segs ?? []).length && x.segs.length) await db.update(freightTours).set({ segs: x.segs, retDate: t.retDate ?? (x.ret ? x.ret.slice(0, 10) : null) }).where(eq(freightTours.id, tourId));
      await db.update(docReads).set({ status: 'used', refId: tourId }).where(eq(docReads.id, tr!.id));
    }
  }
  // 3. the invoice: read, saved when clean, linked to the trip
  for (const p of parts.filter((x) => x.kind === 'invoice')) {
    const [d] = await db.insert(aiDocuments).values({ firmId: row.firmId, fileId: p.fileId, kind: 'sale', createdBy: row.createdBy, options: { split: true, tripBundle: row.id } }).returning({ id: aiDocuments.id });
    p.aiDocId = d!.id;
    await runReadDocument(db, d!.id, () => {}, store);
    const [doc] = await db.select().from(aiDocuments).where(eq(aiDocuments.id, d!.id)).limit(1);
    const ok = (doc?.drafts ?? []).map((x, i) => ({ x, i })).filter(({ x }) => x.status === 'ok' && !x.savedId);
    if (!ok.length) { notes.push(`Фактурата (стр. ${p.pages}) чека проверка – отворете ја и зачувајте ја.`); continue; }
    const r = await db.transaction((tx) => saveSelectedScanDrafts(tx as unknown as Tx, { firmId: row.firmId, kind: 'sale', ids: ok.map(({ i }) => `${d!.id}:${i}`), actor: a }));
    if (r.failed.length) notes.push(`Фактурата не е зачувана: ${r.failed.map((x) => `${x.number} (${x.why})`).join('; ')}`);
    const [after] = await db.select({ drafts: aiDocuments.drafts }).from(aiDocuments).where(eq(aiDocuments.id, d!.id)).limit(1);
    p.invoiceId = after?.drafts.find((x) => x.savedId)?.savedId;
    if (p.invoiceId && tourId) {
      const [t] = await db.select({ inv: freightTours.invoiceId }).from(freightTours).where(eq(freightTours.id, tourId)).limit(1);
      if (t && !t.inv) await db.update(freightTours).set({ invoiceId: p.invoiceId, status: 'inv' }).where(eq(freightTours.id, tourId));
    }
  }
  if (!tourId) {
    notes.push('Нема патување: изберете го патувањето кај пакетот („Поврзи“) за да се прикачат CMR и сметките.');
    return { parts, tourId: null, nalog: null, notes };
  }
  // 4. CMR / other → the trip; receipts → read
  for (const p of parts) {
    if (p.kind === 'cmr' || p.kind === 'other') await db.insert(fileLinks).values({ fileId: p.fileId, entityType: TRIP_FILE_ENTITY, entityId: tourId, role: p.kind === 'cmr' ? 'cmr' : 'doc' }).onConflictDoNothing();
    if (p.kind === 'travel') await db.insert(fileLinks).values({ fileId: p.fileId, entityType: TRIP_FILE_ENTITY, entityId: tourId, role: 'travel' }).onConflictDoNothing();
    if (p.kind === 'receipt') {
      const [cr] = await db.insert(docReads).values({ firmId: row.firmId, kind: 'tripcost', fileIds: [p.fileId], refId: tourId, createdBy: row.createdBy }).returning({ id: docReads.id });
      p.readId = cr!.id;
      await runRead(cr!.id);
    }
  }
  // 5. one nalog for the whole trip
  let nalog: string | null = null;
  try {
    const firm = await loadFirm(db, row.firmId);
    const fx = await loadFxSources(db, row.firmId);
    const [t] = await db.select().from(freightTours).where(eq(freightTours.id, tourId)).limit(1);
    const rates = (industryConfigOf<{ rates: Record<string, [number, string]> }>(firm, 'frt').rates ?? {}) as Record<string, [number, string]>;
    const dn = frPerDiems({ red: t!.red, segs: t!.segs, date: t!.date }, (c, d) => { try { return fxRate(c, d, fx) || 0; } catch { return 0; } }, rates);
    if (dn.miss.length) notes.push(`Дневници: нема курс за ${dn.miss.join(', ')}.`);
    const r = await db.transaction((tx) => bookTrip(tx as unknown as Tx, a, tourId!, { perDiem: { mkd: dn.miss.length ? 0 : dn.mkd, detail: dn.rows.map((x) => `${x.c} ${x.u}×${x.amt} ${x.cur}`).join(', ') }, payK: '2411', fx, today: today() }));
    if (r.perDiems || r.costs) nalog = r.nalog;
    notes.push(...r.skipped.map((s) => `Не е книжено: ${s}`));
    if (!nalog) notes.push('Ништо не е прокнижено (нема дневници ни сметки).');
  } catch (e) { notes.push(`Книжењето не успеа: ${(e as Error).message}`); }
  return { parts, tourId, nalog, notes };
}
