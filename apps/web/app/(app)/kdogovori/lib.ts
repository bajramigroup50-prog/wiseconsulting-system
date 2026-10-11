import 'server-only';
/**
 * Server helpers of the accounting-service contracts (legacy 10322–10397, 13554–13616): loading the office data
 * (`app_settings.office`), mapping `service_contracts` rows, the contract HTML with inlined images for the server
 * PDF, and the dossier copies (legacy `kdDraftArch` / `kdArchive`).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { kdHtml, kdNormalize, kdOfficeFirm, kdRecPlan, kdVat, KD_DOS_CAT, type KdContract, type KdFirm, type KdOffice, type KdRecExisting } from '@wise/core/firms/kdog';
import { PDFDOC_CSS } from '@wise/core/print-css';
import { dossierDocs, fileLinks, files, firms, getOfficeProfile, OFFICE_FILE_ENTITY, partners, recurringInvoices, serviceContracts, type Firm, type Tx } from '@wise/db';
import { db } from '@/lib/db';
import { renderPdf } from '@/lib/jobs';
import { dataUri, fileImageIds, inlineFileImages } from '@/lib/print-pdf';
import { getObjectBytes } from '@/lib/storage';
import { today } from '@/lib/office';

export type ContractRow = typeof serviceContracts.$inferSelect;

export const loadOffice = async (tx: Tx = db()): Promise<KdOffice> => (await getOfficeProfile(tx)) as KdOffice;

/** `service_contracts` row → contract (columns win over `data`). */
export function rowToContract(r: ContractRow): KdContract {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return kdNormalize({ ...d, id: r.id, number: r.number, date: r.date, start: r.start ?? undefined, end: r.end ?? undefined, fee: d.fee ?? r.fee } as Partial<KdContract> & Record<string, unknown>, today());
}

export const firmOf = (f: Firm): KdFirm & { signer?: string; rep?: string } => {
  const s = (f.settings ?? {}) as Record<string, string | undefined>;
  return { name: f.name, address: f.address, city: f.city, edb: f.edb, embs: f.embs, phone: f.phone, email: f.email, bank: s.bankAccount ?? null, logo: s.logo ?? null, signer: s.signer ?? s.manager, rep: s.rep, manager: s.manager ?? s.signer ?? null };
};

/** The office firm (legacy `offFirm`). */
export async function officeFirm(O: KdOffice): Promise<Firm | null> {
  return kdOfficeFirm(await db().select().from(firms), O);
}

export const imgUrl = (id: string) => `/api/files/${id}`;

/** Contract HTML for the screen / print view (images through `/api/files`). */
export async function contractHtml(k: KdContract, firm: Firm, O: KdOffice, opts: { peekNo?: string; e?: boolean } = {}): Promise<string> {
  const off = await officeFirm(O);
  return kdHtml(k, { firm: firmOf(firm), firmId: firm.id, O, off: off ? firmOf(off) : null, peekNo: opts.peekNo, e: opts.e, img: imgUrl, draftMark: true });
}

/** Replace `/api/files/{id}` images by data URIs (the worker's Chromium has no network). */
export async function inlineImages(html: string): Promise<string> {
  const ids = fileImageIds(html).slice(0, 20);
  const M = new Map<string, string | null>();
  if (ids.length) {
    const F = await db().select().from(files).where(inArray(files.id, ids));
    for (const f of F) if (f.status === 'ready' && f.mime.startsWith('image/') && f.size <= 5_000_000) M.set(f.id.toLowerCase(), dataUri(f.mime, await getObjectBytes(f.bucketKey).catch(() => new Uint8Array())));
  }
  return inlineFileImages(html, M);
}

/** Queue the server PDF of an HTML document, linked to an entity once stored. */
export async function pdfTo(html: string, title: string, firmId: string, userId: string, link: { entityType: string; entityId: string }): Promise<string> {
  return renderPdf({ html: `<div id="printArea" style="display:block"><div class="pdfdoc">${await inlineImages(html)}</div></div>`, css: PDFDOC_CSS, title, firmId, userId, link });
}

/** Dossier document of the contract (draft or signed) — the PDF is linked by the worker when it is stored. */
export async function insertDossierCopy(tx: Tx, firmId: string, userId: string, k: KdContract, O: KdOffice, signed: boolean): Promise<string> {
  const [d] = await tx.insert(dossierDocs).values({
    firmId, category: KD_DOS_CAT, title: `Договор за сметководствени услуги ${k.number}${signed ? '' : ' (чека потпис)'}`, number: k.number, date: k.date,
    validTo: k.dur === 'def' && k.end ? k.end : null, partnerName: O.name ?? null, createdBy: userId,
    note: signed ? `Потпишан: давател ${String(k.offSig?.at ?? '').slice(0, 10)}, нарачател ${String(k.cliSig?.at ?? '').slice(0, 10)}` : 'Примерок пред потпишување – по потпишувањето се заменува со потпишаниот.',
  }).returning({ id: dossierDocs.id });
  return d!.id;
}

/** Remove a dossier copy (draft replaced by the signed one); the files stay in the archive. */
export async function removeDossierCopy(tx: Tx, firmId: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  await tx.delete(dossierDocs).where(and(eq(dossierDocs.id, id), eq(dossierDocs.firmId, firmId)));
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), eq(fileLinks.entityId, id)));
}

/** Legacy `kdRecPlan` for the office firm (rows, partners, recurring definitions). */
export async function recPlanFor(officeFirmId: string) {
  const O = await loadOffice();
  const [F, P, R] = await Promise.all([
    db().select({ id: firms.id, name: firms.name, edb: firms.edb, embs: firms.embs, active: firms.active, settings: firms.settings, address: firms.address, city: firms.city, email: firms.email, phone: firms.phone, vatRegistered: firms.vatRegistered }).from(firms),
    db().select({ id: partners.id, edb: partners.edb, embs: partners.embs, code: partners.code }).from(partners).where(eq(partners.firmId, officeFirmId)),
    db().select().from(recurringInvoices).where(eq(recurringInvoices.firmId, officeFirmId)),
  ]);
  const ex = new Map<string, KdRecExisting>(R.map((r) => [r.id, { id: r.id, price: Number(r.items[0]?.price) || 0, end: r.end }]));
  return { O, F, P, R, plan: kdRecPlan(F, officeFirmId, P, ex, kdVat(O)) };
}

