'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, gte, isNotNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { FIRM_VAT_RATES, firmSettingsFrom, unlockTo } from '@wise/core/firms/firmform';
import { fyOnDeactivate, fyOnRestore } from '@wise/core/firms/years';
import { todaySkopje } from '@wise/core/office';
import { audit, requestRepost, vatPeriods, createDemoFirm, deleteDemoFirm, DemoFirmError, DemoResetError, firms, type NewFirm } from '@wise/db';
import { createClientProfile, takenUsernames } from '@/lib/client-profiles';
import { can } from '@wise/core';
import { hasDemoPrefix, isDemoFirm } from '@wise/core/demo';
import { requireCan, requireUser } from '@/lib/auth';
import { isDemoUser } from '@/lib/demo';
import { FIRM_COOKIE } from '@/lib/context';
import { db } from '@/lib/db';
import { selectFirm } from '../actions';
import { queueRepostChange, sendRepostRuns } from '@/lib/auto-repost';

const opt = z.string().trim().max(300).transform((s) => s || null);
const FirmInput = z.object({
  code: opt,
  name: z.string().trim().min(1, 'Внесете назив на фирмата.').max(300),
  legalForm: opt,
  address: opt, city: opt, phone: opt, email: opt, activity: opt,
  edb: opt.refine((s) => !s || /^(MK)?\d{13}$/i.test(s.replace(/\s/g, '')), 'Даночниот број има 13 цифри (со или без MK).'),
  embs: opt.refine((s) => !s || /^\d{7,8}$/.test(s), 'Матичниот број има 7 цифри.'),
  vatRegistered: z.boolean(),
  vatPeriod: z.enum(['quarter', 'month']),
  lockDate: opt.refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Неважечки датум.'),
});

export interface FirmFormState { error?: string; ok?: string; cred?: { username: string; password: string; firm: string } }

const str = (form: FormData, k: string) => { const v = form.get(k); return v == null ? undefined : String(v); };

export async function saveFirm(_prev: FirmFormState, form: FormData): Promise<FirmFormState> {
  const id = String(form.get('id') ?? '') || null;
  const u = await requireCan(id ? 'saveFirm' : 'newFirm', id);
  const parsed = FirmInput.safeParse({
    ...Object.fromEntries(['code', 'name', 'legalForm', 'address', 'city', 'phone', 'email', 'activity', 'edb', 'embs', 'lockDate', 'vatPeriod']
      .map((k) => [k, String(form.get(k) ?? '')])),
    vatRegistered: form.get('vatRegistered') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const [before] = id ? await db().select().from(firms).where(eq(firms.id, id)).limit(1) : [];
  if (id && !before) return { error: 'Фирмата не постои.' };
  // Moving the lock date back is „Отклучи“ — only the administrator (legacy firmUnlock).
  if (before?.lockDate && (!parsed.data.lockDate || parsed.data.lockDate < before.lockDate) && u.role !== 'admin')
    return { error: 'Заклучениот период може да го врати назад само администраторот (🔓 Отклучи).' };

  const text: Record<string, string | undefined> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') text[k] = v;
  const vatIn: Record<string, string | undefined> = {}, vatOut: Record<string, string | undefined> = {};
  for (const [r] of FIRM_VAT_RATES) { vatIn[r] = str(form, `vin_${r}`); vatOut[r] = str(form, `vout_${r}`); }
  const checked = new Set([...form.keys()].filter((k) => form.get(k) === 'on'));
  const sr = firmSettingsFrom({
    text, checked, settings: (before?.settings ?? {}) as Record<string, unknown>, vatIn, vatOut,
    withFee: form.get('withFee') === '1' && can(u.principal, 'office'),
  });
  if (!sr.ok) return { error: sr.error };
  const vatFrom = (str(form, 'vatFrom') ?? '').trim();
  if (vatFrom) sr.settings.vatFrom = vatFrom; else delete sr.settings.vatFrom;
  // 🎭 the demo flag is never set or cleared through the form: a demo firm stays demo (and keeps the „ДЕМО“ name), a real
  // firm can never become one here (only the owner's „🎭 Креирај демо фирми“ creates them)
  // a 🎭 demo user only ever creates demo firms (`createDemoFirm`: flag + „ДЕМО – “ prefix, limit) and edits demo firms
  const meDemo = isDemoUser(u);
  if (meDemo && before && !isDemoFirm(before)) return { error: 'Фирмата не постои.' };
  const wasDemo = isDemoFirm(before);
  if (wasDemo) {
    if (!hasDemoPrefix(parsed.data.name)) return { error: 'Името на демо фирма мора да почнува со „ДЕМО“.' };
    sr.settings.demo = true;
  } else delete sr.settings.demo;
  const v: Partial<NewFirm> = { ...parsed.data, settings: sr.settings };

  if (meDemo && !id) {
    let f;
    try {
      f = await db().transaction((tx) => createDemoFirm(tx as never, { values: { ...parsed.data, settings: sr.settings }, userId: u.id }));
    } catch (e) {
      if (e instanceof DemoFirmError) return { error: e.message };
      throw e;
    }
    // the principal of this request was read before the firm existed: open it by cookie (a demo firm of the demo office)
    (await cookies()).set(FIRM_COOKIE, f.id, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
    revalidatePath('/firmi');
    revalidatePath('/', 'layout');
    redirect('/');
  }

  const res = await db().transaction(async (tx) => {
    if (id && before) {
      await tx.update(firms).set(v).where(eq(firms.id, id));
      const changed = Object.fromEntries(Object.entries(parsed.data).filter(([k, x]) => before[k as keyof typeof before] !== x));
      const bs = (before.settings ?? {}) as Record<string, unknown>;
      const sChanged = Object.keys({ ...bs, ...sr.settings }).filter((k) => JSON.stringify(bs[k]) !== JSON.stringify(sr.settings[k]));
      await audit(tx, { userId: u.id, firmId: id, action: 'saveFirm', entityType: 'firm', entityId: id, data: { ...changed, settings: sChanged } });
      return { id, cred: null };
    }
    const [f] = await tx.insert(firms).values({ ...v, name: parsed.data.name, ownerId: u.id }).returning();
    await audit(tx, { userId: u.id, firmId: f!.id, action: 'newFirm', entityType: 'firm', entityId: f!.id, data: { name: parsed.data.name } });
    // legacy saveFirm: a new firm also gets its client-portal profile (klAutoUser) when the user may manage users
    const cred = can(u.principal, 'users') ? await createClientProfile(tx, f!, await takenUsernames(tx), u.id) : null;
    return { id: f!.id, cred };
  });

  revalidatePath('/firmi');
  revalidatePath('/', 'layout');
  if (!id) {
    await selectFirm(res.id);
    if (res.cred) return { ok: 'Фирмата е креирана.', cred: { username: res.cred.username, password: res.cred.password, firm: parsed.data.name } };
    redirect('/');
  }
  // „ДДВ обврзник“ changed: the posted invoices / purchases of the open periods are re-posted in the background at once
  // (1200 ↔ 1200009, VAT lines) – the books never keep a mix of the two settings
  if (before && before.vatRegistered !== parsed.data.vatRegistered) {
    const year = Number(todaySkopje().slice(0, 4));
    // a status change during the year (a VAT period of the year already closed / filed, or the books locked): the
    // documents before it stay as they were – only the „Прекнижи“ suggestion, the user decides
    const settled = (await db().select({ x: vatPeriods.id }).from(vatPeriods).where(and(eq(vatPeriods.firmId, id!), lte(vatPeriods.dateFrom, `${year}-12-31`), gte(vatPeriods.dateTo, `${year}-01-01`), or(eq(vatPeriods.status, 'closed'), isNotNull(vatPeriods.submittedAt)))).limit(1)).length > 0
      || (!!parsed.data.lockDate && parsed.data.lockDate >= `${year}-01-01`);
    if (settled) return { ok: 'Фирмата е зачувана.' + await queueRepostChange({ firmIds: [id!], reason: 'manual', year, userId: u.id }) };
    const runId = await db().transaction((tx) => requestRepost(tx, { firmId: id!, userId: u.id, year, forceYear: true })).catch(() => null);
    if (runId && (await sendRepostRuns({ queue: [{ firmId: id!, runId }], due: 0 }))) return { ok: 'Фирмата е зачувана. Книжените фактури се прекнижуваат во позадина според новото „ДДВ обврзник“ (само отворени периоди).' };
  }
  return { ok: 'Фирмата е зачувана.' };
}

/**
 * Legacy `delFirm` (final patch 12794): admin only, two confirmations, backup first. FIX: the server keeps the books
 * (audit, posted journals, files) and archives the firm (`active = false`) instead of deleting every row — it
 * disappears from the lists and the picker and can be restored from „Избришани фирми“.
 */
export async function deleteFirm(_p: FirmFormState, form: FormData): Promise<FirmFormState> {
  const id = String(form.get('id') ?? '');
  const u = await requireCan('delFirm', id);
  if (u.role !== 'admin') return { error: 'Бришење на фирма може само администраторот.' };
  // 🎭 a demo admin deletes only a demo firm (flag + „ДЕМО“ re-checked on the locked row), for good — never a real firm
  if (isDemoUser(u)) {
    try {
      await db().transaction(async (tx) => {
        const r = await deleteDemoFirm(tx as never, id);
        await audit(tx, { userId: u.id, action: 'delFirm', entityType: 'firm', entityId: id, data: { name: r.name, demo: true } });
      });
    } catch (e) {
      if (e instanceof DemoResetError) return { error: e.message };
      throw e;
    }
    const jar = await cookies();
    if (jar.get(FIRM_COOKIE)?.value === id) jar.delete(FIRM_COOKIE);
    revalidatePath('/', 'layout');
    redirect('/firmi');
  }
  await db().transaction(async (tx) => {
    const [b] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, id)).for('update');
    if (!b) throw new Error('Фирмата не постои.');
    // a deactivated firm stops at the current year (`toYear`, unless one is already set) — earlier years keep it
    const settings = fyOnDeactivate((b.settings ?? {}) as Record<string, unknown>, Number(todaySkopje().slice(0, 4)));
    const [f] = await tx.update(firms).set({ active: false, settings }).where(eq(firms.id, id)).returning({ name: firms.name, edb: firms.edb });
    await audit(tx, { userId: u.id, firmId: id, action: 'delFirm', entityType: 'firm', entityId: id, data: { name: f!.name, edb: f!.edb, toYear: settings.toYear } });
  });
  const jar = await cookies();
  if (jar.get(FIRM_COOKIE)?.value === id) jar.delete(FIRM_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/firmi');
}

export async function restoreFirm(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const u = await requireCan('delFirm', id);
  if (u.role !== 'admin' || isDemoUser(u)) return;
  await db().transaction(async (tx) => {
    const [b] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, id)).for('update');
    if (!b) return;
    // the automatic `toYear` of the deactivation goes away again; a typed one stays
    const settings = fyOnRestore((b.settings ?? {}) as Record<string, unknown>);
    await tx.update(firms).set({ active: true, settings }).where(eq(firms.id, id));
    await audit(tx, { userId: u.id, firmId: id, action: 'restoreFirm', entityType: 'firm', entityId: id, data: { toYear: settings.toYear ?? null } });
  });
  revalidatePath('/firmi');
}

/** Legacy `firmUnlock` (17021): admin only; the lock moves back to 31.12 of the previous year. */
export async function unlockFirm(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const u = await requireCan('settings', id);
  if (u.role !== 'admin') return;
  await db().transaction(async (tx) => {
    const [f] = await tx.select({ lock: firms.lockDate, name: firms.name }).from(firms).where(eq(firms.id, id)).limit(1);
    if (!f?.lock) return;
    const nl = unlockTo(f.lock);
    await tx.update(firms).set({ lockDate: nl }).where(eq(firms.id, id));
    await audit(tx, { userId: u.id, firmId: id, action: 'firmUnlock', entityType: 'firm', entityId: id, data: { from: f.lock, to: nl, text: `Отклучен период: ${f.name} → ${nl}` } });
  });
  revalidatePath('/', 'layout');
}

/** Legacy `useFirm`: open the firm and go to the dashboard. */
export async function openFirm(form: FormData): Promise<void> {
  await requireUser();
  await selectFirm(String(form.get('id') ?? ''));
  redirect('/');
}
