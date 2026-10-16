'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ROLE_IDS } from '@wise/core';
import { audit, demoFirmIds, fileLinks, files, getOfficeProfile, patchOfficeZz, sessions, userFirms, users } from '@wise/db';
import { can } from '@wise/core';
import { zzIzjNext } from '@wise/core/office';
import { hashPassword } from '@wise/db/password';
import { requireCan } from '@/lib/auth';
import { db } from '@/lib/db';
import { unlock as unlockLock } from '@/lib/login-guard';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';
import { grantableViews } from '@/lib/nav-access';
import { viewAccessClean, type ViewAccess } from '@/lib/route-guard';
import { bookOnlySetting, putBookOnlySetting } from '@/lib/view-access';
import { menuStyleIn, putMenuStyle } from '@/lib/menu-style';

import { todayIso } from '@/lib/fmt';
export interface FormState { error?: string; ok?: string }

const MIN_PW = 10;

const UserInput = z.object({
  name: z.string().trim().min(2, 'Внесете име и презиме.').max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._@-]{3,60}$/, 'Корисничкото име: најмалку 3 знаци, латиница/бројки без празни места.'),
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
    role: form.get('role'), password: form.get('pwNew') ?? '',
    active: form.get('active') === 'on', allFirms: form.get('allFirms') === 'on',
    firms: form.getAll('firms').map(String),
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const v = p.data;
  if (v.password !== String(form.get('pwNew2') ?? '')) return { error: 'Лозинката и потврдата не се исти.' };
  if (!id && v.password.length < MIN_PW) return { error: `Лозинката мора да има најмалку ${MIN_PW} знаци.` };
  if (id && v.password && v.password.length < MIN_PW) return { error: `Лозинката мора да има најмалку ${MIN_PW} знаци.` };
  if (id === me.id && (v.role !== 'admin' || !v.active)) return { error: 'Не можете да си ја одземете администраторската улога или да се деактивирате.' };

  // 🎭 demo: a demo admin manages only demo users (every user it creates is demo, with the demo firms only) and never
  // touches a real user; the „🎭 Демо корисник“ flag is set only by the office owner (never on themselves)
  const meDemo = isDemoUser(me);
  const [target] = id ? await db().select({ demo: users.demo }).from(users).where(eq(users.id, id)).limit(1) : [];
  if (id && !target) return { error: 'Корисникот не постои.' };
  if (meDemo && target && !target.demo) return { error: DEMO_OFF_MSG };
  const owner = !meDemo && await isOfficeOwner(me);
  const demo = meDemo ? true : owner && id !== me.id ? form.get('demo') === 'on' : target?.demo ?? false;
  const allFirms = demo ? false : v.allFirms;
  const demoIds = demo ? new Set(await demoFirmIds(db())) : null;
  const firmSel = demoIds ? v.firms.filter((f) => demoIds.has(f)) : v.firms;
  // 🔒 „Пристап до менија“: set only by the office owner, for a colleague (never the owner, a demo, client or field user)
  const [prevAcc] = id ? await db().select({ a: users.viewAccess }).from(users).where(eq(users.id, id)).limit(1) : [];
  const accRaw = owner && id !== me.id && !demo && v.role !== 'klient' && v.role !== 'teren' && form.has('viewMode') ? accessFromForm(form) : null;
  if (accRaw && 'error' in accRaw) return { error: accRaw.error };
  const accessIn: ViewAccess | null = accRaw;
  const accessChanged = !!accessIn && JSON.stringify(viewAccessClean(prevAcc?.a)) !== JSON.stringify(accessIn);

  const [dupe] = await db().select({ id: users.id }).from(users)
    .where(and(eq(sql`lower(${users.username})`, v.username), id ? ne(users.id, id) : undefined)).limit(1);
  if (dupe) return { error: 'Корисничкото име веќе постои.' };
  // legacy `uSave`: the program must keep at least one active administrator
  // (counted among the real users — a demo admin never keeps the program administered; for a demo admin: among demo users)
  if (id && (v.role !== 'admin' || !v.active || (demo && !target!.demo))) {
    const [o] = await db().select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id), eq(users.demo, meDemo)));
    if (!o?.n) return { error: 'Мора да остане барем еден активен администратор.' };
  }

  await db().transaction(async (tx) => {
    const base = { name: v.name, username: v.username, email: v.email, role: v.role, active: v.active, allFirms, demo, ...(accessIn ? { viewAccess: accessIn } : {}) };
    let uid = id;
    if (id) {
      await tx.update(users).set({
        ...base,
        // a 🎭 demo login's password set by the owner is ready to hand to the buyer (no forced change)
        ...(v.password ? { passwordHash: await hashPassword(v.password), legacySalt: null, mustChangePassword: !demo } : {}),
      }).where(eq(users.id, id));
      // Role, status or password change → sign the user out everywhere.
      if (v.password || !v.active || demo !== target!.demo) await tx.delete(sessions).where(eq(sessions.userId, id));
    } else {
      const [n] = await tx.insert(users).values({ ...base, passwordHash: await hashPassword(v.password), mustChangePassword: true })
        .returning({ id: users.id });
      uid = n!.id;
    }
    await tx.delete(userFirms).where(eq(userFirms.userId, uid!));
    if (!allFirms && firmSel.length) await tx.insert(userFirms).values(firmSel.map((firmId) => ({ userId: uid!, firmId })));
    if (demo !== (target?.demo ?? false) && !meDemo) await audit(tx, { userId: me.id, action: 'demoUserSet', entityType: 'user', entityId: uid!, data: { username: v.username, demo } });
    if (accessChanged && accessIn) {
      const before = viewAccessClean(prevAcc?.a);
      await audit(tx, {
        userId: me.id, action: 'userViewsSet', entityType: 'user', entityId: uid!,
        data: {
          username: v.username, mode: accessIn.mode, before: before.mode,
          ...(accessIn.mode === 'custom' ? { views: accessIn.views.length, added: accessIn.views.filter((x) => !before.views.includes(x)), removed: before.views.filter((x) => !accessIn.views.includes(x)) } : {}),
        },
      });
    }
    await audit(tx, {
      userId: me.id, action: id ? 'uSave' : 'uNew', entityType: 'user', entityId: uid!,
      data: { username: v.username, role: v.role, active: v.active, allFirms, firms: firmSel.length, passwordChanged: !!v.password, ...(demo ? { demo } : {}) },
    });
  });
  revalidatePath('/korisnici');
  redirect('/korisnici?saved=1');
}

/** The form's „Пристап до менија“: `viewMode` = book / full / custom, `views` = the ticked views (custom only, grantable only). */
function accessFromForm(form: FormData): ViewAccess | { error: string } {
  const mode = String(form.get('viewMode') ?? 'book');
  if (mode !== 'book' && mode !== 'full' && mode !== 'custom') return { error: 'Неважечки пристап до менија.' };
  if (mode !== 'custom') return { mode, views: [] };
  const G = grantableViews();
  const views = [...new Set(form.getAll('views').map(String))].filter((x) => G.has(x)).sort();
  return { mode, views };
}

/**
 * „🔒 Колегите гледаат само сметководство“ (the office setting, ON by default): only the office owner switches it.
 * Audited. The owner is never restricted by it (`lib/route-guard.ts` `restrictedViews`).
 */
export async function setBookOnlyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireCan('users');
  if (isDemoUser(me) || !(await isOfficeOwner(me))) return { error: OWNER_ONLY_MSG };
  const on = form.get('on') === 'on';
  const before = await bookOnlySetting(db());
  if (before === on) return { ok: 'Без промена.' };
  await db().transaction(async (tx) => {
    await putBookOnlySetting(tx, on, me.id);
    await audit(tx, { userId: me.id, action: 'bookOnlySet', entityType: 'app_settings', data: { on, text: `Колегите гледаат само сметководство: ${on ? 'вклучено' : 'исклучено'}` } });
  });
  revalidatePath('/', 'layout');
  return { ok: on ? '✓ Вклучено: колегите гледаат само сметководство.' : '✓ Исклучено: колегите гледаат сè според улогата.' };
}

export async function deleteUser(id: string): Promise<FormState> {
  const me = await requireCan('uDel');
  if (id === me.id) return { error: 'Не можете да се избришете себеси.' };
  // 🎭 a demo admin deletes only demo users
  const meDemo = isDemoUser(me);
  const [t] = await db().select({ demo: users.demo }).from(users).where(eq(users.id, id)).limit(1);
  if (!t) return {};
  if (meDemo && !t.demo) return { error: DEMO_OFF_MSG };
  const [o] = await db().select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id), eq(users.demo, meDemo)));
  if (!o?.n) return { error: 'Мора да остане барем еден активен администратор.' };
  await db().transaction(async (tx) => {
    const [u] = await tx.delete(users).where(meDemo ? and(eq(users.id, id), eq(users.demo, true)) : eq(users.id, id)).returning({ username: users.username });
    if (u) await audit(tx, { userId: me.id, action: 'uDel', entityType: 'user', entityId: id, data: { username: u.username } });
  });
  revalidatePath('/korisnici');
  return {};
}

/**
 * Legacy `zzIzjSign` / `zzIzjUp` (15464–15468, ACT_NEED `users`): a colleague's confidentiality statement (ЗЗЛП) —
 * „✓ Потпишана“ / „↺“ (undo only with `del`, „Само одговорното лице може да врати.“) or the scanned signed copy
 * (📎, also marks it signed). The checklist item „iz“ follows: done once every colleague signed.
 */
export async function zzIzj(uid: string, fileId: string | null = null): Promise<FormState> {
  const me = await requireCan('users');
  // 🎭 the confidentiality statements are the real office's ЗЗЛП register
  if (isDemoUser(me)) return { error: DEMO_OFF_MSG };
  const [t] = await db().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, uid)).limit(1);
  if (!t) return { error: 'Корисникот не постои.' };
  let file: { id: string; name: string } | null = null;
  if (fileId) {
    const [f] = await db().select({ id: files.id, name: files.name }).from(files).where(and(eq(files.id, fileId), eq(files.status, 'ready'))).limit(1);
    if (!f) return { error: 'Датотеката не е пронајдена.' };
    file = f;
  }
  const res = await db().transaction(async (tx) => {
    const O = await getOfficeProfile(tx);
    const coll = (await tx.select({ id: users.id }).from(users).where(and(eq(users.active, true), ne(users.role, 'klient'), ne(users.role, 'admin')))).map((x) => x.id);
    const r = zzIzjNext(O.zzlp?.izj ?? {}, uid, file ? { file } : { toggle: true }, todayIso(), me.name, coll);
    if (r.undo && !can(me.principal, 'del')) return { error: 'Само одговорното лице може да врати.' };
    await patchOfficeZz(tx, 'izj', { [uid]: r.izj }, me.id);
    await patchOfficeZz(tx, 'chk', { iz: r.iz }, me.id);
    if (file) await tx.insert(fileLinks).values({ fileId: file.id, entityType: 'user', entityId: uid, role: 'izjava' }).onConflictDoNothing();
    await audit(tx, { userId: me.id, action: file ? 'zzIzjUp' : 'zzIzjSign', entityType: 'user', entityId: uid, data: { text: 'Изјава за доверливост ' + (r.undo ? 'вратена' : 'потпишана') + ': ' + t.name, ...(file ? { fileId: file.id } : {}) } });
    return { ok: file ? '✓ Потпишаната изјава е зачувана.' : r.undo ? 'Вратено.' : '✓ Потпишана.' };
  });
  revalidatePath('/korisnici');
  revalidatePath('/zzlp');
  return res;
}

/** „🔓 Отклучи“: the office owner lifts a login lock (username or IP) before its 15 minutes end. Audited. */
export async function unlockLogin(key: string): Promise<FormState> {
  const me = await requireCan('users');
  if (!(await isOfficeOwner(me))) return { error: OWNER_ONLY_MSG };
  const L = await unlockLock(String(key));
  if (!L) return { error: 'Заклучувањето веќе истече.' };
  const data = L.scope === 'ip' ? { scope: 'ip', ip: L.id } : { scope: 'user', username: L.id };
  await audit(db(), { userId: me.id, action: 'loginUnlock', entityType: 'user', data });
  revalidatePath('/', 'layout');
  return { ok: 'Отклучено.' };
}

/**
 * P40 „Мени: класично / ново“ for a user, set by the office owner (any office user) — or by a 🎭 demo admin for a demo
 * user only. It arranges the menu only; the access rules are the same in both menus. Not for klient / teren (fixed menus).
 */
export async function setUserMenuStyle(userId: string, style: string): Promise<FormState> {
  const me = await requireCan('uSave');
  const s = menuStyleIn(style);
  if (!s) return { error: 'Непознат избор.' };
  const [t] = await db().select({ id: users.id, role: users.role, demo: users.demo, username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  if (!t) return { error: 'Корисникот не постои.' };
  if (t.role === 'klient' || t.role === 'teren') return { error: 'Менито на клиент / теренски корисник е секогаш исто.' };
  if (isDemoUser(me)) { if (!t.demo) return { error: DEMO_OFF_MSG }; }
  else if (!(await isOfficeOwner(me))) return { error: OWNER_ONLY_MSG };
  await db().transaction(async (tx) => {
    await putMenuStyle(tx, t.id, s, me.id);
    await audit(tx, { userId: me.id, action: 'uMenuStyle', entityType: 'user', entityId: t.id, data: { username: t.username, style: s } });
  });
  revalidatePath('/', 'layout');
  return { ok: `${t.username}: мени ${s === 'new' ? 'ново' : 'класично'}.` };
}
