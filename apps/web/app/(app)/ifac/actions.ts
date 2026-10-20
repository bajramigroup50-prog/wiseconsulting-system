'use server';
/**
 * 🤝 IFAC – server actions: the ISRS 4410 letter of the current firm (save → PDF in the dossier, signed, deleted), the
 * ISQM 1 checklist, and the IESBA declaration of the signed-in employee. Firm work needs `office` on the firm; every
 * change audited in @wise/db.
 */
import { revalidatePath } from 'next/cache';
import { KD_SVC } from '@wise/core/firms/kdog';
import { QC_ACCEPT, QC_REVIEW } from '@wise/core/office/ifac';
import { IFAC_FILE_ENTITY, sqmComp } from '@wise/core/office/ifac-sqm';
import {
  addSqmStarter, deleteIsosIns, deleteLetter, IfacError, OFFICE_FILE_ENTITY, saveIsosCtl, saveIsosIns, saveIsosList, saveIsosQ, saveLetter, saveQc, saveSqm, saveStaff, signEthics, signLetter,
  syncIsosDeadlines, type Tx,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { allowedFirms, fdate, fv, isUuid, linkFiles, officeAction, officeError, officeGlobal, today } from '@/lib/office';
import { requireUser } from '@/lib/auth';
import { isosListRows, letterHtml } from './lib';
import { loadProvider, pdfTo } from '../kdogovori/lib';

const err = (e: unknown): ActionState => (e instanceof IfacError ? { error: e.message } : officeError(e));
const done = () => { revalidatePath('/ifac'); revalidatePath('/dosie'); revalidatePath('/zsProc'); };
/** The PDF copy for the dossier (job queue): the letter is already saved, so a queue failure is a warning, not an error. */
const toDossier = (html: Promise<string>, title: string, firmId: string, userId: string, dossierId: string) =>
  html.then((h) => pdfTo(h, title, firmId, userId, { entityType: OFFICE_FILE_ENTITY.dossier, entityId: dossierId })).then(() => '', (e: unknown) => {
    console.error('[ifac] dossier PDF', e);
    return ' ⚠ PDF примерокот за досието не е создаден – испечатете го со „🖨 Печати“.';
  });
const yearOf = async (f: FormData) => { const y = Number(fv(f, 'year')); return y > 2000 && y < 2100 ? y : currentYear(); };

export async function letterSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const { O } = await loadProvider(u);
    if (!O.name) return { error: 'Прво одредете ја фирмата на канцеларијата во „Договор за сметководствени услуги“.' };
    const year = await yearOf(f);
    const input = {
      year, date: fdate(f, 'date'), place: fv(f, 'place'), framework: fv(f, 'framework'), rep: fv(f, 'rep'), repRole: fv(f, 'repRole'),
      svc: f.getAll('svc').map(String).filter((s) => KD_SVC.some((x) => x[0] === s)), feeMode: fv(f, 'feeMode'), fee: fv(f, 'fee'), feeYear: fv(f, 'feeYear'), feeHour: fv(f, 'feeHour'),
      docDay: fv(f, 'docDay'), payDay: fv(f, 'payDay'), contractNo: fv(f, 'contractNo'), note: fv(f, 'note'),
    };
    if (!input.svc.length) return { error: 'Изберете барем една услуга.' };
    const r = await db().transaction((tx) => saveLetter(tx, firm.id, input as never, { userId: u.id, today: today(), office: O.name ?? '', demo: isDemoUser(u) }));
    const w = await toDossier(letterHtml(r.letter, firm, O), `Pismo_angazman_${r.letter.number}_nacrt`, firm.id, u.id, r.dossierId);
    done();
    return { ok: `Писмото ${r.letter.number} е зачувано (и примерок во досието). Испечатете го, потпишете го со клиентот и означете „✍ Потпишано“.${w}` };
  } catch (e) { return err(e); }
}

export async function letterSign(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const { O } = await loadProvider(u);
    const year = await yearOf(f);
    const at = fdate(f, 'at');
    if (!at) return { error: 'Внесете го датумот на потпишување.' };
    const scan = f.getAll('fileIds').map(String).find(isUuid) ?? null;
    const r = await db().transaction((tx) => signLetter(tx, firm.id, year, { at, name: fv(f, 'name') ?? undefined, by: u.name, scan }, { userId: u.id, office: O.name ?? '' }));
    const w = await toDossier(letterHtml(r.letter, firm, O), `Pismo_angazman_${r.letter.number}`, firm.id, u.id, r.dossierId);
    done();
    return { ok: `✅ Писмото е потпишано и архивирано во „Документи на фирмата“.${w}` };
  } catch (e) { return err(e); }
}

export async function letterDelete(year: number): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('del');
    await db().transaction((tx) => deleteLetter(tx, firm.id, year, u.id));
    done();
    return { ok: 'Избришано.' };
  } catch (e) { return err(e); }
}


export async function qcSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const year = await yearOf(f);
    const tick = (L: readonly { k: string }[], p: string) => Object.fromEntries(L.filter((x) => f.get(p + x.k) === 'on').map((x) => [x.k, true]));
    await db().transaction(async (tx) => {
      const q = await saveQc(tx, firm.id, year, {
        acc: tick(QC_ACCEPT, 'a_'), rev: tick(QC_REVIEW, 'r_'), risk: fv(f, 'risk') as never, decision: fv(f, 'decision') as never,
        decidedBy: fv(f, 'decidedBy'), decidedOn: fdate(f, 'decidedOn'), accNote: fv(f, 'accNote') ?? '',
        preparedBy: fv(f, 'preparedBy'), reviewedBy: fv(f, 'reviewedBy'), reviewedOn: fdate(f, 'reviewedOn'), revNote: fv(f, 'revNote') ?? '', reviewedExt: fv(f, 'reviewedExt') ?? '',
        doc: {
          matters: fv(f, 'doc_matters'), judgments: fv(f, 'doc_judgments'), commOn: fdate(f, 'doc_commOn'), comm: fv(f, 'doc_comm'),
          ackOn: fdate(f, 'doc_ackOn'), ackBy: fv(f, 'doc_ackBy'), reportOn: fdate(f, 'doc_reportOn'), fsDate: fdate(f, 'doc_fsDate'),
        } as never,
      }, u.id);
      await linkFiles(tx, f.getAll('fileIds'), firm.id, IFAC_FILE_ENTITY, q.id);
    });
    done();
    return { ok: 'Листата е зачувана.' };
  } catch (e) { return err(e); }
}

/** The employee's own declaration: the clients worked on, the relations / conflicts declared, the signed paper copy (optional). */
export async function ethicsSign(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    const year = await yearOf(f);
    if (f.get('ok') !== 'on') return { error: 'Потврдете дека изјавата е прочитана.' };
    const { O } = await loadProvider(u);
    const want = new Set(f.getAll('clients').map(String));
    const clients = (await allowedFirms(u, { year })).filter((x) => want.has(x.id)).map((x) => x.name);
    await db().transaction(async (tx) => {
      const id = await signEthics(tx, u.id, year, { office: O.name ?? '', today: today(), demo: isDemoUser(u), clients, conflicts: fv(f, 'conflicts') ?? '' });
      await linkFiles(tx, f.getAll('fileIds'), null, IFAC_FILE_ENTITY, id);
    });
    revalidatePath('/ifac'); revalidatePath('/iso');
    return { ok: `✅ Изјавата за ${year} е потпишана и запишана во „Обуки“ (ISO).` };
  } catch (e) { return err(e); }
}

/** One ISQM 1 component of the office (owner, the documented text, sign-off, evidence). */
export async function sqmSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('settings');
    const year = await yearOf(f);
    const c = sqmComp(fv(f, 'comp') ?? '');
    if (!c) return { error: 'Непозната компонента.' };
    const input: Record<string, unknown> = { owner: fv(f, 'owner'), signedBy: fv(f, 'signedBy'), signedOn: fdate(f, 'signedOn') };
    for (const x of c.fields) input[x.k] = x.t === 'date' ? fdate(f, 'd_' + x.k) : fv(f, 'd_' + x.k);
    await db().transaction(async (tx) => {
      const id = await saveSqm(tx, c.k, year, input, u.id);
      await linkFiles(tx, f.getAll('fileIds'), null, IFAC_FILE_ENTITY, id);
    });
    revalidatePath('/ifac');
    return { ok: `${c.n} – зачувано.` };
  } catch (e) { return err(e); }
}

export async function sqmStarter(year: number): Promise<ActionState> {
  try {
    const u = await officeGlobal('settings');
    const { O } = await loadProvider(u);
    const n = await db().transaction((tx) => addSqmStarter(tx, year, O.name ?? '', u.id));
    revalidatePath('/ifac');
    return { ok: n ? `Пополнети ${n} компоненти – прегледајте ги, дополнете ги и потпишете ги.` : 'Сите компоненти веќе постојат.' };
  } catch (e) { return err(e); }
}

/** An employee's competence (requirements of the role met), licence and CPD hours, assessed by someone else. */
export async function staffSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('settings');
    const year = await yearOf(f);
    const subject = fv(f, 'subject');
    if (!isUuid(subject)) return { error: 'Изберете вработен.' };
    const met = Object.fromEntries([...f.keys()].filter((k) => /^met_\d+$/.test(k)).map((k) => [k.slice(4), true]));
    const cpd = f.getAll('c_date').map((d, i) => ({
      date: String(d), topic: String(f.getAll('c_topic')[i] ?? ''), provider: String(f.getAll('c_provider')[i] ?? ''),
      hours: String(f.getAll('c_hours')[i] ?? ''), structured: String(f.getAll('c_kind')[i] ?? 's') === 's',
    }));
    await db().transaction(async (tx) => {
      const id = await saveStaff(tx, subject, year, { met, isos: fv(f, 'isos') ?? '', licensed: !!fv(f, 'isos'), licence: fv(f, 'licence'), cpd, assessedBy: fv(f, 'assessedBy'), assessedExt: fv(f, 'assessedExt'), assessedOn: fdate(f, 'assessedOn'), note: fv(f, 'note') }, u.id);
      await linkFiles(tx, f.getAll('fileIds'), null, IFAC_FILE_ENTITY, id);
    });
    revalidatePath('/ifac');
    return { ok: 'Зачувано.' };
  } catch (e) { return err(e); }
}

/* ---------------- obligations towards ИСОС (ЗВСР чл. 32, 46) ---------------- */

/** Save an ИСОС record with its evidence, then bring the office firm's deadlines (Рокови) up to date. */
async function isosSave(f: FormData, save: (tx: Tx, userId: string, year: number) => Promise<string>): Promise<{ ok: true; warn: string } | ActionState> {
  const u = await officeGlobal('settings');
  const year = await yearOf(f);
  const P = await loadProvider(u);
  await db().transaction(async (tx) => {
    const id = await save(tx, u.id, year);
    await linkFiles(tx, f.getAll('fileIds'), null, IFAC_FILE_ENTITY, id);
    if (P.off) await syncIsosDeadlines(tx, P.off.id, today(), { userId: u.id, demo: isDemoUser(u) });
  });
  revalidatePath('/ifac'); revalidatePath('/rokovi');
  return { ok: true, warn: P.off ? '' : ' ⚠ Роковите не се додадени во „Рокови“ – одредете ја фирмата на канцеларијата во „Договор за сметководствени услуги“.' };
}
const isosDone = (r: { ok: true; warn: string } | ActionState, msg: string): ActionState => ('warn' in r ? { ok: msg + r.warn } : r);

/** The professional liability insurance policy (new or `id`), the scan as evidence. */
export async function insSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = fv(f, 'id');
    const input = { form: fv(f, 'form'), insurer: fv(f, 'insurer'), policyNo: fv(f, 'policyNo'), amountEur: fv(f, 'amountEur'), validFrom: fdate(f, 'validFrom'), validTo: fdate(f, 'validTo'), note: fv(f, 'note') };
    return isosDone(await isosSave(f, (tx, uid) => saveIsosIns(tx, isUuid(id) ? id : null, input, uid)), 'Полисата е зачувана; потсетник 30 дена пред истекот е во „Рокови“.');
  } catch (e) { return err(e); }
}

export async function insDelete(id: string): Promise<ActionState> {
  try {
    const u = await officeGlobal('settings');
    const P = await loadProvider(u);
    await db().transaction(async (tx) => {
      await deleteIsosIns(tx, id, u.id);
      if (P.off) await syncIsosDeadlines(tx, P.off.id, today(), { userId: u.id, demo: isDemoUser(u) });
    });
    revalidatePath('/ifac'); revalidatePath('/rokovi');
    return { ok: 'Избришано.' };
  } catch (e) { return err(e); }
}

/** The list of employees and the proof of insurance sent to ИСОС for the year (the list kept as sent). */
export async function isosListSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    const year = await yearOf(f);
    const rows = await isosListRows(year, isDemoUser(u));
    const input = { submittedOn: fdate(f, 'submittedOn'), how: fv(f, 'how'), note: fv(f, 'note') };
    return isosDone(await isosSave(f, (tx, uid, y) => saveIsosList(tx, y, input, rows, uid)), input.submittedOn ? `✅ Списокот за ${year} е означен како доставен до ИСОС.` : 'Зачувано.');
  } catch (e) { return err(e); }
}

/** The yearly quality-control questionnaire for the year covered (`year` in the form). */
export async function isosQSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const input = { receivedOn: fdate(f, 'receivedOn'), submittedOn: fdate(f, 'submittedOn'), note: fv(f, 'note') };
    return isosDone(await isosSave(f, (tx, uid, y) => saveIsosQ(tx, y, input, uid)), input.submittedOn ? '✅ Прашалникот е означен како доставен.' : 'Зачувано.');
  } catch (e) { return err(e); }
}

/** A quality control on the spot by ИСОС: date, controller, findings, measures, the report as evidence. */
export async function isosCtlSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const input = { date: fdate(f, 'date'), by: fv(f, 'by'), findings: fv(f, 'findings'), measures: fv(f, 'measures'), note: fv(f, 'note') };
    return isosDone(await isosSave(f, (tx, uid) => saveIsosCtl(tx, input, uid)), 'Контролата е зачувана.');
  } catch (e) { return err(e); }
}
