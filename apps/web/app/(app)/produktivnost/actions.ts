'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { appSettings, audit, users } from '@wise/db';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';
import { OFFICE_OWNER_KEY, OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

/** „Пренеси сопственост“: only the current owner hands the office over to another active administrator (audited). */
export async function transferOwner(_prev: RowResult, form: FormData): Promise<RowResult> {
  const u = await requireUser();
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  const to = String(form.get('to') ?? '');
  if (!isUuid(to) || to === u.id) return { error: 'Изберете друг администратор.' };
  if (!form.get('ok')) return { error: 'Потврдете го преносот.' };
  const [t] = await db().select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, to), eq(users.active, true), eq(users.role, 'admin'))).limit(1);
  if (!t) return { error: 'Сопственик може да биде само активен администратор.' };
  await db().transaction(async (tx) => {
    const value = { id: t.id, name: t.name, at: new Date().toISOString(), by: u.id };
    await tx.insert(appSettings).values({ key: OFFICE_OWNER_KEY, value, updatedBy: u.id })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: u.id, updatedAt: new Date() } });
    await audit(tx, { userId: u.id, action: 'ownerSet', entityType: 'app_settings', entityId: OFFICE_OWNER_KEY, data: { from: u.id, to: t.id, name: t.name } });
  });
  revalidatePath('/', 'layout');
  return { ok: `Сопственик на канцеларијата сега е ${t.name}.` };
}
