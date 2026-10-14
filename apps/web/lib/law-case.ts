import 'server-only';
/**
 * ⚖ Правен асистент — loading a saved case for the memo (print / PDF and Word). Office staff only: the client and
 * field roles never (`office` permission); a firm's case also needs that firm (`can('office', firmId)`).
 */
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { firms, getOfficeProfile, lawCases, type LawCaseRow } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';
import { lawMemoHtml } from './law-memo';

export async function lawCaseFor(u: SessionUser, id: string): Promise<{ c: LawCaseRow; firm: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !can(u.principal, 'office')) return null;
  const [r] = await db().select({ c: lawCases, firm: firms.name }).from(lawCases).leftJoin(firms, eq(firms.id, lawCases.firmId)).where(eq(lawCases.id, id)).limit(1);
  if (!r || !can(u.principal, 'office', r.c.firmId)) return null;
  return { c: r.c, firm: r.firm ?? null };
}

export async function lawCaseMemo(u: SessionUser, id: string, word = false): Promise<{ html: string; c: LawCaseRow } | null> {
  const x = await lawCaseFor(u, id);
  if (!x) return null;
  const O = await getOfficeProfile(db());
  return { c: x.c, html: lawMemoHtml(x.c, { office: O.name ?? '', firm: x.firm, word }) };
}
