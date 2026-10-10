import 'server-only';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { firms, type Firm } from '@wise/db';
import { db } from './db';
import type { SessionUser } from './auth';

export const FIRM_COOKIE = 'wc_fid';
export const YEAR_COOKIE = 'wc_year';

/** The firm the user is working in (cookie), only if they still have access to it. */
export async function currentFirm(u: SessionUser): Promise<Firm | null> {
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

export async function currentYear(): Promise<number> {
  const y = Number((await cookies()).get(YEAR_COOKIE)?.value);
  return Number.isInteger(y) && y > 2000 && y < 2100 ? y : new Date().getFullYear();
}
