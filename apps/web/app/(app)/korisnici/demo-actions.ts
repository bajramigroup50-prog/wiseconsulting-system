'use server';
/**
 * 🎭 The office owner's demo controls (Корисници → „🎭 Демо“): create the demo firms + the demo login, reset them,
 * demo links, demo AI and the nightly reset. Owner only (`isOfficeOwner`, never a demo user); every action audited.
 * The demo password and link tokens are shown ONCE on screen and never logged.
 */
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { DEMO_LINK_DAYS, demoPassword } from '@wise/core/demo';
import { audit, demoFirmIds, putDemoSettings, resetDemo, seedDemo, sessions, users } from '@wise/db';
import { hashPassword } from '@wise/db/password';
import { requireUser, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { createDemoLink, demoAdminUser, revokeDemoLink } from '@/lib/demo-links';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { calendarYear } from '@/lib/context';

export interface DemoState { error?: string; ok?: string; password?: string; link?: string }

async function owner(): Promise<SessionUser> {
  const u = await requireUser();
  if (isDemoUser(u) || !(await isOfficeOwner(u))) throw new Error(OWNER_ONLY_MSG);
  return u;
}
const fail = (e: unknown): DemoState => ({ error: e instanceof Error ? e.message : 'Грешка.' });

/** The demo login `demo` (demo admin): created if missing; a new strong password each time it is (re)issued. */
async function issueDemoLogin(by: string): Promise<{ id: string; password: string }> {
  const password = demoPassword((n) => randomBytes(n));
  const passwordHash = await hashPassword(password);
  const [ex] = await db().select({ id: users.id, demo: users.demo }).from(users).where(eq(sql`lower(${users.username})`, 'demo')).limit(1);
  if (ex && !ex.demo) throw new Error('Корисничкото име „demo“ веќе го користи вистински корисник.');
  return db().transaction(async (tx) => {
    let id = ex?.id;
    if (id) {
      await tx.update(users).set({ passwordHash, legacySalt: null, mustChangePassword: false, active: true, role: 'admin', allFirms: false }).where(and(eq(users.id, id), eq(users.demo, true)));
      await tx.delete(sessions).where(eq(sessions.userId, id));
    } else {
      const [n] = await tx.insert(users).values({ username: 'demo', name: 'Демо администратор', role: 'admin', demo: true, allFirms: false, passwordHash, mustChangePassword: false }).returning({ id: users.id });
      id = n!.id;
    }
    await audit(tx, { userId: by, action: 'demoUserSet', entityType: 'user', entityId: id, data: { username: 'demo', demo: true, password: 'issued' } });
    return { id: id!, password };
  });
}

/** „🎭 Креирај демо фирми“: the 3 demo firms + demo office (via the app's services) and the demo login. */
export async function createDemoAction(_p: DemoState, _f: FormData): Promise<DemoState> {
  try {
    const me = await owner();
    if ((await demoFirmIds(db(), { all: true })).length) return { error: 'Демо фирмите веќе постојат – користете „↺ Ресетирај демо“.' };
    const login = await issueDemoLogin(me.id);
    await db().transaction(async (tx) => {
      await seedDemo(tx as never, { adminUserId: login.id, year: calendarYear() });
      await audit(tx, { userId: me.id, action: 'demoSeed', entityType: 'demo' });
    });
    revalidatePath('/korisnici');
    return { ok: 'Демо фирмите се креирани. Корисничко име: demo', password: login.password };
  } catch (e) { return fail(e); }
}

/** „↺ Ресетирај демо“: delete ONLY the demo firms (flag + „ДЕМО“ checked on each, one transaction) and reseed. */
export async function resetDemoAction(_p: DemoState, _f: FormData): Promise<DemoState> {
  try {
    const me = await owner();
    const admin = await demoAdminUser();
    if (!admin) return { error: 'Нема демо корисник – прво „🎭 Креирај демо фирми“.' };
    await resetDemo(db() as never, { adminUserId: admin.id, year: calendarYear() });
    await audit(db(), { userId: me.id, action: 'demoReset', entityType: 'demo' });
    revalidatePath('/korisnici');
    return { ok: 'Демото е ресетирано.' };
  } catch (e) { return fail(e); }
}

/** „🔑 Нова лозинка за demo“: shown once. */
export async function demoPasswordAction(_p: DemoState, _f: FormData): Promise<DemoState> {
  try {
    const me = await owner();
    const login = await issueDemoLogin(me.id);
    revalidatePath('/korisnici');
    return { ok: 'Новата лозинка за „demo“ (се прикажува само сега):', password: login.password };
  } catch (e) { return fail(e); }
}

/** „🔗 Нов демо линк“: the full link is shown ONCE. */
export async function newDemoLinkAction(_p: DemoState, f: FormData): Promise<DemoState> {
  try {
    const me = await owner();
    const days = Number(f.get('days'));
    if (!(DEMO_LINK_DAYS as readonly number[]).includes(days)) return { error: 'Изберете траење.' };
    const note = String(f.get('note') ?? '').trim().slice(0, 200) || null;
    const { token } = await createDemoLink({ days, note, createdBy: me.id });
    const origin = String(f.get('origin') ?? '').replace(/\/+$/, '');
    const base = /^https?:\/\/[^/\s]+$/i.test(origin) ? origin : 'https://app.wiseconsulting.com.mk';
    revalidatePath('/korisnici');
    return { ok: 'Линкот е креиран (се прикажува само сега):', link: `${base}/demo/${token}` };
  } catch (e) { return fail(e); }
}

/** „✕ Откажи“: the link stops at once and its sessions end. */
export async function revokeDemoLinkAction(id: string): Promise<DemoState> {
  try {
    const me = await owner();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Неважечки линк.' };
    await revokeDemoLink(id, me.id);
    revalidatePath('/korisnici');
    return { ok: 'Линкот е откажан.' };
  } catch (e) { return fail(e); }
}

/** Demo AI (off by default; on = under its own monthly cap) and the optional nightly reset at 03:30. */
export async function demoSettingsAction(_p: DemoState, f: FormData): Promise<DemoState> {
  try {
    const me = await owner();
    const lim = Number(String(f.get('aiLimitUsd') ?? '').replace(',', '.'));
    const s = await putDemoSettings(db(), { ai: f.get('ai') === 'on', aiLimitUsd: Number.isFinite(lim) ? lim : undefined, nightly: f.get('nightly') === 'on' }, me.id);
    await audit(db(), { userId: me.id, action: 'demoAiSet', entityType: 'app_settings', entityId: 'demoSettings', data: { ...s } });
    revalidatePath('/korisnici');
    return { ok: 'Зачувано.' };
  } catch (e) { return fail(e); }
}

