'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { firms } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { FIRM_COOKIE, YEAR_COOKIE } from '@/lib/context';
import { db } from '@/lib/db';

const base = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' };
/**
 * Firm and year are browser-session cookies (no Max-Age), cleared again at every login: the app always starts at the
 * year screen → firm list, never in the last firm / year.
 */
const opts = base;
const firmOpts = base;

export async function selectFirm(id: string): Promise<void> {
  const u = await requireUser();
  const [f] = await db().select({ id: firms.id, ownerId: firms.ownerId }).from(firms).where(eq(firms.id, id)).limit(1);
  if (!f || !firmAllowed(u.principal, f.id, f.ownerId)) throw new Error('Немате пристап до оваа фирма.');
  (await cookies()).set(FIRM_COOKIE, f.id, firmOpts);
  revalidatePath('/', 'layout');
}

export async function setYear(year: number): Promise<void> {
  await requireUser();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
  (await cookies()).set(YEAR_COOKIE, String(year), opts);
  revalidatePath('/', 'layout');
}
