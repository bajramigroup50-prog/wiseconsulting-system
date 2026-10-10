'use server';
/**
 * Legacy `VIEWS.aml` tabs „🏢 Канцеларија“ and „🚩 Пријави“ + „🔍 Анализирај ги сите клиенти“: officer / deputy
 * (`amlOffSet`), trainings (`amlTrAdd`), annual internal control (`amlCtl`), internal suspicion reports
 * (`amlRepNew` / `amlRepSt`) and the batch risk analysis (`amlGo`). Office settings live in `app_settings.aml`.
 */
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { amlNextReview, amlRisk, type AmlFile } from '@wise/core/office';
import { amlRecords, amlReports, appSettings, audit, firms } from '@wise/db';
import { AML_KEY, amlAllowed, amlAutoFor, amlOffice, type AmlOffice } from '@/lib/aml';
import { requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, fdate, fv, isUuid, today } from '@/lib/office';

async function guard() {
  const u = await requireCan('office', null);
  if (!(await amlAllowed(u))) throw new Error('🔒 Само сопственикот и овластеното лице.');
  return u;
}

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

export async function amlOffSet(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings', null);
    if (u.role !== 'admin') return { error: 'Овластеното лице го определува сопственикот.' };
    const offUid = fv(f, 'offUid');
    await patch(u.id, { officer: fv(f, 'officer') ?? '', deputy: fv(f, 'deputy') ?? '', offUid: offUid && isUuid(offUid) ? offUid : '' }, 'amlOffSet');
    return { ok: 'Зачувано.' };
  } catch (e) { return err(e); }
}

export async function amlTrAdd(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await guard();
    const date = fdate(f, 'date'), topic = fv(f, 'topic');
    if (!date || !topic) return { error: 'Внесете датум и тема.' };
    const tr = [...((await amlOffice()).tr ?? []), { date, topic, who: fv(f, 'who') ?? '' }];
    await patch(u.id, { tr }, 'amlTrAdd');
    return { ok: 'Обуката е евидентирана.' };
  } catch (e) { return err(e); }
}

export async function amlCtl(): Promise<ActionState> {
  try {
    const u = await guard();
    await patch(u.id, { ctl: today() }, 'amlCtl');
    return { ok: 'Евидентирана е годишната внатрешна контрола.' };
  } catch (e) { return err(e); }
}

/** Legacy `amlRepNew`: anyone in the office may report; only the owner and the officer see the list. */
export async function amlRepNew(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (u.role === 'klient' || u.role === 'view') return { error: 'Немате право.' };
    const text = fv(f, 'text');
    if (!text) return { error: 'Опишете го сомневањето.' };
    const fid = fv(f, 'firmId');
    const [fr] = fid && isUuid(fid) ? await db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, fid)).limit(1) : [];
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(amlReports).values({ firmId: fr?.id ?? null, firmName: fr?.name ?? '', text, createdBy: u.id, createdByName: u.name }).returning({ id: amlReports.id });
      await audit(tx, { userId: u.id, firmId: fr?.id ?? null, action: 'amlRepNew', entityType: 'aml_report', entityId: r!.id });
    });
    revalidatePath('/aml');
    return { ok: 'Пријавата е испратена до овластеното лице.' };
  } catch (e) { return err(e); }
}

export async function amlRepSt(id: string, status: string): Promise<ActionState> {
  try {
    const u = await guard();
    if (!['анализа', 'пријавено во УФР', 'затворено'].includes(status)) return { error: 'Непознат статус.' };
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
    const u = await guard();
    const F = await allowedFirms(u);
    const R = await db().select().from(amlRecords);
    const td = today(), y = Number(td.slice(0, 4));
    let n = 0;
    for (const f of F) {
      if ((f.settings as { officeFirm?: boolean }).officeFirm) continue;
      const A = (R.find((r) => r.firmId === f.id)?.data ?? {}) as AmlFile;
      const X = await amlAutoFor(f, y);
      const r = amlRisk(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd });
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
