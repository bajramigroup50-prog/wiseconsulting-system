'use server';
/** „Мојот профил“ — the own password change (its own file: every signed-in user may call it, 🔒 book-only colleagues too). */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit, users } from '@wise/db';
import { hashPassword, verifyPassword } from '@wise/db/password';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';

export interface FormState { error?: string; ok?: string }

const MIN_PW = 10;

export async function changeMyPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  // 🎭 the shared demo login keeps its password (the owner sets it)
  if (isDemoUser(me)) return { error: DEMO_OFF_MSG };
  const old = String(form.get('old') ?? ''), pw = String(form.get('new') ?? ''), pw2 = String(form.get('new2') ?? '');
  if (pw.length < MIN_PW) return { error: `Новата лозинка мора да има најмалку ${MIN_PW} знаци.` };
  if (pw !== pw2) return { error: 'Лозинките не се исти.' };
  if (pw === old) return { error: 'Новата лозинка мора да е различна од старата.' };
  const [u] = await db().select().from(users).where(eq(users.id, me.id)).limit(1);
  if (!u || !(await verifyPassword(u.passwordHash, old, u.legacySalt)).ok) return { error: 'Сегашната лозинка не е точна.' };
  await db().transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(pw), legacySalt: null, mustChangePassword: false }).where(eq(users.id, me.id));
    await audit(tx, { userId: me.id, action: 'uMyPass', entityType: 'user', entityId: me.id });
  });
  revalidatePath('/', 'layout');
  return { ok: 'Лозинката е променета.' };
}
