'use server';
/** 🔐 Хyрjа во 2 чекори on „Мојот профил“: turn on (QR → code → recovery codes), off, and the administrator's controls. */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { brandName } from '@wise/core';
import { qrDataUrl } from '@wise/core/sales';
import { audit, mfaBegin, mfaCheck, mfaConfirm, mfaOff, mfaState, otpauthUri, setMfaRequired, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';

export interface MfaSetup { error?: string; ok?: string; secret?: string; qr?: string; codes?: string[] }

export async function mfaBeginAction(): Promise<MfaSetup> {
  const u = await requireUser();
  if (u.principal.demo) return { error: 'Не е достапно во демо.' };
  const secret = await db().transaction((tx) => mfaBegin(tx, u.id));
  const uri = otpauthUri(brandName(), u.username, secret);
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr: qrDataUrl(uri, 5) };
}

export async function mfaConfirmAction(_p: MfaSetup, f: FormData): Promise<MfaSetup> {
  const u = await requireUser();
  const codes = await db().transaction((tx) => mfaConfirm(tx, u.id, String(f.get('code') ?? '')));
  if (!codes) return { ...(_p ?? {}), error: 'Погрешен код – внесете го кодот што сега го покажува апликацијата.' };
  revalidatePath('/lozinka');
  return { ok: 'Хyрjата во 2 чекори е вклучена.', codes };
}

/** Off by the user: needs a current code (or a recovery code), so a forgotten open session cannot turn it off. */
export async function mfaOffAction(_p: MfaSetup, f: FormData): Promise<MfaSetup> {
  const u = await requireUser();
  const ok = await db().transaction((tx) => mfaCheck(tx, u.id, String(f.get('code') ?? '')));
  if (!ok) return { error: 'Погрешен код.' };
  await db().transaction((tx) => mfaOff(tx, u.id, u.id));
  revalidatePath('/lozinka');
  return { ok: 'Исклучено.' };
}

async function admin() {
  const u = await requireUser();
  if (u.role !== 'admin' || u.principal.demo) throw new Error('Само администраторот.');
  return u;
}

export async function mfaRequiredAction(on: boolean): Promise<{ ok?: string; error?: string }> {
  try {
    const u = await admin();
    await db().transaction(async (tx) => {
      await setMfaRequired(tx, on, u.id);
      await audit(tx, { userId: u.id, action: 'mfaRequired', data: { on } });
    });
    revalidatePath('/lozinka');
    return { ok: on ? 'Задолжително за канцеларијата.' : 'Не е задолжително.' };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Грешка.' }; }
}

/** Lost phone: the administrator turns a colleague's 2nd step off (they turn it on again with a new QR). */
export async function mfaResetAction(userId: string): Promise<{ ok?: string; error?: string }> {
  try {
    const u = await admin();
    if (!isUuid(userId)) return { error: 'Непознат корисник.' };
    const [c] = await db().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    if (!c) return { error: 'Непознат корисник.' };
    if (!(await mfaState(db(), userId)).on) return { error: `${c.name} нема вклучено.` };
    await db().transaction((tx) => mfaOff(tx, userId, u.id));
    revalidatePath('/lozinka');
    return { ok: `${c.name}: исклучено – нека го вклучи повторно со нов QR.` };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Грешка.' }; }
}
