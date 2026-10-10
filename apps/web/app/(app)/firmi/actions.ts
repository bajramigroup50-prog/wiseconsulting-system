'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FIRM_VAT_RATES, firmSettingsFrom, unlockTo } from '@wise/core/firms/firmform';
import { audit, firms, type NewFirm } from '@wise/db';
import { createClientProfile, takenUsernames } from '@/lib/client-profiles';
import { can } from '@wise/core';
import { requireCan, requireUser } from '@/lib/auth';
import { FIRM_COOKIE } from '@/lib/context';
import { db } from '@/lib/db';
import { selectFirm } from '../actions';

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
  const v: Partial<NewFirm> = { ...parsed.data, settings: sr.settings };

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
  await db().transaction(async (tx) => {
    const [f] = await tx.update(firms).set({ active: false }).where(eq(firms.id, id)).returning({ name: firms.name, edb: firms.edb });
    if (!f) throw new Error('Фирмата не постои.');
    await audit(tx, { userId: u.id, firmId: id, action: 'delFirm', entityType: 'firm', entityId: id, data: { name: f.name, edb: f.edb } });
  });
  const jar = await cookies();
  if (jar.get(FIRM_COOKIE)?.value === id) jar.delete(FIRM_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/firmi');
}

export async function restoreFirm(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const u = await requireCan('delFirm', id);
  if (u.role !== 'admin') return;
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ active: true }).where(eq(firms.id, id));
    await audit(tx, { userId: u.id, firmId: id, action: 'restoreFirm', entityType: 'firm', entityId: id, data: {} });
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
