import 'server-only';
/**
 * „🏦 Конта за изводи – за сите фирми“ — the OWNER-only guards (page, server actions, Excel route). Only the real office
 * owner (`isOfficeOwner`): never another administrator, a 🔒 book-only colleague, a 🎭 demo user or a client.
 */
import { getUser, requireUser, type SessionUser } from '@/lib/auth';
import { viewAllowed } from '@/lib/nav';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';

export const BS_TITLE = '🏦 Конта за изводи – за сите фирми';

/** The signed-in user when they are the office owner, else `null`. */
export async function bsOwnerUser(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && viewAllowed(u.role, 'bankSite') && (await isOfficeOwner(u)) ? u : null;
}

export class BsError extends Error {}

/** Server-action guard. */
export async function bsOwnerAction(): Promise<SessionUser> {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'bankSite') || !(await isOfficeOwner(u))) throw new BsError(OWNER_ONLY_MSG);
  return u;
}

export const bsYear = (v: unknown, fallback: number): number => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : fallback;
};
