'use server';
/**
 * Legacy ACT `kdSaveB` / `kdOffSign` / `kdCliSign` / `kdDel` / `kdOffSave` / `kdToDos` / `kdRecSync` / `offFirmSet` and the
 * `[data-kdup]` upload (10384–10397, 13554–13616).
 *
 * Owner decision: every action is the office OWNER's only (`kdOwnerAction`) and names the client firm explicitly
 * (`firmId`) — the owner works on all clients from one screen without switching the current firm. The provider is the
 * office firm (`loadProvider`). The client no longer signs in the portal: the owner signs, then either uploads the
 * paper copy signed by the client or lets the client sign on the screen in the office.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { kdIndex, kdNormalize, kdRecFirst, kdStatusCode, kdVat, type KdContract, type KdOffice } from '@wise/core/firms/kdog';
import {
  audit, contractNumber, fileLinks, files, firms, IndustryError, items, nextOfficeNumber, OFFICE_FILE_ENTITY, OfficeError, partners, patchOfficeProfile,
  recurringInvoices, serviceContracts, textMailHtml, type Firm, type Tx,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { storeImageDataUrl } from '@/lib/data-url-file';
import { db } from '@/lib/db';
import { splitAddresses, validAddresses } from '@/lib/mail';
import { fv, isUuid, officeError, today } from '@/lib/office';
import { dispatchPdfMail, pdfFileTitle, queuePdfMail } from '@/lib/pdf-mail';
import { contractHtml, inlineImages, insertDossierCopy, kdClientFirm, kdOwnerAction, loadOffice, loadProvider, pdfTo, recPlanFor, removeDossierCopy, rowToContract } from './lib';

type Res = ActionState & { id?: string };
const nowLoc = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16).replace(' ', 'T');
const err = (e: unknown): Res => (e instanceof IndustryError ? { error: e.message } : officeError(e));

/** Owner, provider and the client firm of an action. */
async function ownerCtx(firmId: unknown) {
  const u = await kdOwnerAction();
  const P = await loadProvider();
  const firm = await kdClientFirm(firmId, P.off);
  return { u, firm, O: P.O, off: P.off };
}
const done = () => { revalidatePath('/kdogovori'); };

async function loadContract(tx: Tx, id: string, firmId: string) {
  if (!isUuid(id)) throw new OfficeError('Договорот не постои.');
  const [r] = await tx.select().from(serviceContracts).where(and(eq(serviceContracts.id, id), eq(serviceContracts.firmId, firmId))).limit(1);
  if (!r) throw new OfficeError('Договорот не постои.');
  return rowToContract(r);
}

/** Columns + data of a contract. */
const cols = (k: KdContract, rate: number) => ({
  number: k.number, date: k.date, start: k.start || k.date, end: k.dur === 'def' && k.end ? k.end : null,
  fee: (Math.round((Number(kdIndex(k, rate).kdog.gross) || 0) * 100) / 100).toFixed(2), status: kdStatusCode(k), data: { ...k, id: undefined } as Record<string, unknown>,
});

/** Legacy `kdIndex`: the contract summary and the monthly fee on the firm (merged into settings). */
async function indexFirm(tx: Tx, firmId: string, k: KdContract | null, rate: number) {
  if (!k) { await tx.update(firms).set({ settings: sql`${firms.settings} - 'kdog'` }).where(eq(firms.id, firmId)); return; }
  const x = kdIndex(k, rate);
  const patch = JSON.stringify(x.accFee ? { kdog: x.kdog, accFee: x.accFee } : { kdog: x.kdog });
  await tx.update(firms).set({ settings: sql`${firms.settings} || ${patch}::jsonb` }).where(eq(firms.id, firmId));
}

/** Draft PDF into the dossier (legacy `kdDraftArch`); replaces the previous draft copy. Returns the PDF job input. */
async function draftCopy(tx: Tx, firm: Firm, userId: string, k: KdContract, O: KdOffice) {
  await removeDossierCopy(tx, firm.id, k.draftArch);
  const did = await insertDossierCopy(tx, firm.id, userId, k, O, false);
  k.draftArch = did;
  return did;
}

/** Legacy `kdSaveB` (+ v419 draft in the dossier). FIX(#8): the number comes from the atomic per-year counter. */
export async function saveContract(firmId: string, json: string): Promise<Res> {
  try {
    const { u, firm, O } = await ownerCtx(firmId);
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(json) as Record<string, unknown>; } catch { return { error: 'Неважечки податоци.' }; }
    if (!O.name) return { error: 'Прво одредете ја фирмата на канцеларијата (давател на услугата).' };
    const rate = kdVat(O);
    const k0 = kdNormalize(raw as Partial<KdContract>, today());
    let k!: KdContract, did = '';
    await db().transaction(async (tx) => {
      let cur: KdContract | null = null;
      if (k0.id) cur = await loadContract(tx, k0.id, firm.id);
      if (cur?.offSig) throw new OfficeError('Договорот е потпишан од канцеларијата и не може да се менува.');
      k = { ...k0, number: cur?.number || '', offSig: null, cliSig: null, arch: null, draftArch: cur?.draftArch ?? null };
      if (!k.number) { const y = Number(k.date.slice(0, 4)); k.number = contractNumber(await nextOfficeNumber(tx, 'kdog', y), y); }
      did = await draftCopy(tx, firm, u.id, k, O);
      if (cur) await tx.update(serviceContracts).set(cols(k, rate)).where(eq(serviceContracts.id, cur.id!));
      else { const [r] = await tx.insert(serviceContracts).values({ ...cols(k, rate), firmId: firm.id, createdBy: u.id }).returning({ id: serviceContracts.id }); k.id = r!.id; }
      await indexFirm(tx, firm.id, k, rate);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdSaveB', entityType: 'service_contract', entityId: k.id, data: { number: k.number, fee: k.fee, feeMode: k.feeMode } });
    });
    await pdfTo(await contractHtml(k, firm, O), `Dogovor_${k.number}_nacrt`, firm.id, u.id, { entityType: OFFICE_FILE_ENTITY.dossier, entityId: did });
    done();
    return { ok: `Договорот ${k.number} е зачуван (и примерок во досието). Следно: „✍ Потпиши и печат“.`, id: k.id };
  } catch (e) { return err(e); }
}

/** Legacy `kdToDos`: put (again) the unsigned contract in the dossier. */
export async function contractToDossier(firmId: string, id: string): Promise<Res> {
  try {
    const { u, firm, O } = await ownerCtx(firmId);
    let k!: KdContract, did = '';
    await db().transaction(async (tx) => {
      k = await loadContract(tx, id, firm.id);
      if (k.arch) throw new OfficeError('Потпишаниот договор е веќе во досието.');
      did = await draftCopy(tx, firm, u.id, k, O);
      await tx.update(serviceContracts).set({ data: { ...k, id: undefined } }).where(eq(serviceContracts.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdToDos', entityType: 'service_contract', entityId: id });
    });
    await pdfTo(await contractHtml(k, firm, O), `Dogovor_${k.number}_nacrt`, firm.id, u.id, { entityType: OFFICE_FILE_ENTITY.dossier, entityId: did });
    done();
    return { ok: '📁 Договорот е зачуван во „Документи на фирмата“ (досие).' };
  } catch (e) { return err(e); }
}

/** Legacy `kdOffSign`: the office's signature and stamp; after this the contract goes to the client's portal. */
export async function officeSign(firmId: string, id: string): Promise<Res> {
  try {
    const { u, firm, O } = await ownerCtx(firmId);
    await db().transaction(async (tx) => {
      const k = await loadContract(tx, id, firm.id);
      if (k.offSig) throw new OfficeError('Договорот е веќе потпишан.');
      k.offSig = { sig: O.sig ?? null, stamp: O.stamp ?? null, at: nowLoc(), by: u.name };
      await tx.update(serviceContracts).set(cols(k, kdVat(O))).where(eq(serviceContracts.id, id));
      await indexFirm(tx, firm.id, k, kdVat(O));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdOffSign', entityType: 'service_contract', entityId: id, data: { number: k.number, sig: !!O.sig, stamp: !!O.stamp } });
    });
    done();
    return { ok: 'Потпишано. Следно: потпис на клиентот (на екран во канцеларијата или прикачен скениран потпишан примерок).' };
  } catch (e) { return err(e); }
}

/** Both parties signed → the signed copy in the dossier (legacy `kdArchive`), the draft copy removed. */
async function archive(tx: Tx, firm: Firm, userId: string, k: KdContract, O: KdOffice, scanFileId: string | null): Promise<string | null> {
  const did = await insertDossierCopy(tx, firm.id, userId, k, O, true);
  if (scanFileId) await tx.insert(fileLinks).values({ fileId: scanFileId, entityType: OFFICE_FILE_ENTITY.dossier, entityId: did, role: 'attachment' }).onConflictDoNothing();
  await removeDossierCopy(tx, firm.id, k.draftArch);
  k.draftArch = null;
  k.arch = did;
  await tx.update(serviceContracts).set(cols(k, kdVat(O))).where(eq(serviceContracts.id, k.id!));
  await indexFirm(tx, firm.id, k, kdVat(O));
  return scanFileId ? null : did;
}

/** Legacy `[data-kdup]`: a scanned copy signed on paper by the client. */
export async function uploadSignedCopy(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, O } = await ownerCtx(f.get('firmId'));
    const id = String(f.get('id') ?? '');
    const fileId = f.getAll('fileIds').find(isUuid);
    if (!fileId) return { error: 'Прикачете го скенираниот потпишан примерок.' };
    await db().transaction(async (tx) => {
      const k = await loadContract(tx, id, firm.id);
      if (!k.offSig) throw new OfficeError('Прво потпишете го договорот од страна на канцеларијата.');
      if (k.cliSig) throw new OfficeError('Договорот е веќе потпишан од клиентот.');
      const [fl] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, fileId), eq(files.firmId, firm.id), eq(files.status, 'ready'))).limit(1);
      if (!fl) throw new OfficeError('Датотеката не е пронајдена.');
      k.cliSig = { name: k.rep, at: nowLoc(), by: 'скениран примерок', scan: fileId };
      await archive(tx, firm, u.id, k, O, fileId);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdUpSigned', entityType: 'service_contract', entityId: id, data: { number: k.number, fileId } });
    });
    done();
    return { ok: '✅ Договорот е потпишан и архивиран во „Документи на фирмата“.' };
  } catch (e) { return err(e); }
}

/**
 * Legacy `kdCliSign`: the client's representative signs on the screen (name, drawn signature, optional stamp image) —
 * now in the office, on the owner's session (the contract is never shown in the client portal).
 */
export async function clientSign(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, O } = await ownerCtx(f.get('firmId'));
    const id = String(f.get('id') ?? '');
    const name = String(f.get('name') ?? '').trim().slice(0, 120);
    if (f.get('ok') !== 'on') return { error: 'Потврдете дека го прочитавте договорот.' };
    if (!String(f.get('sig') ?? '')) return { error: 'Потпишете се во полето.' };
    if (!name) return { error: 'Внесете име и презиме.' };
    let did: string | null = null, k!: KdContract;
    await db().transaction(async (tx) => {
      k = await loadContract(tx, id, firm.id);
      if (!k.offSig) throw new OfficeError('Договорот уште не е потпишан од канцеларијата.');
      if (k.cliSig) throw new OfficeError('Договорот е веќе потпишан.');
      const sig = await storeImageDataUrl(tx, { firmId: firm.id, userId: u.id, dataUrl: String(f.get('sig')), name: 'potpis' });
      const stamp = await storeImageDataUrl(tx, { firmId: firm.id, userId: u.id, dataUrl: String(f.get('stamp') ?? ''), name: 'pecat' });
      k.cliSig = { sig, stamp, name, at: nowLoc(), by: `на екран во канцеларијата (${u.name})` };
      did = await archive(tx, firm, u.id, k, O, null);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdCliSign', entityType: 'service_contract', entityId: id, data: { number: k.number, name } });
    });
    if (did) await pdfTo(await contractHtml(k, firm, O, { e: true }), `Dogovor_${k.number}`, firm.id, u.id, { entityType: OFFICE_FILE_ENTITY.dossier, entityId: did });
    done();
    return { ok: '✅ Договорот е потпишан и архивиран во „Документи на фирмата“.' };
  } catch (e) { return err(e); }
}

/** Legacy `kdDel` (ACT_NEED `del`): only before archiving; the firm summary is cleared. */
export async function deleteContract(firmId: string, id: string): Promise<Res> {
  try {
    const { u, firm } = await ownerCtx(firmId);
    await db().transaction(async (tx) => {
      const k = await loadContract(tx, id, firm.id);
      if (k.arch) throw new OfficeError('Архивиран договор не се брише.');
      await removeDossierCopy(tx, firm.id, k.draftArch);
      await tx.delete(serviceContracts).where(eq(serviceContracts.id, id));
      await indexFirm(tx, firm.id, null, 0);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdDel', entityType: 'service_contract', entityId: id, data: { number: k.number } });
    });
    done();
    return { ok: 'Избришано.' };
  } catch (e) { return err(e); }
}

/** Mark a signed contract as terminated (server extra kept from the earlier version). */
export async function endContract(firmId: string, id: string): Promise<Res> {
  try {
    const { u, firm } = await ownerCtx(firmId);
    await db().transaction(async (tx) => {
      await loadContract(tx, id, firm.id);
      await tx.update(serviceContracts).set({ status: 'ended' }).where(eq(serviceContracts.id, id));
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('kdog', coalesce(${firms.settings}->'kdog','{}'::jsonb) || '{"st":"раскинат"}'::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdEnd', entityType: 'service_contract', entityId: id });
    });
    done();
    return { ok: 'Договорот е означен како раскинат.' };
  } catch (e) { return err(e); }
}

/**
 * Legacy `kdOffSave` (+ signature / stamp upload): the contract defaults used by every contract. The provider's
 * identity (name, address, ЕДБ, ЕМБС) comes from the office firm and is copied into the office profile here so the
 * other office documents (templates, ЗЗЛП) say the same; the typed fields are only the fallback without an office firm.
 */
export async function saveOffice(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    const { off, O: P } = await loadProvider();
    const num = (k: string) => { const v = Number(String(f.get(k) ?? '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : ''; };
    const ident = off
      ? { name: P.name ?? '', address: P.address ?? '', city: P.city ?? '', edb: P.edb ?? '', embs: P.embs ?? '' }
      : { name: fv(f, 'name') ?? '', address: fv(f, 'address') ?? '', city: fv(f, 'city') ?? '', edb: fv(f, 'edb') ?? '', embs: fv(f, 'embs') ?? '' };
    const patch: KdOffice = {
      ...ident, lic: fv(f, 'lic') ?? '',
      rep: fv(f, 'rep') ?? '', repRole: fv(f, 'repRole') ?? 'Управител', fee: num('fee'), docDay: Math.min(28, Math.max(1, Math.round(Number(f.get('docDay')) || 5))),
      feeMode: f.get('feeMode') === 'net' ? 'net' : 'gross', vatOn: f.get('vatOn') === 'on',
    };
    const want = { sig: f.getAll('sigIds').find(isUuid), stamp: f.getAll('stampIds').find(isUuid) };
    await db().transaction(async (tx) => {
      for (const [k, id] of Object.entries(want) as ['sig' | 'stamp', string | undefined][]) {
        if (!id) continue;
        const [fl] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, id), isNull(files.firmId), eq(files.status, 'ready'))).limit(1);
        if (fl) patch[k] = fl.id;
      }
      await patchOfficeProfile(tx, patch as Record<string, unknown>, u.id);
      await audit(tx, { userId: u.id, action: 'kdOffSave', entityType: 'app_settings', entityId: 'office', data: { name: patch.name, sig: !!patch.sig, stamp: !!patch.stamp, officeFirm: off?.id ?? null } });
    });
    done();
    return { ok: 'Податоците за договорите се зачувани.' };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `offFirmSet` → „Фирма на канцеларијата“: the owner picks the firm record of the office (the provider of every
 * contract and the firm the monthly invoices are issued from). Its identity is copied into the office profile.
 */
export async function setOfficeFirm(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    const id = f.get('officeFirmId');
    if (!isUuid(id)) return { error: 'Изберете ја фирмата на канцеларијата.' };
    const [firm] = await db().select().from(firms).where(eq(firms.id, id)).limit(1);
    if (!firm) return { error: 'Фирмата не постои.' };
    await db().transaction(async (tx) => {
      const others = (await tx.select({ id: firms.id, settings: firms.settings }).from(firms)).filter((x) => x.id !== firm.id && (x.settings as { officeFirm?: boolean }).officeFirm);
      if (others.length) await tx.update(firms).set({ settings: sql`${firms.settings} || '{"officeFirm":false}'::jsonb` }).where(inArray(firms.id, others.map((x) => x.id)));
      await tx.update(firms).set({ settings: sql`${firms.settings} || '{"officeFirm":true}'::jsonb` }).where(eq(firms.id, firm.id));
      const dig = (v: string | null) => String(v ?? '').replace(/\D/g, '');
      await patchOfficeProfile(tx, { name: firm.name, address: firm.address ?? '', city: firm.city ?? '', edb: dig(firm.edb), embs: dig(firm.embs) } as Record<string, unknown>, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'offFirmSet', entityType: 'firm', entityId: firm.id });
    });
    done();
    return { ok: `„${firm.name}“ е фирмата на канцеларијата (давател на услугата).` };
  } catch (e) { return officeError(e); }
}

/** E-mail the contract (PDF attachment) to the client — legacy mail of the printed contract. */
export async function mailContract(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, O } = await ownerCtx(f.get('firmId'));
    const to = splitAddresses(String(f.get('to') ?? '') || firm.email || '');
    if (!to.length || !validAddresses(to)) return { error: 'Внесете точна е-пошта на клиентот.' };
    const [r] = await db().select().from(serviceContracts).where(and(eq(serviceContracts.id, String(f.get('id') ?? '')), eq(serviceContracts.firmId, firm.id))).limit(1);
    if (!r) return { error: 'Договорот не постои.' };
    const k = rowToContract(r);
    const html = await inlineImages(await contractHtml(k, firm, O, { e: !!k.cliSig && !k.cliSig.scan }));
    const jobs = await db().transaction(async (tx) => {
      const job = await queuePdfMail(tx, {
        firmId: firm.id, to, subject: `Договор за сметководствени услуги ${k.number} – ${O.name ?? ''}`.trim(),
        html: textMailHtml(`Почитувани,\n\nВо прилог е договорот за сметководствени услуги бр. ${k.number} помеѓу ${O.name ?? ''} и ${firm.name}.\n\nСо почит,\n${u.name}\n${O.name ?? ''}`),
        entityType: 'service_contract', entityId: k.id!, userId: u.id,
      }, { html: `<div class="pdfdoc">${html}</div>`, title: pdfFileTitle('Dogovor', k.number) });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdMail', entityType: 'service_contract', entityId: k.id, data: { number: k.number, to, mailId: job.logId } });
      return [job];
    });
    const failed = await dispatchPdfMail(jobs);
    revalidatePath('/mailhist');
    return failed ? { error: 'Редот за PDF е недостапен – пораката чека; проверете во „Историја на праќања“.' } : { ok: `✉ Договорот (PDF) се испраќа на ${to.join(', ')}.` };
  } catch (e) { return officeError(e); }
}

/* ---------------- Monthly invoices in the office firm (legacy `kdRecSync`) ---------------- */

export async function syncRecurring(): Promise<Res> {
  try {
    const u = await kdOwnerAction();
    const O = await loadOffice();
    const { off: firm } = await loadProvider();
    if (!firm) return { error: 'Прво одредете ја фирмата на канцеларијата – од неа се фактурираат услугите.' };
    const { F, P, plan } = await recPlanFor(firm.id);
    const rate = kdVat(O);
    const [it] = await db().select().from(items).where(and(eq(items.firmId, firm.id), eq(items.active, true), sql`${items.name} ~* 'сметководствени\\s+услуги'`)).limit(1);
    const recItem = (firm.settings as { recItem?: string }).recItem;
    const [it2] = recItem && isUuid(recItem) ? await db().select().from(items).where(and(eq(items.id, recItem), eq(items.firmId, firm.id))).limit(1) : [];
    const item = it2 ?? it;
    let n = 0;
    await db().transaction(async (tx) => {
      const codes = P.map((p) => p.code);
      for (const x of plan) {
        if (x.st === 'ок') continue;
        let pid = x.partnerId;
        if (!pid) {
          const src = F.find((q) => q.id === x.firm.id)!;
          const code = nextCode(codes); codes.push(code);
          const [np] = await tx.insert(partners).values({ firmId: firm.id, code, name: src.name, edb: src.edb, embs: src.embs, address: src.address, city: src.city, email: src.email, phone: src.phone, vatRegistered: src.vatRegistered, bankAccount: ((src.settings ?? {}) as { bankAccount?: string }).bankAccount ?? null }).returning({ id: partners.id });
          pid = np!.id;
          await audit(tx, { userId: u.id, firmId: firm.id, action: 'partnerNew', entityType: 'partner', entityId: pid, data: { name: src.name, source: 'kdRecSync' } });
        }
        const line = { itemId: item?.id ?? null, name: item?.name || 'Сметководствени услуги за месец', unit: item?.unit || 'ком', qty: 1, price: x.net, vat: rate };
        if (x.existing) {
          const [cur] = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.id, x.existing.id)).limit(1);
          const first = cur!.items[0];
          await tx.update(recurringInvoices).set({ items: [{ ...first, ...line, name: first?.name || line.name }, ...cur!.items.slice(1)], end: x.end || cur!.end }).where(eq(recurringInvoices.id, cur!.id));
          await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdRecSync', entityType: 'recurring_invoice', entityId: cur!.id, data: { client: x.firm.name, net: x.net, st: x.st } });
        } else {
          const [r] = await tx.insert(recurringInvoices).values({ firmId: firm.id, partnerId: pid, every: 'month', day: 'L', next: kdRecFirst(x.start, today()), end: x.end || null, dueDays: 15, note: `Според договор ${x.no}`.trim(), active: true, items: [line], createdBy: u.id }).returning({ id: recurringInvoices.id });
          await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify({ kdRecId: r!.id })}::jsonb` }).where(eq(firms.id, x.firm.id));
          await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdRecSync', entityType: 'recurring_invoice', entityId: r!.id, data: { client: x.firm.name, net: x.net } });
        }
        n++;
      }
    });
    done();
    revalidatePath('/periodicni');
    return { ok: n ? `Ажурирани ${n} периодични фактури од договорите (во ${firm.name}).` : 'Сите договори се веќе внесени.' };
  } catch (e) { return err(e); }
}
