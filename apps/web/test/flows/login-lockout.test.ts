/**
 * Login brute-force protection: 5 failures for a username lock it for 15 minutes (same message for unknown
 * usernames), 20 failures from one IP lock the IP, a success resets the username's counter, the lock expires after
 * 15 minutes, the office owner sees the locks and unlocks early; every failure / lock / unlock is audited.
 */
import { and, eq, like } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { hashPassword } from '@wise/db/password';
import { act, form, jar, pg, reqHeaders, setupDb, signIn } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const { login } = await import('@/app/login/actions');
const { unlockLogin } = await import('@/app/(app)/korisnici/actions');
const G = await import('@/lib/login-guard');

const PW = 'Tocna-Lozinka-123';
let ownerId = '';
const T0 = Date.now();
const at = (min: number) => vi.setSystemTime(new Date(T0 + min * 6e4));
let n = 0;
const fresh = () => `korisnik${++n}`;
const fromIp = (ip: string) => reqHeaders.set('x-forwarded-for', ip);
const tryLogin = (username: string, password: string) => act(login('', form({ username, password })));
const auditOf = (action: string) => pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));

async function mkUser(username: string) {
  const [u] = await pg.insert(schema.users).values({ username, name: username, role: 'acc', passwordHash: await hashPassword(PW) }).returning();
  return u!.id;
}

beforeAll(async () => {
  await setupDb();
  ownerId = await signIn('admin', { username: 'sopstvenik' });
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: ownerId, name: 'sopstvenik' } });
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  await pg.delete(schema.appSettings).where(like(schema.appSettings.key, 'loginLock:%'));
  reqHeaders.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('login lockout', () => {
  it('5 failures lock the username; even the right password is refused while locked', async () => {
    const name = fresh(); const id = await mkUser(name);
    fromIp('10.0.0.1');
    for (let i = 1; i <= 4; i++) expect(await tryLogin(name, 'pogresno' + i)).toBe(G.LOGIN_FAIL_MSG);
    expect(await tryLogin(name.toUpperCase(), 'pogresno5')).toBe(G.LOGIN_LOCKED_MSG); // case-insensitive
    expect(await tryLogin(name, PW)).toBe(G.LOGIN_LOCKED_MSG);
    const fails = (await auditOf('loginFail')).filter((r) => r.entityId === id);
    expect(fails).toHaveLength(5);
    expect(fails[0]!.data).toMatchObject({ username: name, ip: '10.0.0.1' });
    const locked = (await auditOf('loginLocked')).filter((r) => r.entityId === id);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.data).toMatchObject({ username: name, ip: '10.0.0.1', scope: 'user' });
  });

  it('the lock expires after 15 minutes', async () => {
    const name = fresh(); await mkUser(name);
    fromIp('10.0.0.2');
    for (let i = 0; i < 5; i++) await tryLogin(name, 'x' + i);
    at(14);
    expect(await tryLogin(name, PW)).toBe(G.LOGIN_LOCKED_MSG);
    at(15.02);
    expect(await tryLogin(name, PW)).toEqual({ redirect: '/' });
  });

  it('a successful login resets the counter', async () => {
    const name = fresh(); await mkUser(name);
    fromIp('10.0.0.3');
    for (let i = 0; i < 4; i++) expect(await tryLogin(name, 'x' + i)).toBe(G.LOGIN_FAIL_MSG);
    expect(await tryLogin(name, PW)).toEqual({ redirect: '/' });
    const [row] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, G.lockKey('u', name)));
    expect(row).toBeUndefined();
    for (let i = 0; i < 4; i++) expect(await tryLogin(name, 'y' + i)).toBe(G.LOGIN_FAIL_MSG);
  });

  it('an unknown username gets the same messages (and is locked the same way)', async () => {
    fromIp('10.0.0.4');
    const ghost = 'nepostoi-' + fresh();
    for (let i = 0; i < 4; i++) expect(await tryLogin(ghost, 'x' + i)).toBe(G.LOGIN_FAIL_MSG);
    expect(await tryLogin(ghost, 'x5')).toBe(G.LOGIN_LOCKED_MSG);
    const f = (await auditOf('loginFail')).filter((r) => (r.data as { username?: string }).username === ghost);
    expect(f).toHaveLength(5);
    expect(f[0]!.userId).toBeNull();
  });

  it('20 failures from one IP (any usernames) lock the IP for every username', async () => {
    fromIp('203.0.113.9');
    const victim = fresh(); await mkUser(victim);
    let last: unknown;
    for (let i = 0; i < 20; i++) last = await tryLogin(`sprej${i}-${n}`, 'x');
    expect(last).toBe(G.LOGIN_LOCKED_MSG);
    expect(await tryLogin(victim, PW)).toBe(G.LOGIN_LOCKED_MSG);
    const ipLock = (await auditOf('loginLocked')).filter((r) => (r.data as { scope?: string; ip?: string }).scope === 'ip');
    expect(ipLock.some((r) => (r.data as { ip: string }).ip === '203.0.113.9')).toBe(true);
    // another IP is not affected
    fromIp('203.0.113.10');
    expect(await tryLogin(victim, PW)).toEqual({ redirect: '/' });
  });

  it('the client IP is the hop set by Caddy (last X-Forwarded-For entry), else X-Real-IP', () => {
    const h = (o: Record<string, string>) => (k: string) => o[k] ?? null;
    expect(G.clientIp(h({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(G.clientIp(h({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('1.2.3.4');
    expect(G.clientIp(h({ 'x-real-ip': '5.5.5.5' }))).toBe('5.5.5.5');
    expect(G.clientIp(h({}))).toBe('unknown');
  });

  it('the owner sees the locks and unlocks early (audited); others cannot', async () => {
    const name = fresh(); await mkUser(name);
    fromIp('10.0.0.6');
    for (let i = 0; i < 5; i++) await tryLogin(name, 'x' + i);
    const L = await G.activeLocks();
    const lock = L.find((l) => l.scope === 'u' && l.id === name)!;
    expect(lock.until).toBe(Date.now() + G.LOCK_MS);

    // another admin (not the owner) is refused
    await signIn('admin');
    expect(await unlockLogin(lock.key)).toEqual({ error: expect.stringContaining('сопственикот') });

    const { createHash, randomBytes } = await import('node:crypto');
    const t = randomBytes(24).toString('base64url');
    await pg.insert(schema.sessions).values({ id: createHash('sha256').update(t).digest('hex'), userId: ownerId, expiresAt: new Date(Date.now() + 864e5) });
    jar.set('wc_sess', t);
    expect(await unlockLogin(lock.key)).toEqual({ ok: 'Отклучено.' });
    expect((await G.activeLocks()).some((l) => l.key === lock.key)).toBe(false);
    const un = await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'loginUnlock'), eq(schema.auditLog.userId, ownerId)));
    expect(un.at(-1)!.data).toMatchObject({ scope: 'user', username: name });
    expect(await tryLogin(name, PW)).toEqual({ redirect: '/' });
  });

  it('old counters are pruned', async () => {
    await G.recordFailure('stari', '10.9.9.9');
    at(60);
    await G.prune();
    const rows = await pg.select().from(schema.appSettings).where(like(schema.appSettings.key, 'loginLock:%'));
    expect(rows).toHaveLength(0);
  });
});
