'use server';
/** ISO квалитет – server actions (office-wide, `office` permission, every change audited in @wise/db). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { isoKind, type IsoKind, type IsoStatus } from '@wise/core/office/iso';
import { ISO_ANNEX_A, SOA_STATUS, type SoaStatus } from '@wise/core/office/iso-soa';
import { ackString, policiesInForce } from '@wise/core/office/iso-staff';
import { ISO_REGISTRY } from '@wise/core/office/iso-registry';
import { addIsoStarters, confirmSoaAll, deleteIsoRecord, employees, getOfficeProfile, IsoError, isoRecords, OFFICE_FILE_ENTITY, saveIsoRecord, saveIsoStaff, saveSoa, setIsoStatus, signIsoRecord } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, linkFiles, officeError, officeGlobal, today } from '@/lib/office';
import { loadIsoRows, officeFirm } from './iso-data';

const PATH = '/iso';
const err = (e: unknown): ActionState => (e instanceof IsoError ? { error: e.message } : officeError(e));

export async function isoSave(_p: ActionState, f: FormData): Promise<ActionState> {
  let kind = '';
  try {
    const u = await officeGlobal('office');
    kind = fv(f, 'kind') ?? '';
    const def = isoKind(kind);
    if (!def) return { error: 'Непознат регистар.' };
    const id = fv(f, 'id');
    if (id && !isUuid(id)) return { error: 'Неважечки запис.' };
    const data = Object.fromEntries(def.fields.map((x) => {
      const v = fv(f, 'd_' + x.k);
      return [x.k, x.t === 'date' ? fdate(f, 'd_' + x.k) : x.t === 'dt' ? (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null) : x.t === 'ref' ? (isUuid(v) ? v : null) : v];
    }));
    // the client of a complaint / incident: only the firm being worked in (or the one the record already has)
    const fid = isUuid(fv(f, 'firmId')) ? fv(f, 'firmId')! : null;
    if (fid) {
      const cur = await currentFirm(u);
      const [old] = id ? await db().select({ firmId: isoRecords.firmId }).from(isoRecords).where(eq(isoRecords.id, id)).limit(1) : [];
      if (fid !== cur?.id && fid !== old?.firmId) return { error: 'Може да се избере само фирмата во која работите.' };
    }
    await db().transaction(async (tx) => {
      const rid = await saveIsoRecord(tx, {
        id, kind, title: fv(f, 'title') ?? '', status: fv(f, 'status'), due: fdate(f, 'due'),
        firmId: fid, ownerId: isUuid(fv(f, 'ownerId')) ? fv(f, 'ownerId') : null, data,
      }, u.id, today());
      // the evidence (scan, certificate, list…) – office-wide files
      await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.iso, rid);
    });
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?k=${kind}`);
}

export async function isoStatus(id: string, status: IsoStatus): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    await db().transaction((tx) => setIsoStatus(tx, id, status, u.id));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: status === 'done' ? 'Затворено.' : 'Отворено повторно.' };
}

export async function isoDelete(id: string): Promise<ActionState> {
  try {
    const u = await officeGlobal('del');
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    await db().transaction((tx) => deleteIsoRecord(tx, id, u.id));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Избришано.' };
}

const STARTER: Partial<Record<IsoKind, [string, string]>> = {
  policy: ['документи – прегледајте ги, дополнете и одобрете ги', 'Основните документи веќе постојат.'],
  processing: ['обработки – прегледајте ги и дополнете ги', 'Основните обработки веќе постојат.'],
  bcp: ['сценарија – внесете одговорно лице, замена и контакти', 'Основните сценарија веќе постојат.'],
  supplier: ['добавувачи – оценете ги', 'Основните добавувачи веќе постојат.'],
  auditplan: ['планирани проверки – внесете проверувач', 'Програмата за годинава веќе постои.'],
};

/** The starting records of a register (documents, processing activities, continuity scenarios) not there yet. */
export async function isoStarter(kind: IsoKind = 'policy'): Promise<ActionState> {
  const m = STARTER[kind];
  if (!m) return { error: 'Непознат регистар.' };
  let n = 0;
  try {
    const u = await officeGlobal('office');
    const O = await getOfficeProfile(db());
    n = await db().transaction((tx) => addIsoStarters(tx, kind, O.name ?? '', u.id, today()));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: n ? `Додадени ${n} ${m[0]}.` : m[1] };
}

/** „✍ Потврди“ – the responsible person (or the manager) signs the record off. */
export async function isoSign(id: string): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    await db().transaction((tx) => signIsoRecord(tx, id, { id: u.id, name: u.name, admin: u.role === 'admin' }));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Потврдено.' };
}

/** One control of the Statement of Applicability. */
export async function soaSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    const id = fv(f, 'ctrl') ?? '';
    if (!ISO_ANNEX_A.some((c) => c.id === id)) return { error: 'Непозната контрола.' };
    const st = fv(f, 'status') ?? '';
    await db().transaction((tx) => saveSoa(tx, id, {
      applicable: fv(f, 'applicable') !== 'no', justification: fv(f, 'justification') ?? '', evidence: fv(f, 'evidence') ?? '',
      status: (SOA_STATUS as readonly string[]).includes(st) ? (st as SoaStatus) : 'планирано',
    }, u.id, today()));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?k=soa#${fv(f, 'ctrl') ?? ''}`);
}

export async function soaConfirmAll(): Promise<ActionState> {
  let n = 0;
  try {
    const u = await officeGlobal('office');
    n = await db().transaction((tx) => confirmSoaAll(tx, u.id, today()));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: n ? `Потврдени ${n} контроли според предлогот – прегледајте ги оние со „делумно“ / „планирано“.` : 'Сите контроли се веќе потврдени.' };
}

async function officeEmployee(id: string) {
  if (!isUuid(id)) throw new IsoError('Неважечки вработен.');
  const office = await officeFirm();
  const [e] = office ? await db().select({ id: employees.id, name: employees.name, firmId: employees.firmId }).from(employees).where(eq(employees.id, id)).limit(1) : [];
  if (!e || e.firmId !== office!.id) throw new IsoError('Вработениот не е во фирмата на канцеларијата.');
  return e;
}

/**
 * The staff row of one colleague: „✓ Потпишан“ (date + the signed scan), „✓ Ги прифати политиките“ (the current
 * versions are recorded), joining / leaving (assets, access) – `op` says which part the form sends.
 */
export async function staffSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    const e = await officeEmployee(fv(f, 'employeeId') ?? '');
    const op = fv(f, 'op');
    const td = today();
    let patch: Record<string, unknown>;
    if (op === 'contract') {
      patch = { contractOn: fdate(f, 'contractOn') ?? td };
      if (!f.getAll('fileIds').length && !fv(f, 'hasFile')) return { error: 'Прикачете го скенираниот потпишан договор.' };
    } else if (op === 'ack') {
      const P = policiesInForce(await loadIsoRows());
      if (!P.length) return { error: 'Нема документи во сила (одобрени, со ознака).' };
      patch = { ackOn: fdate(f, 'ackOn') ?? td, ackDocs: ackString(P) };
    } else if (op === 'access') {
      patch = { onboardOn: fdate(f, 'onboardOn'), assetsOut: fv(f, 'assetsOut'), offboardOn: fdate(f, 'offboardOn'), assetsBack: fv(f, 'assetsBack'), accessOffOn: fdate(f, 'accessOffOn') };
    } else return { error: 'Непознато дејство.' };
    await db().transaction(async (tx) => {
      const rid = await saveIsoStaff(tx, e, patch, u.id, td);
      await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.iso, rid);
    });
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Зачувано.' };
}

/** „✓ Ажурирано“ on a row of the master register that the program does not keep itself: date, note, owner, file. */
export async function evidSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    const id = fv(f, 'row') ?? '';
    if (!ISO_REGISTRY.some((r) => r.id === id)) return { error: 'Непозната евиденција.' };
    const old = (await loadIsoRows()).find((r) => r.kind === 'evid' && r.title === id);
    await db().transaction(async (tx) => {
      const rid = await saveIsoRecord(tx, {
        id: old?.id ?? null, kind: 'evid', title: id, status: 'progress', ownerId: isUuid(fv(f, 'ownerId')) ? fv(f, 'ownerId') : old?.ownerId ?? null,
        data: { lastOn: fdate(f, 'lastOn') ?? today(), note: fv(f, 'note') },
      }, u.id, today());
      await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.iso, rid);
    });
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Зачувано.' };
}
