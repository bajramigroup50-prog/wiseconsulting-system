/**
 * Legacy-parity services of the "other" industry views (gradba, tura, termini, kartoni, periodicni, moduli):
 * Excel imports of the master data, project / diary photos and note attachments (`file_links`), guarded client notes,
 * the module tri-state and activity profile (legacy `VIEWS.moduli` 10231 / 10531), recurring-invoice bulk creation,
 * the standard item and the accounting-contract sync (legacy `rbSave` 13526, `recDefItem` 13579, `kdRecSync` 13560).
 *
 * Every mutation checks the firm's module (`loadIndustryFirm(tx, firmId, MOD)`) and writes `audit_log` in the same
 * transaction.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  accFeeStatus, CLIENT_IMPORT, CONS_BOQ_IMPORT, CONS_PROJECT_IMPORT, effectiveModules, importArrKind, importArrStatus, importEvery, importRecDay, importVat,
  legalFormForEntity, moduleOverrides, normalizeMods, oxBool, oxDate, oxNum, oxRows, PROFILES, REC_IMPORT, recBulkPlan, TRAVEL_ARR_IMPORT, firmProfiles,
  type EntityKind, type OxCell,
} from '@wise/core/industry';
import { firstLastWorkingDay, recNext, type RecEvery } from '@wise/core/office';
import { audit, type Tx } from '../audit';
import {
  constructionDiary, constructionProjects, fileLinks, files, firmDocs, firms, items, partners, recurringInvoices, serviceContracts, travelArrangements, type Firm,
} from '../schema/index';
import { saveProject } from './construction';
import { saveArrangement } from './travel';
import { IndustryError, findOrCreatePartner, loadIndustryFirm, type IndActor } from './context';

const fail = (m: string): never => { throw new IndustryError(m); };
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export interface OxImportResult { added: number; updated: number; errors: string[] }
const done = (r: OxImportResult) => r;

/** Partner of an import row: by ЕДБ, then by exact name (case-insensitive), created when missing. */
async function importPartner(tx: Tx, firmId: string, name: string, edb: string): Promise<string> {
  const e = dig(edb);
  if (e) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), sql`regexp_replace(coalesce(${partners.edb}, ''), '\\D', '', 'g') = ${e}`)).limit(1);
    if (p) return p.id;
  }
  const id = await findOrCreatePartner(tx, firmId, name);
  if (e) await tx.update(partners).set({ edb: e }).where(and(eq(partners.id, id), sql`coalesce(${partners.edb}, '') = ''`));
  return id;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ================================================================== files */

/** Link uploaded files (ids from `UploadField`) of this firm to an entity. */
export async function linkFirmFiles(tx: Tx, a: IndActor, entityType: string, entityId: string, ids: readonly string[], role = 'photo'): Promise<number> {
  const L = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!L.length) return 0;
  const F = await tx.select({ id: files.id }).from(files).where(and(inArray(files.id, L), eq(files.firmId, a.firmId)));
  if (F.length !== L.length) fail('Датотеката не е од оваа фирма.');
  for (const f of F) await tx.insert(fileLinks).values({ fileId: f.id, entityType, entityId, role }).onConflictDoNothing();
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fileLink', entityType, entityId, data: { n: F.length, role } });
  return F.length;
}

export async function unlinkFirmFile(tx: Tx, a: IndActor, entityType: string, entityId: string, fileId: string): Promise<void> {
  const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, fileId), eq(files.firmId, a.firmId))).limit(1);
  if (!f) fail('Датотеката не постои.');
  await tx.delete(fileLinks).where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.entityType, entityType), eq(fileLinks.entityId, entityId)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fileUnlink', entityType, entityId, data: { fileId } });
}

/** Files linked to entities (for the photo strips / attachment chips). */
export async function entityFiles(tx: Tx, entityType: string, ids: readonly string[]) {
  if (!ids.length) return [] as { entityId: string; id: string; name: string; mime: string }[];
  return tx.select({ entityId: fileLinks.entityId, id: files.id, name: files.name, mime: files.mime }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, entityType), inArray(fileLinks.entityId, [...ids])));
}

/* ================================================================== construction */

/** Excel import of projects (legacy master data; upsert by code — the BOQ of an existing project is kept). */
export async function importProjects(tx: Tx, a: IndActor, rows: OxCell[][]): Promise<OxImportResult> {
  await loadIndustryFirm(tx, a.firmId, 'cons');
  const M = oxRows(rows, CONS_PROJECT_IMPORT);
  const r: OxImportResult = { added: 0, updated: 0, errors: M.errors };
  for (const x of M.rows) {
    try {
      const [prev] = x.code ? await tx.select().from(constructionProjects).where(and(eq(constructionProjects.firmId, a.firmId), eq(constructionProjects.code, x.code))).limit(1) : [];
      const investorId = await importPartner(tx, a.firmId, x.investor!, x.edb!);
      await saveProject(tx, a, {
        id: prev?.id ?? null, code: x.code || null, name: x.name!, site: x.site || prev?.site, city: x.city || prev?.city, investorId, cno: x.cno || prev?.cno,
        cdate: oxDate(x.cdate) || prev?.cdate, start: oxDate(x.start) || prev?.start, end: oxDate(x.end) || prev?.end, nadzor: x.nadzor || prev?.nadzor,
        eng: x.eng || prev?.eng, art32: x.art32 ? oxBool(x.art32) : !!prev?.art32,
      });
      if (prev) r.updated++; else r.added++;
    } catch (e) { r.errors.push(`Ред ${x._row}: ${errMsg(e)}`); }
  }
  return done(r);
}

/** Excel import of BOQ lines into a project (legacy `boqPaste` from a file): appended after the existing lines. */
export async function importBoq(tx: Tx, a: IndActor, projectId: string, rows: OxCell[][]): Promise<OxImportResult> {
  await loadIndustryFirm(tx, a.firmId, 'cons');
  const [P] = await tx.select().from(constructionProjects).where(and(eq(constructionProjects.id, projectId), eq(constructionProjects.firmId, a.firmId))).limit(1);
  if (!P) fail('Објектот не постои.');
  const M = oxRows(rows, CONS_BOQ_IMPORT);
  const add = M.rows.map((x, i) => ({ pos: x.pos || String(P!.boq.length + i + 1), desc: x.desc!, unit: x.unit ?? '', qty: oxNum(x.qty), price: oxNum(x.price) }));
  if (!add.length) return { added: 0, updated: 0, errors: M.errors.length ? M.errors : ['Нема позиции во датотеката.'] };
  await saveProject(tx, a, { ...P!, investorId: P!.investorId, boq: [...P!.boq, ...add] });
  return { added: add.length, updated: 0, errors: M.errors };
}

/** Project photos (legacy `cp_ph`) and diary photos (legacy `cd_ph`) are `file_links`. */
export async function addConstructionPhotos(tx: Tx, a: IndActor, kind: 'project' | 'diary', id: string, fileIds: readonly string[]): Promise<number> {
  await loadIndustryFirm(tx, a.firmId, 'cons');
  const tbl = kind === 'project' ? constructionProjects : constructionDiary;
  const [x] = await tx.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.id, id), eq(tbl.firmId, a.firmId))).limit(1);
  if (!x) fail('Записот не постои.');
  return linkFirmFiles(tx, a, kind === 'project' ? 'construction_project' : 'construction_diary', id, fileIds);
}

/* ================================================================== travel */

/** Excel import of arrangements (upsert by code; costs and bookings stay). */
export async function importArrangements(tx: Tx, a: IndActor, rows: OxCell[][]): Promise<OxImportResult> {
  await loadIndustryFirm(tx, a.firmId, 'tour');
  const M = oxRows(rows, TRAVEL_ARR_IMPORT);
  const r: OxImportResult = { added: 0, updated: 0, errors: M.errors };
  const nz = (v?: string) => (v ? oxNum(v) : null);
  for (const x of M.rows) {
    try {
      const [prev] = x.code ? await tx.select().from(travelArrangements).where(and(eq(travelArrangements.firmId, a.firmId), eq(travelArrangements.code, x.code))).limit(1) : [];
      await saveArrangement(tx, a, {
        id: prev?.id ?? null, code: x.code || null, name: x.name!, dest: x.dest || prev?.dest, from: oxDate(x.from) || prev?.from || null, to: oxDate(x.to) || prev?.to || null,
        kind: x.kind ? importArrKind(x.kind) : prev?.kind ?? 'own', seats: nz(x.seats) ?? prev?.seats ?? null, price: nz(x.price) ?? (prev?.price != null ? Number(prev.price) : null),
        priceCh: nz(x.priceCh) ?? (prev?.priceCh != null ? Number(prev.priceCh) : null), comm: nz(x.comm) ?? (prev?.comm != null ? Number(prev.comm) : null),
        status: x.status ? importArrStatus(x.status) : prev?.status ?? 'open', prog: x.prog || prev?.prog, incl: x.incl || prev?.incl, excl: x.excl || prev?.excl,
        countries: prev?.countries ?? [],
      });
      if (prev) r.updated++; else r.added++;
    } catch (e) { r.errors.push(`Ред ${x._row}: ${errMsg(e)}`); }
  }
  return done(r);
}

/* ================================================================== client cards / appointments */

export interface ClientNoteInput { id?: string | null; partnerId: string; date: string; title: string; text: string; conf: boolean; by?: string | null; fileIds?: readonly string[] }

/** Legacy `kcSave`: a note on the client card (module `appt`), with attachments (legacy `kn_f`). */
export async function saveClientNote(tx: Tx, a: IndActor, x: ClientNoteInput): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'appt');
  if (!x.text.trim() && !x.title.trim()) fail('Внесете текст.');
  const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, x.partnerId), eq(partners.firmId, a.firmId))).limit(1);
  if (!p) fail('Клиентот не постои.');
  const data = { partnerId: x.partnerId, title: x.title.trim(), text: x.text, conf: x.conf, by: x.by ?? null };
  let id = x.id ?? '';
  if (id) {
    const [u] = await tx.update(firmDocs).set({ date: x.date, data }).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, 'cnote'))).returning({ id: firmDocs.id });
    if (!u) fail('Белешката не постои.');
  } else id = (await tx.insert(firmDocs).values({ firmId: a.firmId, type: 'cnote', date: x.date, data, createdBy: a.userId }).returning({ id: firmDocs.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kcSave', entityType: 'firm_doc', entityId: id, data: { partner: x.partnerId } });
  if (x.fileIds?.length) await linkFirmFiles(tx, a, 'client_note', id, x.fileIds, 'attachment');
  return id;
}

export async function deleteClientNote(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, 'appt');
  const [d] = await tx.delete(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, 'cnote'))).returning({ id: firmDocs.id });
  if (!d) fail('Белешката не постои.');
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, 'client_note'), eq(fileLinks.entityId, id)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kcDel', entityType: 'firm_doc', entityId: id });
}

/** Excel import of clients / patients (partners): matched by ЕДБ or name, empty contact fields filled in. */
export async function importClients(tx: Tx, a: IndActor, rows: OxCell[][]): Promise<OxImportResult> {
  await loadIndustryFirm(tx, a.firmId, 'appt');
  const M = oxRows(rows, CLIENT_IMPORT);
  const r: OxImportResult = { added: 0, updated: 0, errors: M.errors };
  for (const x of M.rows) {
    try {
      const e = dig(x.edb);
      const [ex] = await tx.select().from(partners).where(and(eq(partners.firmId, a.firmId), e ? sql`regexp_replace(coalesce(${partners.edb}, ''), '\\D', '', 'g') = ${e}` : sql`lower(trim(${partners.name})) = ${x.name!.toLowerCase()}`)).limit(1);
      const data = { ...(ex?.data ?? {}), ...(oxDate(x.birth) ? { birth: oxDate(x.birth) } : {}), ...(x.note ? { note: x.note } : {}) };
      if (ex) {
        await tx.update(partners).set({
          phone: ex.phone || x.phone || null, email: ex.email || x.email || null, address: ex.address || x.address || null, city: ex.city || x.city || null, edb: ex.edb || e || null, data,
        }).where(eq(partners.id, ex.id));
        r.updated++;
      } else {
        await tx.insert(partners).values({ firmId: a.firmId, name: x.name!, phone: x.phone || null, email: x.email || null, address: x.address || null, city: x.city || null, edb: e || null, vatRegistered: false, data });
        r.added++;
      }
    } catch (err) { r.errors.push(`Ред ${x._row}: ${errMsg(err)}`); }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kcImport', entityType: 'partner', data: { added: r.added, updated: r.updated } });
  return r;
}

/* ================================================================== recurring invoices */

/** Periodic invoices are the `recur` module (legacy MODS 10208): refuse when it is off. */
export const assertRecurModule = (tx: Tx, firmId: string) => loadIndustryFirm(tx, firmId, 'recur');

type RecItemRow = { itemId?: string | null; name: string; qty: number; price: number; vat: number; unit?: string };

/**
 * Excel import of recurring invoices: one definition per partner + period + day + next date + description; every
 * row adds an item line.
 */
export async function importRecurring(tx: Tx, a: IndActor, rows: OxCell[][], today: string): Promise<OxImportResult> {
  await assertRecurModule(tx, a.firmId);
  const M = oxRows(rows, REC_IMPORT);
  const r: OxImportResult = { added: 0, updated: 0, errors: M.errors };
  const G = new Map<string, { row: string; partner: string; edb: string; every: RecEvery; day: string; next: string; end: string; due: number; note: string; mail: boolean; items: RecItemRow[] }>();
  const IT = await tx.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.firmId, a.firmId));
  for (const x of M.rows) {
    const every = importEvery(x.every), day = importRecDay(x.day);
    const next = oxDate(x.next) || (day === 'L' ? firstLastWorkingDay(today) : recNext(today.slice(0, 8) + '01', 'month', Number(day)));
    const key = [x.partner, dig(x.edb), every, day, next, x.note].join('|');
    const g = G.get(key) ?? { row: x._row, partner: x.partner!, edb: x.edb!, every, day, next, end: oxDate(x.end), due: x.dueDays ? Math.max(0, Math.round(oxNum(x.dueDays))) : 15, note: x.note!, mail: oxBool(x.mail), items: [] };
    const it = IT.find((i) => i.name.toLowerCase() === x.item!.toLowerCase());
    const price = oxNum(x.price);
    if (!(price > 0)) { r.errors.push(`Ред ${x._row}: цената мора да е поголема од 0.`); continue; }
    g.items.push({ itemId: it?.id ?? null, name: it?.name ?? x.item!, qty: oxNum(x.qty) || 1, price, vat: importVat(x.vat), ...(it?.unit ? { unit: it.unit } : {}) });
    G.set(key, g);
  }
  for (const g of G.values()) {
    if (!g.items.length) continue;
    try {
      const partnerId = await importPartner(tx, a.firmId, g.partner, g.edb);
      const [d] = await tx.insert(recurringInvoices).values({
        firmId: a.firmId, partnerId, every: g.every, day: g.day, next: g.next, end: g.end || null, dueDays: g.due, items: g.items, note: g.note || null, active: true, mail: g.mail, createdBy: a.userId,
      }).returning({ id: recurringInvoices.id });
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'recImport', entityType: 'recurring_invoice', entityId: d!.id, data: { next: g.next, items: g.items.length } });
      r.added++;
    } catch (e) { r.errors.push(`Ред ${g.row}: ${errMsg(e)}`); }
  }
  return r;
}

export interface RecBulkInput { partnerIds: string[]; name: string; price: number; prices: Record<string, number>; rate: number; day: string; next: string; dueDays: number; note: string; mail: boolean }

/** Legacy `rbSave`: one monthly definition per chosen partner (own price or the common one). */
export async function recBulkCreate(tx: Tx, a: IndActor, x: RecBulkInput): Promise<number> {
  await assertRecurModule(tx, a.firmId);
  if (!x.partnerIds.length) fail('Изберете комитенти.');
  const name = x.name.trim() || fail('Внесете услуга.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.next)) fail('Внесете дата на првата фактура.');
  const plan = recBulkPlan(x.partnerIds, x.price, x.prices);
  if (plan.missing.length) fail(`Нема цена за ${plan.missing.length} комитенти – внесете цена за сите или во редот.`);
  const P = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, a.firmId), inArray(partners.id, x.partnerIds)));
  if (P.length !== new Set(x.partnerIds).size) fail('Комитентот не е од оваа фирма.');
  const [it] = await tx.select({ id: items.id, unit: items.unit }).from(items).where(and(eq(items.firmId, a.firmId), sql`lower(${items.name}) = ${name.toLowerCase()}`)).limit(1);
  const day = x.day === 'L' ? 'L' : String(Math.min(31, Math.max(1, Math.round(Number(x.day)) || 1)));
  const rate = [18, 10, 5, 0].includes(x.rate) ? x.rate : 18;
  for (const p of plan.rows) {
    const [d] = await tx.insert(recurringInvoices).values({
      firmId: a.firmId, partnerId: p.id, every: 'month', day, next: x.next, dueDays: Math.max(0, Math.round(x.dueDays) || 0), note: x.note.trim() || null, active: true, mail: x.mail, createdBy: a.userId,
      items: [{ itemId: it?.id ?? null, name, qty: 1, price: p.price, vat: rate, ...(it?.unit ? { unit: it.unit } : {}) }],
    }).returning({ id: recurringInvoices.id });
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rbSave', entityType: 'recurring_invoice', entityId: d!.id, data: { price: p.price } });
  }
  return plan.rows.length;
}

/** Legacy `recItem` (13585): the standard item that fills every new definition. */
export async function saveRecDefaultItem(tx: Tx, a: IndActor, itemId: string | null): Promise<void> {
  await assertRecurModule(tx, a.firmId);
  if (itemId) {
    const [it] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, itemId), eq(items.firmId, a.firmId))).limit(1);
    if (!it) fail('Артиклот не постои.');
  }
  await tx.update(firms).set({ settings: sql`coalesce(${firms.settings}, '{}'::jsonb) || jsonb_build_object('recItem', ${itemId ?? ''}::text)` }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'recItem', entityType: 'firm', entityId: a.firmId, data: { itemId } });
}

/** Legacy `offFirmSet`: this firm is the office's own firm (accounting fees are invoiced from it). */
export async function setOfficeFirm(tx: Tx, a: IndActor): Promise<void> {
  await tx.update(firms).set({ settings: sql`${firms.settings} || '{"officeFirm": false}'::jsonb` }).where(and(ne(firms.id, a.firmId), sql`(${firms.settings}->>'officeFirm')::boolean is true`));
  await tx.update(firms).set({ settings: sql`coalesce(${firms.settings}, '{}'::jsonb) || '{"officeFirm": true}'::jsonb` }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'offFirmSet', entityType: 'firm', entityId: a.firmId });
}

const ACC_ITEM = /сметководствени\s+услуги/i;

/**
 * Legacy `kdRecPlan`: every other firm with a monthly accounting fee (firm setting `accFee`, net — or the fee of its
 * active service contract, gross) → its recurring invoice in the office firm. `firmIds` limits it to the firms the
 * user may see.
 */
export async function accFeePlan(tx: Tx, office: Firm, firmIds: readonly string[] | null) {
  const F = (await tx.select().from(firms).where(and(eq(firms.active, true), ne(firms.id, office.id)))).filter((f) => !firmIds || firmIds.includes(f.id));
  const C = F.length ? await tx.select().from(serviceContracts).where(and(inArray(serviceContracts.firmId, F.map((f) => f.id)), ne(serviceContracts.status, 'ended'))) : [];
  const P = await tx.select().from(partners).where(eq(partners.firmId, office.id));
  const R0 = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.firmId, office.id));
  const rate = office.vatRegistered ? 18 : 0;
  const out: { firm: Firm; net: number; end: string; start: string; partnerId: string | null; recId: string | null; st: ReturnType<typeof accFeeStatus> }[] = [];
  for (const f of F) {
    const s = (f.settings ?? {}) as { accFee?: unknown; accFrom?: string };
    const c = C.filter((x) => x.firmId === f.id).sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
    const net = Number(s.accFee) > 0 ? Math.round(Number(s.accFee) * 100) / 100 : c && Number(c.fee) > 0 ? Math.round((Number(c.fee) / (1 + rate / 100)) * 100) / 100 : 0;
    if (!(net > 0)) continue;
    const p = P.find((x) => (dig(f.edb) && dig(x.edb) === dig(f.edb)) || (dig(f.embs) && dig(x.embs) === dig(f.embs)));
    const ex = p ? R0.find((r) => r.partnerId === p.id && (ACC_ITEM.test(r.items[0]?.name ?? '') || /Според договор|сметковод/i.test(r.note ?? ''))) : undefined;
    const end = c?.end ?? '';
    out.push({ firm: f, net, end, start: s.accFrom || c?.start || '', partnerId: p?.id ?? null, recId: ex?.id ?? null, st: accFeeStatus(net, end, ex ? { price: ex.items[0]?.price ?? 0, end: ex.end } : null) });
  }
  return out.sort((x, y) => x.firm.name.localeCompare(y.firm.name, 'mk'));
}

/** Legacy `kdRecSync`: create / update the recurring invoices of the plan (last working day of the month). */
export async function accFeeSync(tx: Tx, a: IndActor, office: Firm, firmIds: readonly string[] | null, today: string): Promise<number> {
  await assertRecurModule(tx, a.firmId);
  if (office.id !== a.firmId || !(office.settings as { officeFirm?: boolean }).officeFirm) fail('Ова не е фирмата на канцеларијата.');
  const plan = await accFeePlan(tx, office, firmIds);
  const recItem = String((office.settings as { recItem?: string }).recItem ?? '');
  const IT = await tx.select({ id: items.id, name: items.name, unit: items.unit, vat: items.vatRate }).from(items).where(eq(items.firmId, office.id));
  const it = IT.find((i) => i.id === recItem) ?? IT.find((i) => ACC_ITEM.test(i.name));
  const rate = office.vatRegistered ? 18 : 0;
  let k = 0;
  for (const x of plan) {
    if (x.st === 'ок') continue;
    const pid = x.partnerId ?? (await tx.insert(partners).values({
      firmId: office.id, name: x.firm.name, edb: dig(x.firm.edb) || null, embs: dig(x.firm.embs) || null, address: x.firm.address ?? null, city: x.firm.city ?? null,
      email: x.firm.email ?? null, phone: x.firm.phone ?? null, vatRegistered: x.firm.vatRegistered,
    }).returning({ id: partners.id }))[0]!.id;
    const line = { itemId: it?.id ?? null, name: it?.name ?? 'Сметководствени услуги за месец', qty: 1, price: x.net, vat: it ? it.vat : rate, ...(it?.unit ? { unit: it.unit } : {}) };
    if (x.recId) {
      const [ex] = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.id, x.recId)).limit(1);
      await tx.update(recurringInvoices).set({ items: [{ ...(ex!.items[0] ?? {}), ...line, name: ex!.items[0]?.name || line.name }, ...ex!.items.slice(1)], end: x.end || ex!.end }).where(eq(recurringInvoices.id, x.recId));
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kdRecSync', entityType: 'recurring_invoice', entityId: x.recId, data: { firm: x.firm.id, net: x.net } });
    } else {
      const s = x.start && x.start > today ? x.start : today;
      const first = firstLastWorkingDay(s);
      const [d] = await tx.insert(recurringInvoices).values({
        firmId: office.id, partnerId: pid, every: 'month', day: 'L', next: first, end: x.end || null, dueDays: 15, items: [line], note: 'Според договор', active: true, mail: false, createdBy: a.userId,
      }).returning({ id: recurringInvoices.id });
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kdRecSync', entityType: 'recurring_invoice', entityId: d!.id, data: { firm: x.firm.id, net: x.net } });
    }
    k++;
  }
  return k;
}

/* ================================================================== modules and entity */

interface KlSettings { prof?: string[] | null; profSet?: boolean; [k: string]: unknown }

/** The module screen's state of a firm: profiles (manual or from the NKD code) and the tri-state overrides. */
export function firmModuleState(f: Pick<Firm, 'activity' | 'mods' | 'settings'>) {
  const s = (f.settings ?? {}) as { kl?: KlSettings; modsOv?: Record<string, boolean> };
  const profiles = firmProfiles(f.activity, s.kl);
  return { profiles, ov: moduleOverrides(f.mods ?? [], profiles, s.modsOv ?? null), auto: !(Array.isArray(s.kl?.prof) && (s.kl!.profSet || s.kl!.prof!.length)) };
}

/**
 * Legacy `data-mpf` / `data-mod` / `modAutoProf`: save the activity profiles (`null` = back to automatic from the NKD
 * code) and the module settings; the enabled list `firms.mods` is recomputed (legacy `modOnF`).
 */
export async function saveModuleSetup(tx: Tx, a: IndActor, o: { profiles?: string[] | null; ov?: Record<string, boolean> }): Promise<string[]> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!f) fail('Фирмата не постои.');
  const st = firmModuleState(f!);
  const settings = { ...(f!.settings ?? {}) } as Record<string, unknown> & { kl?: KlSettings };
  if (o.profiles !== undefined) {
    const kl = { ...(settings.kl ?? {}) };
    if (o.profiles === null) { kl.prof = null; kl.profSet = false; } else { kl.prof = o.profiles.filter((p) => PROFILES.some(([k]) => k === p)); kl.profSet = true; }
    settings.kl = kl;
  }
  const ov = o.ov ?? st.ov;
  settings.modsOv = ov;
  const profiles = firmProfiles(f!.activity, settings.kl);
  const mods = normalizeMods(effectiveModules(profiles, ov));
  await tx.update(firms).set({ settings, mods }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'modSave', entityType: 'firm', entityId: a.firmId, data: { before: f!.mods, after: mods, profiles, ov } });
  return mods;
}

/** Legacy 10531 radio „Вид на субјект“: sets the legal form (and clears an explicit `settings.ent`). */
export async function saveFirmEntity(tx: Tx, a: IndActor, ent: EntityKind): Promise<string> {
  if (!['co', 'tp', 'sd', 'npo'].includes(ent)) fail('Изберете вид на субјект.');
  const [f] = await tx.select({ lf: firms.legalForm, settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  const lf = legalFormForEntity(f?.lf, ent);
  const settings = { ...((f?.settings ?? {}) as Record<string, unknown>) };
  delete settings.ent;
  await tx.update(firms).set({ legalForm: lf, settings }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'entSave', entityType: 'firm', entityId: a.firmId, data: { ent, lf, before: f?.lf ?? null } });
  return lf;
}
