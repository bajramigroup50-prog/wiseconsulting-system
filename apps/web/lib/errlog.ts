import 'server-only';
/**
 * Error register (legacy `errLog` 17460 → `apperrors`): every error in the program is stored with when, who, which
 * firm and which screen. The same error (message + first stack frame) is stored once per day; repeats only bump
 * `count` (legacy kept one per session in memory).
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { appErrors } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';

export const APP_VER = process.env.APP_VERSION || 'web';

export interface ErrInput { msg: string; stack?: string | null; view?: string | null; src?: string | null; ua?: string | null }

/** Noise the browser produces that is not a program error (legacy filter). */
export const isNoise = (msg: string) => /ResizeObserver loop|Script error\.?$|NEXT_REDIRECT|NEXT_NOT_FOUND/i.test(msg);

export const errKey = (msg: string, stack?: string | null) => (msg + '|' + String(stack ?? '').split('\n')[1]).slice(0, 600);

export async function logAppError(u: SessionUser | null, firm: { id: string; name: string } | null, e: ErrInput): Promise<void> {
  const msg = String(e.msg || 'Непозната грешка').slice(0, 400);
  if (isNoise(msg)) return;
  const stack = String(e.stack ?? '').slice(0, 1200);
  const key = errKey(msg, stack);
  const since = new Date(Date.now() - 864e5);
  const [ex] = await db().select({ id: appErrors.id }).from(appErrors)
    .where(and(eq(appErrors.key, key), gt(appErrors.at, since), eq(appErrors.fixed, false))).limit(1);
  if (ex) {
    await db().update(appErrors).set({ count: sql`${appErrors.count} + 1` }).where(eq(appErrors.id, ex.id));
    return;
  }
  await db().insert(appErrors).values({
    ver: APP_VER, userId: u?.id ?? null, userName: u?.name ?? null, role: u?.role ?? null,
    firmId: firm?.id ?? null, firmName: firm?.name ?? null, view: (e.view ?? '').slice(0, 200) || null,
    src: (e.src ?? '').slice(0, 40) || null, msg, stack: stack || null, ua: (e.ua ?? '').slice(0, 160) || null, key,
  });
}
