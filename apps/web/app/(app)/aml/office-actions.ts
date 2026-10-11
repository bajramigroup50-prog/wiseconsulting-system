'use server';
/**
 * Legacy `VIEWS.aml` tabs „🏢 Канцеларија“ and „🚩 Пријави“ + „🔍 Анализирај ги сите клиенти“: officer / deputy
 * (`amlOffSet`), trainings (`amlTrAdd`), annual internal control (`amlCtl`), internal suspicion reports
 * (`amlRepNew` / `amlRepSt`) and the batch risk analysis (`amlGo`). Office settings live in `app_settings.aml`.
 * Server additions: appointment + notification to УФР (чл. 68), the internal program (чл. 12), the office's own
 * risk assessment (чл. 11), the internal-control log (чл. 69), confidentiality statements (чл. 72 ст.3) and the
 * monitoring settings (high-risk countries чл. 43, split-pattern window).
 */
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { AML_SELF_FACTORS, amlDeadline, amlNextReview, amlRiskFull, type AmlCdd, type AmlSelf } from '@wise/core/office';
import { amlRecords, amlReports, appSettings, audit, firms } from '@wise/db';
import { AML_KEY, amlAutoFor, amlGuard, amlOffice, type AmlOffice } from '@/lib/aml';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, fdate, fnum, fv, isUuid, today } from '@/lib/office';

async function patch(userId: string, p: Partial<AmlOffice>, action: string) {
  await db().transaction(async (tx) => {
    const cur = (await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, AML_KEY)).limit(1))[0]?.v ?? {};
    const value = { ...(cur as AmlOffice), ...p };
    await tx.insert(appSettings).values({ key: AML_KEY, value, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
    await audit(tx, { userId, action, entityType: 'app_settings', entityId: AML_KEY, data: p });
  });
  revalidatePath('/aml');
}

const err = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : 'Грешка.' });

/** Officer + deputy (чл. 68): appointed by the owner; the data (and every change) go to УФР electronically (ст.15). */
export async function amlOffSet(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings', null);
    if (u.role !== 'admin') return { error: 'Овластеното лице го определува сопственикот.' };
    const offUid = fv(f, 'offUid');
    const O = await amlOffice();
    const officer = fv(f, 'officer') ?? '', deputy = fv(f, 'deputy') ?? '';
    // a change of the officer / deputy needs a new notification to УФР
    const changed = officer !== (O.officer ?? '') || deputy !== (O.deputy ?? '');
    await patch(u.id, {
      officer, deputy, offUid: offUid && isUuid(offUid) ? offUid : '',
      offPos: fv(f, 'offPos') ?? '', offPhone: fv(f, 'offPhone') ?? '', offEmail: fv(f, 'offEmail') ?? '', depPos: fv(f, 'depPos') ?? '',
      appointed: fdate(f, 'appointed'), appointNo: fv(f, 'appointNo') ?? '',
      ufrNotified: changed && !fdate(f, 'ufrNotified') ? null : fdate(f, 'ufrNotified'),
    }, 'amlOffSet');
    return { ok: changed && !fdate(f, 'ufrNotified') ? 'Зачувано. ⚠ Известете ја УФР за промената (чл. 68 ст.15) и внесете го датумот.' : 'Зачувано.' };
  } catch (e) { return err(e); }
}

export async function amlTrAdd(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const date = fdate(f, 'date'), topic = fv(f, 'topic');
    if (!date || !topic) return { error: 'Внесете датум и тема.' };
    const tr = [...((await amlOffice()).tr ?? []), { date, topic, who: fv(f, 'who') ?? '' }];
    await patch(u.id, { tr }, 'amlTrAdd');
    return { ok: 'Обуката е евидентирана.' };
  } catch (e) { return err(e); }
}

/** Legacy one-click „✓ Извршена денес“ — kept; the documented control is `amlCtlSave`. */
export async function amlCtl(): Promise<ActionState> {
  try {
    const u = await amlGuard();
    await patch(u.id, { ctl: today() }, 'amlCtl');
    return { ok: 'Евидентирана е годишната внатрешна контрола.' };
  } catch (e) { return err(e); }
}

/** Internal control (чл. 69): at least once a year, in the current year for the previous one, with documented findings. */
export async function amlCtlSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const date = fdate(f, 'date'), findings = fv(f, 'findings');
    if (!date || !findings) return { error: 'Внесете датум и наоди од контролата.' };
    const O = await amlOffice();
    const ctlLog = [...(O.ctlLog ?? []), { date, period: fv(f, 'period') ?? String(Number(date.slice(0, 4)) - 1), findings, measures: fv(f, 'measures') ?? '', by: fv(f, 'by') ?? u.name }];
    await patch(u.id, { ctlLog, ctl: date > (O.ctl ?? '') ? date : O.ctl }, 'amlCtlSave');
    return { ok: 'Извештајот од внатрешната контрола е евидентиран.' };
  } catch (e) { return err(e); }
}

/** The office's own documented risk assessment (чл. 11): factor scores 1–3, conclusions and measures. */
export async function amlSelfSave(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const date = fdate(f, 'date') ?? today();
    const scores = Object.fromEntries(AML_SELF_FACTORS.map(([k]) => [k, Math.min(3, Math.max(1, Math.round(fnum(f, `s_${k}`)) || 1))])) as AmlSelf['scores'];
    const self: AmlSelf = { date, scores, note: fv(f, 'note') ?? '', measures: fv(f, 'measures') ?? '', by: u.name };
    const O = await amlOffice();
    const hist = [...(O.selfHist ?? []), ...(O.self?.date ? [O.self] : [])];
    await patch(u.id, { self, selfHist: hist }, 'amlSelfSave');
    return { ok: 'Проценката на ризик на канцеларијата е зачувана.' };
  } catch (e) { return err(e); }
}

/** Program (чл. 12): adopted by the management — date and number of the decision. */
export async function amlProgSet(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings', null);
    if (u.role !== 'admin') return { error: 'Програмата ја донесува раководството (сопственикот).' };
    const prog = fdate(f, 'prog');
    if (!prog) return { error: 'Внесете датум на донесување.' };
    await patch(u.id, { prog, progNo: fv(f, 'progNo') ?? '' }, 'amlProgSet');
    return { ok: 'Евидентирано е донесувањето на програмата.' };
  } catch (e) { return err(e); }
}

/** High-risk countries (чл. 43, list of УФР published at least twice a year) and the split-pattern window. */
export async function amlHrcSet(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const hrc = String(f.get('hrc') ?? '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const linkDays = Math.min(366, Math.max(1, Math.round(fnum(f, 'linkDays')) || 30));
    await patch(u.id, { hrc, hrcDate: today(), linkDays }, 'amlHrcSet');
    return { ok: `Зачувано: ${hrc.length} високоризични земји.` };
  } catch (e) { return err(e); }
}

/** Confidentiality statement of an employee (чл. 72 ст.3). */
export async function amlConfAdd(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const name = fv(f, 'name'), date = fdate(f, 'date');
    if (!name || !date) return { error: 'Внесете вработен и датум.' };
    await patch(u.id, { conf: [...((await amlOffice()).conf ?? []), { name, date }] }, 'amlConfAdd');
    return { ok: 'Изјавата е евидентирана.' };
  } catch (e) { return err(e); }
}

/**
 * Legacy `amlRepNew`: anyone in the office may report; only the owner and the officer see the list. The officer must
 * decide by the next working day. FIX: the audit entry has no firm id (it would show in the client's activity log).
 */
export async function amlRepNew(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('write');
    if (u.role === 'klient') return { error: 'Немате право.' };
    const text = fv(f, 'text');
    const fid = fv(f, 'firmId');
    if (!text || !fid) return { error: 'Изберете клиент и опишете го сомневањето.' };
    const [fr] = fid && isUuid(fid) ? await db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, fid)).limit(1) : [];
    const td = today();
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(amlReports).values({ firmId: fr?.id ?? null, firmName: fr?.name ?? '', text, createdBy: u.id, createdByName: u.name, data: { kind: 'int', from: td, due: amlDeadline('int', td) } }).returning({ id: amlReports.id });
      await audit(tx, { userId: u.id, action: 'amlRepNew', entityType: 'aml_report', entityId: r!.id, data: { client: fr?.id ?? null } });
    });
    revalidatePath('/aml');
    return { ok: '✓ Внатрешната пријава е евидентирана. Не го известувајте клиентот.' };
  } catch (e) { return err(e); }
}

/** Legacy status buttons — only „анализа“ is left here; closing / reporting goes through the documented decision. */
export async function amlRepSt(id: string, status: string): Promise<ActionState> {
  try {
    const u = await amlGuard();
    if (status !== 'анализа') return { error: 'Одлуката се внесува со образложение (Одлука).' };
    await db().transaction(async (tx) => {
      await tx.update(amlReports).set({ status, note: sql`coalesce(${amlReports.note} || ' · ', '') || ${`${status} ${today()} (${u.name})`}` }).where(eq(amlReports.id, id));
      await audit(tx, { userId: u.id, action: 'amlRepSt', entityType: 'aml_report', entityId: id, data: { status } });
    });
    revalidatePath('/aml');
    return { ok: 'Статусот е променет.' };
  } catch (e) { return err(e); }
}

/** Legacy `amlGo`: analyse every client — the risk from the saved file plus the facts from the books. */
export async function amlGo(): Promise<ActionState> {
  try {
    const u = await amlGuard();
    const F = await allowedFirms(u);
    const R = await db().select().from(amlRecords);
    const td = today(), y = Number(td.slice(0, 4));
    let n = 0;
    for (const f of F) {
      if ((f.settings as { officeFirm?: boolean }).officeFirm) continue;
      const A = (R.find((r) => r.firmId === f.id)?.data ?? {}) as AmlCdd;
      const X = await amlAutoFor(f, y);
      const r = amlRiskFull(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd });
      const next = amlNextReview(A, r.level, td);
      await db().insert(amlRecords).values({ firmId: f.id, data: A as Record<string, unknown>, level: r.level, score: r.score, lastReview: A.lastReview ?? null, nextReview: next, updatedBy: u.id })
        .onConflictDoUpdate({ target: amlRecords.firmId, set: { level: r.level, score: r.score, nextReview: next } });
      n++;
    }
    await audit(db(), { userId: u.id, action: 'amlGo', entityType: 'aml_record', entityId: 'all', data: { firms: n } });
    revalidatePath('/aml');
    return { ok: `Анализирани ${n} клиенти.` };
  } catch (e) { return err(e); }
}
