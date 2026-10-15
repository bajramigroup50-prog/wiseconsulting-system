import 'server-only';
/**
 * The office OWNER (сопственик на канцеларијата): the one user who sees the colleagues' productivity
 * (📊 Продуктивност на вработените, its PDF / Excel, and the per-user filter of the activity log). Not every admin.
 * The resolution itself is in `lib/office-owner-core.ts` (shared with the proxy).
 */
import type { SessionUser } from './auth';
import { db } from './db';
import { officeOwnerIn, type OfficeOwner } from './office-owner-core';

export { OFFICE_OWNER_KEY, type OfficeOwner } from './office-owner-core';

export const officeOwner = (): Promise<OfficeOwner | null> => officeOwnerIn(db());

/** Never true for a 🎭 demo user (a demo admin has its own demo-owner context, `lib/demo.ts` `isDemoOwner`). */
export const isOfficeOwner = async (u: Pick<SessionUser, 'id' | 'role'> & { demo?: boolean } | null | undefined): Promise<boolean> =>
  !!u && !u.demo && u.role === 'admin' && (await officeOwner())?.id === u.id;

export const OWNER_ONLY_MSG = 'Само за сопственикот на канцеларијата.';
