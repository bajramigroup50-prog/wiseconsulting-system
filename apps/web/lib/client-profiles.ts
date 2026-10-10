import 'server-only';
/**
 * Client-portal profiles (legacy `klAutoUser` 9163 / `klResetPw` 9165): one `klient` user per firm with a random
 * username and a strong temporary password, changed at the first login. FIX: passwords are never stored in clear
 * (legacy kept `pw0` to show it later) — they are shown once, when created or reset, with a print button.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { klStrongPw, klUserName, type KlCred, type Rnd } from '@wise/core/firms/klprofili';
import { audit, sessions, userFirms, users, type Firm, type Tx } from '@wise/db';
import { hashPassword } from '@wise/db/password';

export const cryptoRnd: Rnd = (n) => { const b = randomBytes(4 * n); return Array.from({ length: n }, (_, i) => b.readUInt32LE(4 * i)); };

/** Lower-case usernames already taken. */
export async function takenUsernames(tx: Tx): Promise<Set<string>> {
  return new Set((await tx.select({ u: sql<string>`lower(${users.username})` }).from(users)).map((r) => r.u));
}

/** Firm ids that already have a client profile. */
export async function firmsWithClient(tx: Tx, firmIds?: readonly string[]): Promise<Set<string>> {
  const R = await tx.select({ f: userFirms.firmId }).from(userFirms).innerJoin(users, eq(users.id, userFirms.userId))
    .where(and(eq(users.role, 'klient'), firmIds?.length ? inArray(userFirms.firmId, [...firmIds]) : undefined));
  return new Set(R.map((r) => r.f));
}

/** Legacy `klAutoUser`: create the firm's client profile unless it has one. `used` is updated. */
export async function createClientProfile(tx: Tx, f: Pick<Firm, 'id' | 'name' | 'edb' | 'settings'>, used: Set<string>, byUserId: string): Promise<KlCred | null> {
  if ((await firmsWithClient(tx, [f.id])).has(f.id)) return null;
  const short = (f.settings as { short?: string } | null)?.short ?? null;
  const username = klUserName({ name: f.name, short }, used, cryptoRnd);
  used.add(username);
  const password = klStrongPw(cryptoRnd);
  const [u] = await tx.insert(users).values({ username, name: f.name, role: 'klient', passwordHash: await hashPassword(password), mustChangePassword: true })
    .returning({ id: users.id });
  await tx.insert(userFirms).values({ userId: u!.id, firmId: f.id });
  await audit(tx, { userId: byUserId, firmId: f.id, action: 'klAutoUser', entityType: 'user', entityId: u!.id, data: { username } });
  return { firm: f.name, edb: f.edb, username, password };
}

/** Legacy `klResetPw` (+ `klRenameNum` when `rename`): new password (and username), every session signed out. */
export async function resetClientProfile(tx: Tx, userId: string, byUserId: string, rename: boolean, used: Set<string>, firm: { name: string; edb: string | null; short?: string | null }): Promise<KlCred> {
  const password = klStrongPw(cryptoRnd);
  const patch: Partial<typeof users.$inferInsert> = { passwordHash: await hashPassword(password), legacySalt: null, mustChangePassword: true };
  if (rename) { patch.username = klUserName(firm, used, cryptoRnd); used.add(patch.username); }
  const [u] = await tx.update(users).set(patch).where(and(eq(users.id, userId), eq(users.role, 'klient'))).returning({ username: users.username });
  if (!u) throw new Error('Лозинка се менува само на профили на клиенти.');
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await audit(tx, { userId: byUserId, action: rename ? 'klRenameNum' : 'klPwReset', entityType: 'user', entityId: userId, data: { username: u.username } });
  return { firm: firm.name, edb: firm.edb, username: u.username, password };
}
