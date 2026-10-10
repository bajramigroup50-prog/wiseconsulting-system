'use server';
/**
 * Contracts and HR registry actions (legacy `ctSave` 7786/15596, `extSave` 7780, `diSave` 15687, `diApply` 15688,
 * `hrRegister` 6098, `hrPrefix` 6109) through the `@wise/db` HR service.
 */
import { revalidatePath } from 'next/cache';
import { HR_LOCK_MSG, hrOfficeLocked } from '@/lib/hr-lock';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { HR_DI_GR, HR_DI_KIND, hrDocCode, hrDocLabel, type HrContract, type HrDiDoc, type HrExtension } from '@wise/core';
import { applyTermination, audit, employees, extendContract, payrollSettings, PayrollError, registerHrDoc, saveContract, saveDiDoc } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction, payError } from '@/lib/payroll/server';

export interface HrResult extends ActionState { docId?: string; no?: string }

const rev = (employeeId?: string) => {
  revalidatePath('/dogovori');
  revalidatePath('/vraboteni');
  if (employeeId) { revalidatePath(`/vraboteni/${employeeId}/dogovor`); revalidatePath(`/vraboteni/${employeeId}/merki`); }
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Contract = z.object({
  type: z.enum(['neopr', 'opr', 'skr', 'sez', 'dom']), no: z.string().trim().max(40), signDate: date, place: z.string().max(100), start: date,
  end: z.string().max(10), reason: z.string().max(500), position: z.string().max(200), duties: z.string().max(4000), workPlace: z.string().max(300),
  hours: z.coerce.number().min(1).max(60), probation: z.union([z.literal(''), z.coerce.number().min(0).max(12)]), gross: z.coerce.number().min(0),
  net: z.coerce.number().min(0), leave: z.coerce.number().min(0).max(60), notice: z.coerce.number().min(0).max(12), rep: z.string().max(200), repRole: z.string().max(100),
}).passthrough();

export async function saveContractAction(employeeId: string, c: HrContract): Promise<HrResult> {
  try {
    const v = Contract.safeParse(c);
    if (!v.success) return { error: 'Проверете ги полињата на договорот (' + (v.error.issues[0]?.path.join('.') ?? '') + ').' };
    const { u, firm } = await payAction('ctSave');
    if (await hrOfficeLocked(firm, u)) return { error: HR_LOCK_MSG };
    const r = await db().transaction((tx) => saveContract(tx, { firmId: firm.id, employeeId, c: v.data as HrContract, userId: u.id }));
    rev(employeeId);
    return { ok: `Договорот е заведен под бр. ${r.doc.no} и зачуван во досието.`, docId: r.doc.id, no: r.doc.no };
  } catch (e) { return payError(e); }
}

const Ext = z.object({ kind: z.enum(['ext', 'transform']), doc: z.enum(['annex', 'odluka']), no: z.string().max(40).optional(), date, end: z.string().max(10).optional(), reason: z.string().max(500).optional() });

export async function extendContractAction(employeeId: string, x: HrExtension): Promise<HrResult> {
  try {
    const v = Ext.safeParse(x);
    if (!v.success) return { error: 'Проверете ги податоците за продолжувањето.' };
    const { u, firm } = await payAction('extSave');
    if (await hrOfficeLocked(firm, u)) return { error: HR_LOCK_MSG };
    const d = await db().transaction((tx) => extendContract(tx, { firmId: firm.id, employeeId, x: { ...v.data, end: v.data.end || undefined }, userId: u.id }));
    rev(employeeId);
    return { ok: x.kind === 'transform' ? `Работниот однос е трансформиран во неопределено време (бр. ${d.no}).` : `Договорот е продолжен до ${x.end?.split('-').reverse().join('.')} (бр. ${d.no}).`, docId: d.id, no: d.no };
  } catch (e) { return payError(e); }
}

export async function saveDiAction(employeeId: string, x: HrDiDoc): Promise<HrResult> {
  try {
    if (!HR_DI_KIND.some((k) => k[0] === x.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date ?? '')) return { error: 'Неважечки документ.' };
    const { u, firm } = await payAction('diSave');
    if (await hrOfficeLocked(firm, u)) return { error: '🔒 Само сопственикот.' };
    const title = hrDocLabel({ kind: 'di-' + x.kind });
    const d = await db().transaction((tx) => saveDiDoc(tx, { firmId: firm.id, employeeId, x, title, userId: u.id }));
    rev(employeeId);
    return { ok: `✓ Зачувано во досието на работникот под бр. ${d.no}.`, docId: d.id, no: d.no };
  } catch (e) { return payError(e); }
}

export async function applyTerminationAction(employeeId: string, x: HrDiDoc): Promise<HrResult> {
  try {
    if (!x.last) return { error: 'Внесете последен работен ден.' };
    const { u, firm } = await payAction('diApply');
    if (await hrOfficeLocked(firm, u)) return { error: '🔒 Само сопственикот.' };
    const reason = (HR_DI_KIND.find((k) => k[0] === x.kind)?.[1] ?? '') + (x.kind === 'otkaz' ? ' – ' + ((HR_DI_GR.find((g) => g[0] === x.ground)?.[1] ?? '').split(' – ')[0]) : '');
    await db().transaction((tx) => applyTermination(tx, { firmId: firm.id, employeeId, last: x.last!, reason, docNo: x.no, userId: u.id }));
    rev(employeeId);
    return { ok: '✓ Внесен престанок. Не заборавајте одјава (М2) и конечна пресметка.' };
  } catch (e) { return payError(e); }
}

const Leave = z.object({
  kind: z.enum(['leave', 'sick']), employeeId: z.string().uuid(), no: z.string().trim().max(40), date, start: date, end: date,
  days: z.coerce.number().min(0.5).max(366), note: z.string().trim().max(500),
});

/** Register an annual-leave decision or a sick-leave record. */
export async function registerLeaveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = (k: string) => String(form.get(k) ?? '');
    const v = Leave.safeParse({ kind: g('kind'), employeeId: g('employeeId'), no: g('no'), date: g('date'), start: g('start'), end: g('end'), days: g('days'), note: g('note') });
    if (!v.success) return { error: 'Внесете вработен, датуми и број на денови.' };
    const x = v.data;
    if (x.end < x.start) return { error: 'Датумот „до“ е пред „од“.' };
    const { u, firm } = await payAction('hrRegister');
    await db().transaction(async (tx) => {
      const [e] = await tx.select().from(employees).where(and(eq(employees.id, x.employeeId), eq(employees.firmId, firm.id))).limit(1);
      if (!e) throw new PayrollError('not_found', 'Вработениот не постои.');
      const snap = { start: x.start, end: x.end, days: x.days, note: x.note, year: x.start.slice(0, 4) };
      await registerHrDoc(tx, {
        firmId: firm.id, employeeId: e.id, kind: x.kind, no: x.no || null, date: x.date, empName: e.name, start: x.start, end: x.end, days: x.days,
        position: e.position, code: hrDocCode({ t: x.kind, f: firm.id, e: e.id, n: e.name, ...snap }), title: hrDocLabel({ kind: x.kind }), snap, userId: u.id,
      });
    });
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Заведено.' };
}

/** Registry number prefix (legacy `firm.hrPrefix`, e.g. `03-`). */
export async function savePrefixAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const prefix = String(form.get('prefix') ?? '').trim().slice(0, 12);
    const { u, firm } = await payAction('write');
    await db().transaction(async (tx) => {
      await tx.insert(payrollSettings).values({ firmId: firm.id, hrPrefix: prefix || null, updatedBy: u.id })
        .onConflictDoUpdate({ target: payrollSettings.firmId, set: { hrPrefix: prefix || null, updatedBy: u.id } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'hrPrefix', entityType: 'payroll_settings', entityId: firm.id, data: { prefix } });
    });
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Зачувано.' };
}
