'use server';
/**
 * Server addition (legacy had only the internal report and a status): the УФР workflow of the AML module.
 *  - monitoring of the books → alert queue (`amlScanRun`);
 *  - the officer's documented decision on an alert / internal report (`amlDecide`): no suspicion (with reason) or
 *    a report to УФР (STR чл. 65 / cash чл. 63), created with its legal deadline;
 *  - reports to УФР (`amlUfrNew`, `amlUfrSave`, `amlUfrSubmit`): the fields of the УФР form, deadline, submission
 *    date and УФР reference — locked once submitted;
 *  - retention: `amlPurge` deletes only after the 10-year period (чл. 62) and only by the owner.
 * Every action: office permission + owner / officer (`amlGuard`), audited. Audit entries carry no firm id (the ban on
 * disclosure, чл. 72: nothing of this appears in the client's own audit trail); the client id is in `data`.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import {
  AML_KIND_LBL, AML_UFR_FIELD_KEYS, amlCanPurge, amlRetentionBase, amlDeadline, amlIsUfrKind, amlKindOf, addMonths, type AmlCdd, type AmlKind,
} from '@wise/core/office';
import { amlRecords, amlReports, audit, firms } from '@wise/db';
import { amlGuard, amlScanFirm } from '@/lib/aml';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, fdate, fv, isUuid, today } from '@/lib/office';

const err = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : 'Грешка.' });
const done = (ok: string): ActionState => { revalidatePath('/aml'); return { ok }; };

/** Run the monitoring for one client (`firmId`) or all clients, from `from` to `to` (default: 1 January → today). */
export async function amlScanRun(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const td = today();
    const from = fdate(f, 'from') ?? `${td.slice(0, 4)}-01-01`, to = fdate(f, 'to') ?? td;
    if (from > to) return { error: 'Периодот не е точен.' };
    const fid = fv(f, 'firmId');
    const F = (await allowedFirms(u, { year: 'all' })).filter((x) => !(x.settings as { officeFirm?: boolean }).officeFirm && (!fid || x.id === fid));
    let n = 0;
    for (const x of F) n += await amlScanFirm(x, from, to, u);
    return done(n ? `Нови сигнали: ${n} (${F.length} клиенти). Прегледајте ги во „Мониторинг“.` : `Нема нови сигнали (${F.length} клиенти).`);
  } catch (e) { return err(e); }
}

const RES = ['none', 'str', 'ctr', 'strctr'] as const;

/**
 * Officer's decision on an alert / internal report. `none` needs a reason (documented analysis, чл. 45 / 46 ст.3);
 * a report creates the УФР report row(s) with their deadline: STR from today (24 h), cash from the transaction date.
 */
export async function amlDecide(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const id = fv(f, 'id'), res = fv(f, 'result') as (typeof RES)[number] | null, reason = fv(f, 'reason');
    if (!isUuid(id) || !res || !RES.includes(res)) return { error: 'Изберете одлука.' };
    if (!reason) return { error: 'Внесете образложение на одлуката (се чува 10 години).' };
    const td = today();
    const msg = await db().transaction(async (tx) => {
      const [r] = await tx.select().from(amlReports).where(eq(amlReports.id, id)).for('update');
      if (!r) throw new Error('Записот не постои.');
      const k = amlKindOf(r.data);
      if (amlIsUfrKind(k)) throw new Error('Ова е веќе извештај до УФР.');
      if (r.status === 'затворено' || r.status === 'пријавено во УФР') throw new Error('За овој запис веќе е одлучено.');
      const D = r.data as Record<string, unknown>;
      const kinds: AmlKind[] = res === 'none' ? [] : res === 'strctr' ? ['str', 'ctr'] : [res];
      const made: string[] = [];
      for (const kk of kinds) {
        const from = kk === 'ctr' && typeof D.date === 'string' ? D.date : td;
        const [x] = await tx.insert(amlReports).values({
          firmId: r.firmId, firmName: r.firmName, text: r.text, createdBy: u.id, createdByName: u.name,
          data: { kind: kk, from, due: amlDeadline(kk, from), src: r.id, aware: kk === 'str' ? new Date().toISOString() : undefined,
            form: { activity: r.text, amount: D.amount ?? null, txDate: D.date ?? null, partner: D.partnerName ?? '', desc: kk === 'str' ? reason : '' } },
        }).returning({ id: amlReports.id });
        made.push(x!.id);
      }
      const decision = { at: td, by: u.id, byName: u.name, result: res, reason, reports: made };
      await tx.update(amlReports).set({ status: res === 'none' ? 'затворено' : 'пријавено во УФР', data: { ...D, decision },
        note: sql`coalesce(${amlReports.note} || ' · ', '') || ${`${res === 'none' ? 'без сомневање' : 'одлука: извештај до УФР'} ${td} (${u.name})`}` }).where(eq(amlReports.id, id));
      await audit(tx, { userId: u.id, action: 'amlDecide', entityType: 'aml_report', entityId: id, data: { client: r.firmId, result: res, reports: made } });
      return res === 'none' ? 'Одлуката е евидентирана (без сомневање).' : `Креиран извештај до УФР – рок ${made.length ? amlDeadline(kinds[0]!, kinds[0] === 'ctr' && typeof D.date === 'string' ? D.date : td).split('-').reverse().join('.') : ''}. Пополнете го и доставете го.`;
    });
    return done(msg);
  } catch (e) { return err(e); }
}

/** A report to УФР started directly (STR without a prior alert, cash report, refused relationship, ЦРСМ discrepancy). */
export async function amlUfrNew(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const kind = fv(f, 'kind') as AmlKind | null;
    if (!kind || !amlIsUfrKind(kind)) return { error: 'Изберете вид на извештај.' };
    const fid = fv(f, 'firmId'), text = fv(f, 'text');
    if (!isUuid(fid) || !text) return { error: 'Изберете клиент и внесете опис.' };
    const [fr] = await db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, fid)).limit(1);
    if (!fr) return { error: 'Клиентот не постои.' };
    const from = fdate(f, 'from') ?? today();
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(amlReports).values({ firmId: fr.id, firmName: fr.name, text, createdBy: u.id, createdByName: u.name,
        data: { kind, from, due: amlDeadline(kind, from), aware: kind === 'str' ? new Date().toISOString() : undefined, form: { activity: text } } }).returning({ id: amlReports.id });
      await audit(tx, { userId: u.id, action: 'amlUfrNew', entityType: 'aml_report', entityId: r!.id, data: { client: fr.id, kind } });
    });
    return done(`${AML_KIND_LBL[kind]}: креиран, рок ${amlDeadline(kind, from).split('-').reverse().join('.')}.`);
  } catch (e) { return err(e); }
}

export async function amlUfrSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const id = fv(f, 'id');
    if (!isUuid(id)) return { error: 'Непознат извештај.' };
    await db().transaction(async (tx) => {
      const [r] = await tx.select().from(amlReports).where(eq(amlReports.id, id)).for('update');
      if (!r || !amlIsUfrKind(amlKindOf(r.data))) throw new Error('Непознат извештај.');
      const D = r.data as Record<string, unknown>;
      if (D.submitted) throw new Error('Извештајот е доставен до УФР и е заклучен.');
      const form = Object.fromEntries(AML_UFR_FIELD_KEYS.map((k) => [k, fv(f, `f_${k}`) ?? '']));
      await tx.update(amlReports).set({ data: { ...D, form } }).where(eq(amlReports.id, id));
      await audit(tx, { userId: u.id, action: 'amlUfrSave', entityType: 'aml_report', entityId: id, data: { client: r.firmId } });
    });
    return done('Извештајот е зачуван.');
  } catch (e) { return err(e); }
}

/** Submission to УФР: date, УФР reference / confirmation number, channel. Locks the report. */
export async function amlUfrSubmit(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const id = fv(f, 'id'), date = fdate(f, 'date'), no = fv(f, 'ufrNo'), ch = fv(f, 'channel') ?? 'електронски';
    if (!isUuid(id) || !date) return { error: 'Внесете датум на доставување.' };
    if (!no) return { error: 'Внесете го бројот / потврдата од системот на УФР.' };
    if (date > today()) return { error: 'Датумот на доставување не може да биде во иднина.' };
    await db().transaction(async (tx) => {
      const [r] = await tx.select().from(amlReports).where(eq(amlReports.id, id)).for('update');
      if (!r || !amlIsUfrKind(amlKindOf(r.data))) throw new Error('Непознат извештај.');
      const D = r.data as Record<string, unknown>;
      if (D.submitted) throw new Error('Извештајот веќе е доставен.');
      const late = typeof D.due === 'string' && date > D.due;
      await tx.update(amlReports).set({ status: 'пријавено во УФР', data: { ...D, submitted: date, ufrNo: no, channel: ch, subBy: u.name, late },
        note: sql`coalesce(${amlReports.note} || ' · ', '') || ${`доставено ${date} бр. ${no} (${u.name})`}` }).where(eq(amlReports.id, id));
      await audit(tx, { userId: u.id, action: 'amlUfrSubmit', entityType: 'aml_report', entityId: id, data: { client: r.firmId, date, ufrNo: no, channel: ch, late } });
    });
    return done('Доставувањето е евидентирано. Извештајот е заклучен.');
  } catch (e) { return err(e); }
}

/**
 * Deletion after the retention period only (чл. 62: 10 years from the submission of a report / the decision /
 * the end of the business relationship). Owner only; refused before expiry. The audit keeps the trace.
 */
export async function amlPurge(id: string, what: 'report' | 'client'): Promise<ActionState> {
  try {
    const u = await amlGuard();
    if (u.role !== 'admin') return { error: 'Бришење по истекот на рокот може само сопственикот.' };
    if (!isUuid(id)) return { error: 'Непознат запис.' };
    const td = today();
    await db().transaction(async (tx) => {
      if (what === 'client') {
        const [r] = await tx.select().from(amlRecords).where(eq(amlRecords.firmId, id)).for('update');
        if (!r) throw new Error('Записот не постои.');
        const end = (r.data as AmlCdd).relEnd ?? null;
        if (!amlCanPurge(end, td)) throw new Error(`🔒 Чување 10 години (чл. 62): ${end ? `до ${addMonths(end, 120).split('-').reverse().join('.')}` : 'деловниот однос не е завршен'}.`);
        await tx.delete(amlRecords).where(eq(amlRecords.firmId, id));
        await audit(tx, { userId: u.id, action: 'amlPurge', entityType: 'aml_record', entityId: id, data: { relEnd: end } });
        return;
      }
      const [r] = await tx.select().from(amlReports).where(eq(amlReports.id, id)).for('update');
      if (!r) throw new Error('Записот не постои.');
      const base = amlRetentionBase(r.data);
      if (!amlCanPurge(base, td)) throw new Error(`🔒 Чување 10 години (чл. 62): ${base ? `до ${addMonths(base, 120).split('-').reverse().join('.')}` : 'постапката не е завршена'}.`);
      // a report that is the source of another report stays as long as that one
      const kids = await tx.select({ id: amlReports.id }).from(amlReports).where(and(sql`${amlReports.data}->>'src' = ${id}`));
      if (kids.length) throw new Error('Записот е основа за извештај до УФР – се брише заедно со него.');
      await tx.delete(amlReports).where(eq(amlReports.id, id));
      await audit(tx, { userId: u.id, action: 'amlPurge', entityType: 'aml_report', entityId: id, data: { kind: amlKindOf(r.data), base } });
    });
    return done('Записот е избришан по истекот на рокот за чување.');
  } catch (e) { return err(e); }
}
