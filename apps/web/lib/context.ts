import 'server-only';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { firmActiveIn, firmYearNote } from '@wise/core/firms/years';
import { todaySkopje } from '@wise/core/office';
import { firmFirstDataYear, firmLastDataYears, firms, type Firm } from '@wise/db';
import { db } from './db';
import { FirmChanged, YearChanged, type SessionUser } from './auth';
import { FIRM_HEADER, YEAR_HEADER, cookieFrom, firmMismatch, yearMismatch } from './firm-guard';

export const FIRM_COOKIE = 'wc_fid';
export const YEAR_COOKIE = 'wc_year';

/**
 * Tab / window guard (`lib/firm-guard.ts`): the firm id / year the sending page was rendered for (header added by
 * `components/firm-guard.tsx` to mutations only) against what the session resolves now. Not checked when this very
 * request changed the cookie (choosing a firm / year is not a stale page) or when the header is absent (page loads).
 */
async function sentFor(header: string, cookie: string): Promise<string | null> {
  const h = await headers();
  const sent = h.get(header);
  if (!sent) return null;
  if (cookieFrom(h.get('cookie'), cookie) !== (await cookies()).get(cookie)?.value) return null;
  return sent;
}

/**
 * The firm the user is working in (cookie), only if they still have access to it. In a mutation sent by a page that
 * was rendered for another firm it throws `FirmChanged` (another tab switched firm) — every firm-scoped server action
 * resolves its firm here (`firmAction`, `officeAction`, `indRun`, `stockAction`, `payAction`…).
 * `check: false` only for endpoints that do not write firm data (the error log).
 */
export async function currentFirm(u: SessionUser, opts: { check?: boolean } = {}): Promise<Firm | null> {
  const f = await resolveFirm(u);
  if (opts.check !== false && firmMismatch(await sentFor(FIRM_HEADER, FIRM_COOKIE), f?.id ?? null)) throw new FirmChanged();
  return f;
}

async function resolveFirm(u: SessionUser): Promise<Firm | null> {
  const id = (await cookies()).get(FIRM_COOKIE)?.value;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const [f] = await db().select().from(firms).where(eq(firms.id, id)).limit(1);
    // an archived (deleted, `active = false`) firm is closed like legacy delFirm did
    if (f && f.active && firmAllowed(u.principal, f.id, f.ownerId)) return f;
  }
  // legacy `afterLogin`: a user with exactly one firm (every client) works in it without choosing
  const own = u.principal.firms.filter((x) => x !== '*');
  if (u.principal.firms.includes('*') || own.length !== 1) return null;
  const [f] = await db().select().from(firms).where(eq(firms.id, own[0]!)).limit(1);
  return f && f.active ? f : null;
}

/** The calendar year in Skopje (the default working year and the one the warning strip compares with). */
export const calendarYear = () => Number(todaySkopje().slice(0, 4));

/** Was the working year chosen in this browser session (after the login the year screen comes first)? */
export async function yearChosen(): Promise<boolean> {
  return !!(await cookies()).get(YEAR_COOKIE)?.value;
}

/** The working year (cookie, default the calendar year); a mutation from a page of another year throws `YearChanged`. */
export async function currentYear(opts: { check?: boolean } = {}): Promise<number> {
  const v = Number((await cookies()).get(YEAR_COOKIE)?.value);
  const y = Number.isInteger(v) && v > 2000 && v < 2100 ? v : calendarYear();
  if (opts.check !== false && yearMismatch(await sentFor(YEAR_HEADER, YEAR_COOKIE), y)) throw new YearChanged();
  return y;
}

/**
 * Callout text when the selected firm does not work in the selected year („Фирмата не е активна во 2024 – работи од
 * 2026.“), `null` when it does. The first data year is only looked up when the firm would otherwise be outside the year.
 */
export async function firmYearCallout(firm: Pick<Firm, 'id' | 'settings' | 'createdAt'>, year: number): Promise<string | null> {
  if (firmActiveIn(firm, year)) return null;
  const [first, last] = await Promise.all([
    firmFirstDataYear(db(), firm.id).catch(() => null),
    firmLastDataYears(db(), [firm.id]).then((m) => m.get(firm.id) ?? null).catch(() => null),
  ]);
  return firmYearNote(firm, year, first, last);
}
