'use server';
/** „💲 AI трошок“ settings: the office's monthly AI limit, per-firm limits, page cap, Opus policy (owner only, audited). */
import { revalidatePath } from 'next/cache';
import { audit, getAiBudget, putAiBudget } from '@wise/db';
import { AI_BUDGET_KEY } from '@wise/core/ai/cost';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

const usd = (v: FormDataEntryValue | null): number | null | 'bad' => {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : 'bad';
};

export async function saveAiBudget(_prev: RowResult, form: FormData): Promise<RowResult> {
  const u = await requireUser();
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  const monthlyUsd = usd(form.get('monthly'));
  if (monthlyUsd === 'bad') return { error: 'Внесете лимит во USD (на пр. 50) или оставете празно за без лимит.' };
  const pages = Number(String(form.get('maxPages') ?? '').trim());
  if (!Number.isInteger(pages) || pages < 1 || pages > 500) return { error: 'Страници по читање: цел број од 1 до 500.' };
  const opusOnlyDeep = form.get('opusOnlyDeep') === 'on';
  const autoLawAi = form.get('autoLawAi') === 'on';
  await db().transaction(async (tx) => {
    const before = await getAiBudget(tx);
    // a raised limit clears this month's alert so a new 80 % / 100 % crossing is notified again
    const raised = monthlyUsd == null || (before.monthlyUsd != null && monthlyUsd > before.monthlyUsd);
    await putAiBudget(tx, { monthlyUsd, maxPages: pages, opusOnlyDeep, autoLawAi, ...(raised ? { alert: null } : {}) }, u.id);
    await audit(tx, { userId: u.id, action: 'aiBudgetSet', entityType: 'app_settings', entityId: AI_BUDGET_KEY, data: { from: before.monthlyUsd, to: monthlyUsd, maxPages: pages, opusOnlyDeep, autoLawAi } });
  });
  revalidatePath('/', 'layout');
  return { ok: monthlyUsd == null ? 'Зачувано – AI нема месечен лимит.' : `Зачувано – месечен лимит за AI: $${monthlyUsd.toFixed(2)}.` };
}

export async function saveFirmAiLimit(_prev: RowResult, form: FormData): Promise<RowResult> {
  const u = await requireUser();
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  const firmId = String(form.get('firm') ?? '');
  if (!isUuid(firmId)) return { error: 'Изберете фирма.' };
  const v = usd(form.get('limit'));
  if (v === 'bad') return { error: 'Внесете лимит во USD или оставете празно за да се отстрани.' };
  await db().transaction(async (tx) => {
    const B = await getAiBudget(tx);
    const firms = { ...B.firms };
    if (v == null) delete firms[firmId]; else firms[firmId] = v;
    await putAiBudget(tx, { firms, ...(B.alert?.firmId === firmId ? { alert: null } : {}) }, u.id);
    await audit(tx, { userId: u.id, firmId, action: 'aiBudgetSet', entityType: 'app_settings', entityId: AI_BUDGET_KEY, data: { firm: firmId, from: B.firms[firmId] ?? null, to: v } });
  });
  revalidatePath('/aiTrosok');
  return { ok: v == null ? 'Лимитот за фирмата е отстранет.' : `Лимит за фирмата: $${v.toFixed(2)} месечно.` };
}
