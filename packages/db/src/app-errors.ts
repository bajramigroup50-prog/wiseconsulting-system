/**
 * Error register service (legacy `errLog` 17460, `errFix`, `errDelFixed`, `VIEWS.greski` 17472).
 * Legacy recorded the same error once per session; here an open row with the same message, source and screen is
 * counted up instead of duplicated.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { appErrors, type AppError } from './schema/index';

export interface ErrorReport {
  msg: string; stack?: string | null; src: string; view?: string | null; digest?: string | null; ver?: string | null; ua?: string | null;
  userId?: string | null; userName?: string | null; role?: string | null; firmRef?: string | null; firmName?: string | null;
}

/** Legacy filter: browser noise that is not a program error. */
export const ignoredError = (msg: string) => /ResizeObserver loop|Script error\.?$|NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/i.test(msg);

export async function recordError(tx: Tx, e: ErrorReport): Promise<string | null> {
  const msg = String(e.msg || 'Непозната грешка').slice(0, 400);
  if (ignoredError(msg)) return null;
  const view = e.view ? String(e.view).slice(0, 200) : null;
  const [same] = await tx.select({ id: appErrors.id }).from(appErrors)
    .where(and(eq(appErrors.fixed, false), eq(appErrors.msg, msg), eq(appErrors.src, e.src), view ? eq(appErrors.view, view) : sql`${appErrors.view} is null`)).limit(1);
  if (same) {
    await tx.update(appErrors).set({ count: sql`${appErrors.count} + 1`, lastAt: new Date() }).where(eq(appErrors.id, same.id));
    return same.id;
  }
  const [r] = await tx.insert(appErrors).values({
    msg, src: e.src.slice(0, 60), view, stack: e.stack ? String(e.stack).slice(0, 1200) : null, digest: e.digest ?? null, ver: e.ver ?? null,
    ua: e.ua ? String(e.ua).slice(0, 160) : null, userId: e.userId ?? null, userName: e.userName ?? null, role: e.role ?? null,
    firmRef: e.firmRef ?? null, firmName: e.firmName ?? null,
  }).returning({ id: appErrors.id });
  return r!.id;
}

export async function listErrors(tx: Tx, filter: 'open' | 'fixed' | 'all'): Promise<AppError[]> {
  const w = filter === 'all' ? undefined : eq(appErrors.fixed, filter === 'fixed');
  return tx.select().from(appErrors).where(w).orderBy(desc(appErrors.lastAt)).limit(500);
}

export async function fixError(tx: Tx, a: { userId: string; id: string }): Promise<void> {
  await tx.update(appErrors).set({ fixed: true, fixedAt: new Date(), fixedBy: a.userId }).where(eq(appErrors.id, a.id));
  await audit(tx, { userId: a.userId, action: 'errFix', entityType: 'app_error', entityId: a.id });
}

export async function deleteFixedErrors(tx: Tx, a: { userId: string }): Promise<number> {
  const R = await tx.delete(appErrors).where(eq(appErrors.fixed, true)).returning({ id: appErrors.id });
  await audit(tx, { userId: a.userId, action: 'errDelFixed', entityType: 'app_error', data: { n: R.length } });
  return R.length;
}

/** Legacy `errCopy`: text to paste into a conversation for a fix. */
export function errorsCopyText(L: readonly AppError[], ver = ''): string {
  return `Грешки во WISE CONSULTING${ver ? ` (${ver})` : ''}:\n\n` + L.slice(0, 20).map((e, i) =>
    `${i + 1}. ${e.lastAt.toISOString().slice(0, 16).replace('T', ' ')} · ${e.userName ?? ''} (${e.role ?? ''}) · фирма: ${e.firmName || '-'} · екран: ${e.view ?? ''} · ${e.src}${e.count > 1 ? ` · ${e.count}×` : ''}\n   ${e.msg}\n   ${String(e.stack ?? '').split('\n').slice(0, 4).join('\n   ')}`).join('\n\n');
}
