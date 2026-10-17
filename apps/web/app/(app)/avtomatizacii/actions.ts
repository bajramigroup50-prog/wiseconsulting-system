'use server';
/**
 * „⚙ Автоматизации“ (office settings, OWNER only): the „автоматски“ switch of every scheduled automation and its
 * options, and „▶ Пушти сега“ (queues the job for an automation that is ON — it still only prepares drafts).
 * 🎭 Never for a demo user (the demo office has no scheduled automations). Audited (`autoCfgSet`, `autoRunNow`).
 */
import { revalidatePath } from 'next/cache';
import { AUTO_JOB, AUTO_KINDS, AUTO_META, autoSettingsClean, isAutoKind } from '@wise/core/office/automations';
import { audit, autoSettings, putAutoSettings } from '@wise/db';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

async function owner() {
  const u = await requireUser();
  if (isDemoUser(u)) return { error: DEMO_OFF_MSG };
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  return { u };
}

export async function saveAutomations(_p: RowResult, f: FormData): Promise<RowResult> {
  const o = await owner();
  if ('error' in o) return { error: o.error };
  const S = autoSettingsClean({
    on: Object.fromEntries(AUTO_KINDS.map((k) => [k, f.get(`on_${k}`) === 'on'])),
    payDay: f.get('payDay'), payMonth: f.get('payMonth'), reportDay: f.get('reportDay'),
    reportAi: f.get('reportAi') === 'on', reportPublish: f.get('reportPublish') === 'on',
  });
  await db().transaction(async (tx) => {
    const before = await autoSettings(tx);
    await putAutoSettings(tx, S, o.u.id);
    await audit(tx, { userId: o.u.id, action: 'autoCfgSet', entityType: 'app_settings', entityId: 'automations', data: { before, after: S } });
  });
  revalidatePath('/avtomatizacii');
  const on = AUTO_KINDS.filter((k) => S.on[k]).length;
  return { ok: `Зачувано – вклучени ${on} од ${AUTO_KINDS.length} автоматизации.` };
}

export async function runAutomationNow(kind: string): Promise<RowResult> {
  const o = await owner();
  if ('error' in o) return { error: o.error };
  if (!isAutoKind(kind)) return { error: 'Непозната автоматизација.' };
  if (!(await autoSettings(db())).on[kind]) return { error: 'Прво вклучете ја автоматизацијата.' };
  try {
    await enqueue(AUTO_JOB[kind], { force: true });
  } catch { return { error: 'Редот за задачи е недостапен – обидете се повторно.' }; }
  await audit(db(), { userId: o.u.id, action: 'autoRunNow', entityType: 'automation', entityId: kind, data: { job: AUTO_JOB[kind] } });
  return { ok: `▶ „${AUTO_META[kind].name}“ е пуштено – за неколку минути освежете ја страницата.` };
}
