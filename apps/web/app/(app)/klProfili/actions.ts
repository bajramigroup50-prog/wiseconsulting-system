'use server';
/** Legacy ACT `klAutoAllB` / `klPwReset` / `klRenameNum` (ACT_NEED `users`). Passwords are returned once, never stored. */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import type { KlCred } from '@wise/core/firms/klprofili';
import { firms, userFirms, users } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import { createClientProfile, firmsWithClient, resetClientProfile, takenUsernames } from '@/lib/client-profiles';
import { db } from '@/lib/db';
import { allowedFirms } from '@/lib/office';

export interface CredResult { error?: string; ok?: string; creds?: KlCred[] }

const fail = (e: unknown): CredResult => {
  if (e instanceof Forbidden) return { error: 'Само администраторот креира профили.' };
  if (e instanceof Error && /клиенти/.test(e.message)) return { error: e.message };
  throw e;
};

/** Legacy `klAutoAll`: a profile for every active firm without one. */
export async function createAllProfiles(): Promise<CredResult> {
  try {
    const u = await requireCan('users');
    const F = await allowedFirms(u);
    const creds = await db().transaction(async (tx) => {
      const has = await firmsWithClient(tx);
      const used = await takenUsernames(tx);
      const out: KlCred[] = [];
      for (const f of F) {
        if (has.has(f.id)) continue;
        const c = await createClientProfile(tx, f, used, u.id);
        if (c) out.push(c);
      }
      return out;
    });
    revalidatePath('/klProfili');
    return { ok: `Креирани ${creds.length} профили.`, creds };
  } catch (e) { return fail(e); }
}

async function firmOfClient(userId: string) {
  const [r] = await db().select({ name: firms.name, edb: firms.edb, settings: firms.settings }).from(userFirms)
    .innerJoin(firms, eq(firms.id, userFirms.firmId)).where(eq(userFirms.userId, userId)).limit(1);
  return r ? { name: r.name, edb: r.edb, short: (r.settings as { short?: string }).short ?? null } : null;
}

/** Legacy `klPwReset`. */
export async function resetPassword(userId: string): Promise<CredResult> {
  try {
    const u = await requireCan('users');
    const [x] = await db().select({ name: users.name }).from(users).where(and(eq(users.id, userId), eq(users.role, 'klient'))).limit(1);
    if (!x) return { error: 'Лозинка се менува само на профили на клиенти.' };
    const f = (await firmOfClient(userId)) ?? { name: x.name, edb: null };
    const c = await db().transaction(async (tx) => resetClientProfile(tx, userId, u.id, false, new Set(), f));
    revalidatePath('/klProfili');
    return { ok: `Нова лозинка за ${c.username}.`, creds: [c] };
  } catch (e) { return fail(e); }
}

/** Legacy `klRenameNum`: profiles with a sequence-number username get a random username and a new password. */
export async function renameNumeric(): Promise<CredResult> {
  try {
    const u = await requireCan('users');
    const L = (await db().select({ id: users.id, username: users.username, name: users.name }).from(users).where(eq(users.role, 'klient')))
      .filter((x) => /^\d+$/.test(x.username));
    if (!L.length) return { ok: 'Нема профили со реден број.' };
    const creds = await db().transaction(async (tx) => {
      const used = await takenUsernames(tx);
      const out: KlCred[] = [];
      for (const x of L) out.push(await resetClientProfile(tx, x.id, u.id, true, used, (await firmOfClient(x.id)) ?? { name: x.name, edb: null }));
      return out;
    });
    revalidatePath('/klProfili');
    return { ok: `✓ Променети ${creds.length} профили – печатете ги новите пристапни податоци.`, creds };
  } catch (e) { return fail(e); }
}
