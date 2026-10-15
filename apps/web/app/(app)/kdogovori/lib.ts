import 'server-only';
/**
 * Server helpers of the accounting-service contracts (legacy 10322–10397, 13554–13616): loading the office data
 * (`app_settings.office`), mapping `service_contracts` rows, the contract HTML with inlined images for the server
 * PDF, and the dossier copies (legacy `kdDraftArch` / `kdArchive`).
 *
 * Owner decision: the contracts are made BY the office firm (БАЈРАМИ ГРОУП ДООЕЛ Скопје, „Фирма на канцеларијата“)
 * WITH each client firm, and the whole module is the office OWNER's only (`isOfficeOwner`): page, actions, print and
 * Word routes. Never in the client portal and never for other office users.
 *
 * 🎭 A demo admin is the owner of the sandboxed DEMO office (`lib/demo-office.ts`): its provider is the demo office firm
 * „ДЕМО СМЕТКОВОДСТВО ДООЕЛ“ with the demo office profile (`demoOffice`), its clients the demo firms only — never the
 * real office (`settings.officeFirm`, БАЈРАМИ ГРОУП) and never a real client (`kdClientFirm` re-checks the side).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { kdHtml, kdNormalize, kdProvider, kdRecPlan, kdVat, KD_DOS_CAT, type KdContract, type KdFirm, type KdOffice, type KdRecExisting } from '@wise/core/firms/kdog';
import { isDemoFirm } from '@wise/core/demo';
import { PDFDOC_CSS } from '@wise/core/print-css';
import { dossierDocs, fileLinks, files, firms, getOfficeProfile, officeFirmOf, OFFICE_FILE_ENTITY, OfficeError, partners, recurringInvoices, serviceContracts, type Firm, type Tx } from '@wise/db';
import { assertFirmSide, firmOnSide, isDemoOwner, officeFirmFor, officeProfileFor } from '@/lib/demo-office';
import { isDemoUser } from '@/lib/demo';
import { getUser, requireUser, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { renderPdf } from '@/lib/jobs';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { dataUri, fileImageIds, inlineFileImages } from '@/lib/print-pdf';
import { getObjectBytes } from '@/lib/storage';
import { isUuid, today } from '@/lib/office';

export type ContractRow = typeof serviceContracts.$inferSelect;

/** Contract-number counter (`office_counters.key`): the 🎭 demo office has its own (numbers „ДЕМО-СУ-001/2026“), never touching the real office's numbers. */
export const kdCounterKey = (demo: boolean): string => (demo ? 'demo:kdog' : 'kdog');

/** The office settings of a side (`demo`: the 🎭 demo office's copy). */
export const loadOffice = async (tx: Tx = db(), demo = false): Promise<KdOffice> => (await getOfficeProfile(tx, { demo })) as KdOffice;

/**
 * The office settings (`raw`), the office firm and the provider data merged from both (firm wins, `kdProvider`) —
 * of the user's side: the real office, or for a 🎭 demo user the demo office (`officeProfileFor` / `officeFirmFor`).
 */
export async function loadProvider(u: SessionUser): Promise<{ raw: KdOffice; off: Firm | null; O: KdOffice; demo: boolean }> {
  const raw = (await officeProfileFor(u)) as KdOffice;
  const off = await officeFirmFor(u, raw);
  return { raw, off, O: kdProvider(raw, off), demo: isDemoUser(u) };
}

/* ---------------- owner-only guard ---------------- */

/** The signed-in user when they are the office owner (or 🎭 the demo office's owner, a demo admin), else `null`. */
export async function kdOwnerUser(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && u.role === 'admin' && (isDemoOwner(u) || (await isOfficeOwner(u))) ? u : null;
}

/** Server-action guard: only the office owner (or 🎭 the demo office's owner — then on demo data only). */
export async function kdOwnerAction(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isDemoOwner(u) && !(await isOfficeOwner(u))) throw new OfficeError(OWNER_ONLY_MSG);
  return u;
}

/**
 * The client firm a contract is made with (any firm of the user's side except the office firm itself): a 🎭 demo
 * user only ever a demo firm, a real user never a demo firm — an id of the other side (forged form) is refused.
 */
export async function kdClientFirm(id: unknown, off: Pick<Firm, 'id'> | null, u: SessionUser): Promise<Firm> {
  if (!isUuid(id)) throw new OfficeError('Изберете клиент (фирма).');
  const f = await assertFirmSide(u, id);
  if (off && off.id === f.id) throw new OfficeError('Фирмата на канцеларијата е давател на услугата – изберете клиент.');
  return f;
}

/** Is the firm a client of this user's side (for the page / print view: never the other side's firm)? */
export const kdOnSide = (u: SessionUser, f: Firm | null | undefined): f is Firm => !!f && firmOnSide(u, f);

/** `service_contracts` row → contract (columns win over `data`). */
export function rowToContract(r: ContractRow): KdContract {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return kdNormalize({ ...d, id: r.id, number: r.number, date: r.date, start: r.start ?? undefined, end: r.end ?? undefined, fee: d.fee ?? r.fee } as Partial<KdContract> & Record<string, unknown>, today());
}

export const firmOf = (f: Firm): KdFirm & { signer?: string; rep?: string } => {
  const s = (f.settings ?? {}) as Record<string, string | undefined>;
  return { name: f.name, address: f.address, city: f.city, edb: f.edb, embs: f.embs, phone: f.phone, email: f.email, bank: s.bankAccount ?? null, logo: s.logo ?? null, signer: s.signer ?? s.manager, rep: s.rep, manager: s.manager ?? s.signer ?? null };
};

/** The office firm (legacy `offFirm`) of the CLIENT firm's side: the demo office firm for a demo client, the real one otherwise. */
export async function officeFirm(O: KdOffice, client?: Pick<Firm, 'name' | 'settings'>): Promise<Firm | null> {
  return officeFirmOf(await db().select().from(firms), O, { demo: isDemoFirm(client) });
}

export const imgUrl = (id: string) => `/api/files/${id}`;

/** Contract HTML for the screen / print view (images through `/api/files`). */
export async function contractHtml(k: KdContract, firm: Firm, O: KdOffice, opts: { peekNo?: string; e?: boolean } = {}): Promise<string> {
  const off = await officeFirm(O, firm);
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

/** Legacy `kdRecPlan` for the office firm (rows, partners, recurring definitions) — the clients of its side only. */
export async function recPlanFor(officeFirmId: string, demo = false) {
  const O = await loadOffice(db(), demo);
  const [F0, P, R] = await Promise.all([
    db().select({ id: firms.id, name: firms.name, edb: firms.edb, embs: firms.embs, active: firms.active, settings: firms.settings, address: firms.address, city: firms.city, email: firms.email, phone: firms.phone, vatRegistered: firms.vatRegistered }).from(firms),
    db().select({ id: partners.id, edb: partners.edb, embs: partners.embs, code: partners.code }).from(partners).where(eq(partners.firmId, officeFirmId)),
    db().select().from(recurringInvoices).where(eq(recurringInvoices.firmId, officeFirmId)),
  ]);
  const ex = new Map<string, KdRecExisting>(R.map((r) => [r.id, { id: r.id, price: Number(r.items[0]?.price) || 0, end: r.end }]));
  const F = F0.filter((f) => isDemoFirm(f) === demo);
  return { O, F, P, R, plan: kdRecPlan(F, officeFirmId, P, ex, kdVat(O)) };
}

