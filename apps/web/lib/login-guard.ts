import 'server-only';
/**
 * Login brute-force protection (lockout only, no 2FA):
 * - 5 consecutive failed logins for the same username (case-insensitive, existing or not) lock it for 15 minutes;
 * - 20 failed logins from one client IP (any usernames) within 15 minutes lock that IP for 15 minutes;
 * - a successful login resets the username's counter (never the IP's — one valid account must not reset a spray).
 * Counters live in `app_settings` (survive restarts), one row per key `loginLock:u:<username>` / `loginLock:ip:<ip>`,
 * value {@link LockState}; rows idle longer than the window are pruned on every attempt.
 * The office owner sees the active locks (🔒 in the top bar, Систем → Корисници) and can unlock early.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { appSettings } from '@wise/db';
import { db } from './db';

export const USER_MAX_FAILS = 5;
export const IP_MAX_FAILS = 20;
export const LOCK_MS = 15 * 6e4;
export const WINDOW_MS = 15 * 6e4;

export const LOGIN_FAIL_MSG = 'Погрешно корисничко име или лозинка.';
export const LOGIN_LOCKED_MSG = 'Премногу неуспешни обиди. Обидете се повторно за 15 минути.';

export const LOCK_PREFIX = 'loginLock:';
export type LockScope = 'u' | 'ip';
/** `n` failures since `first` (ms), the last at `last`; `until` = locked until (ms), else null. */
export interface LockState { n: number; first: number; last: number; until: number | null }

export const lockKey = (scope: LockScope, id: string) => `${LOCK_PREFIX}${scope}:${id.slice(0, 80)}`;

/**
 * Client IP behind Caddy: `reverse_proxy app:3000` (Caddy ≥ 2.5, no `trusted_proxies`) drops any client-sent
 * X-Forwarded-For and sets it to the TCP peer address, so the header holds exactly one trustworthy value. The last
 * entry is taken (the hop our own proxy appended) so a forged prefix could never be chosen even if a trusted proxy is
 * added later; then X-Real-IP; else 'unknown' (all such requests share one IP bucket).
 */
export function clientIp(get: (name: string) => string | null | undefined): string {
  const xff = get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
  const ip = xff?.length ? xff[xff.length - 1]! : get('x-real-ip')?.trim();
  return (ip || 'unknown').slice(0, 64);
}

const read = (v: unknown): LockState | null => {
  const o = v as Partial<LockState> | null;
  return o && typeof o.n === 'number' ? { n: o.n, first: Number(o.first) || 0, last: Number(o.last) || 0, until: typeof o.until === 'number' ? o.until : null } : null;
};

/** Locked until (ms) for the username / the IP, or null. */
export async function lockedUntil(username: string, ip: string, now = Date.now()): Promise<number | null> {
  const R = await db().select({ k: appSettings.key, v: appSettings.value }).from(appSettings)
    .where(inArray(appSettings.key, [lockKey('u', username), lockKey('ip', ip)]));
  const until = R.map((r) => read(r.v)?.until ?? 0).filter((t) => t > now);
  return until.length ? Math.max(...until) : null;
}

/** One more failure for the key; returns the new state and whether this failure set the lock. */
async function bump(scope: LockScope, id: string, max: number, now: number): Promise<{ s: LockState; locked: boolean }> {
  const key = lockKey(scope, id);
  return db().transaction(async (tx) => {
    await tx.insert(appSettings).values({ key, value: { n: 0, first: now, last: now, until: null } }).onConflictDoNothing();
    const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).for('update');
    const old = read(r?.v);
    // a finished lock, or a quiet window, starts the count again
    // (username: consecutive failures, none for a window; IP: failures within a window from the first one)
    const fresh = !old || (old.until != null ? old.until <= now : now - (scope === 'ip' ? old.first : old.last) > WINDOW_MS);
    const s: LockState = fresh ? { n: 1, first: now, last: now, until: null } : { ...old, n: old.n + 1, last: now };
    const locked = s.until == null && s.n >= max;
    if (locked) s.until = now + LOCK_MS;
    await tx.update(appSettings).set({ value: s }).where(eq(appSettings.key, key));
    return { s, locked };
  });
}

export interface FailResult { lockedUser: boolean; lockedIp: boolean; userFails: number; ipFails: number }

/** Records a failed login for the username and the IP. */
export async function recordFailure(username: string, ip: string, now = Date.now()): Promise<FailResult> {
  await prune(now);
  const u = await bump('u', username, USER_MAX_FAILS, now);
  const i = await bump('ip', ip, IP_MAX_FAILS, now);
  return { lockedUser: u.locked, lockedIp: i.locked, userFails: u.s.n, ipFails: i.s.n };
}

/** Successful login: the username's counter is cleared. */
export async function resetUser(username: string): Promise<void> {
  await db().delete(appSettings).where(eq(appSettings.key, lockKey('u', username)));
}

/** Rows with no failure and no lock within the window are dropped. */
export async function prune(now = Date.now()): Promise<void> {
  await db().delete(appSettings).where(and(like(appSettings.key, `${LOCK_PREFIX}%`),
    sql`greatest(coalesce((${appSettings.value}->>'last')::bigint, 0), coalesce((${appSettings.value}->>'until')::bigint, 0)) < ${now - WINDOW_MS}`));
}

export interface ActiveLock { key: string; scope: LockScope; id: string; until: number; n: number }

/** Locks in force now (username and IP), soonest expiry first. */
export async function activeLocks(now = Date.now()): Promise<ActiveLock[]> {
  const R = await db().select({ k: appSettings.key, v: appSettings.value }).from(appSettings).where(like(appSettings.key, `${LOCK_PREFIX}%`));
  return R.flatMap((r) => {
    const s = read(r.v);
    if (!s?.until || s.until <= now) return [];
    const rest = r.k.slice(LOCK_PREFIX.length);
    const scope: LockScope = rest.startsWith('ip:') ? 'ip' : 'u';
    return [{ key: r.k, scope, id: rest.slice(scope.length + 1), until: s.until, n: s.n }];
  }).sort((a, b) => a.until - b.until);
}

/** Owner's early unlock: the row goes (the counter starts from zero). Returns the removed lock, or null. */
export async function unlock(key: string): Promise<ActiveLock | null> {
  if (!key.startsWith(LOCK_PREFIX)) return null;
  const L = (await activeLocks()).find((l) => l.key === key) ?? null;
  await db().delete(appSettings).where(eq(appSettings.key, key));
  return L;
}
