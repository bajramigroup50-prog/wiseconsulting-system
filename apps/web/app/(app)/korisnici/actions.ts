'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ROLE_IDS } from '@wise/core';
import { audit, sessions, userFirms, users } from '@wise/db';
import { hashPassword, verifyPassword } from '@wise/db/password';
import { requireCan, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export interface FormState { error?: string; ok?: string }

const MIN_PW = 10;

const UserInput = z.object({
  name: z.string().trim().min(2, 'Внесете име и презиме.').max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._@-]{2,60}$/, 'Корисничкото име: латиница, бројки и . _ - @'),
  email: z.string().trim().max(200).transform((s) => s || null),
  role: z.enum(ROLE_IDS),
  password: z.string(),
  active: z.boolean(),
  allFirms: z.boolean(),
  firms: z.array(z.uuid()),
});

export async function saveUser(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id') ?? '') || null;
  const me = await requireCan(id ? 'uSave' : 'uNew');
  const p = UserInput.safeParse({
    name: form.get('name'), username: form.get('username'), email: form.get('email') ?? '',
    role: form.get('role'), password: form.get('password') ?? '',
    active: form.get('active') === 'on', allFirms: form.get('allFirms') === 'on',
    firms: form.getAll('firms').map(String),
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const v = p.data;
  if (!id && v.password.length < MIN_PW) return { error: `Лозинката мора да има најмалку ${MIN_PW} знаци.` };
  if (id && v.password && v.password.length < MIN_PW) return { error: `Лозинката мора да има најмалку ${MIN_PW} знаци.` };
  if (id === me.id && (v.role !== 'admin' || !v.active)) return { error: 'Не можете да си ја одземете администраторската улога или да се деактивирате.' };

  const [dupe] = await db().select({ id: users.id }).from(users)
    .where(and(eq(sql`lower(${users.username})`, v.username), id ? ne(users.id, id) : undefined)).limit(1);
  if (dupe) return { error: 'Корисничкото име е зафатено.' };

  await db().transaction(async (tx) => {
    const base = { name: v.name, username: v.username, email: v.email, role: v.role, active: v.active, allFirms: v.allFirms };
    let uid = id;
    if (id) {
      await tx.update(users).set({
        ...base,
        ...(v.password ? { passwordHash: await hashPassword(v.password), legacySalt: null, mustChangePassword: true } : {}),
      }).where(eq(users.id, id));
      // Role, status or password change → sign the user out everywhere.
      if (v.password || !v.active) await tx.delete(sessions).where(eq(sessions.userId, id));
    } else {
      const [n] = await tx.insert(users).values({ ...base, passwordHash: await hashPassword(v.password), mustChangePassword: true })
        .returning({ id: users.id });
      uid = n!.id;
    }
    await tx.delete(userFirms).where(eq(userFirms.userId, uid!));
    if (!v.allFirms && v.firms.length) await tx.insert(userFirms).values(v.firms.map((firmId) => ({ userId: uid!, firmId })));
    await audit(tx, {
      userId: me.id, action: id ? 'uSave' : 'uNew', entityType: 'user', entityId: uid!,
      data: { username: v.username, role: v.role, active: v.active, allFirms: v.allFirms, firms: v.firms.length, passwordChanged: !!v.password },
    });
  });
  revalidatePath('/korisnici');
  redirect('/korisnici');
}

export async function deleteUser(id: string): Promise<void> {
  const me = await requireCan('uDel');
  if (id === me.id) throw new Error('Не можете да се избришете себеси.');
  await db().transaction(async (tx) => {
    const [u] = await tx.delete(users).where(eq(users.id, id)).returning({ username: users.username });
    if (u) await audit(tx, { userId: me.id, action: 'uDel', entityType: 'user', entityId: id, data: { username: u.username } });
  });
  revalidatePath('/korisnici');
}

export async function changeMyPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
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
