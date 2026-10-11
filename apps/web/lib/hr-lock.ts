import 'server-only';
/**
 * Legacy office-owner lock (`empContract` 7754 / `empDisc` 15683): in the office's own firm (`offFirm`) the employees'
 * contracts and disciplinary documents are seen only by the owner (`zzIsOwner`; here the administrator role).
 */
import { kdOfficeFirm } from '@wise/core/firms/kdog';
import { firms, getOfficeProfile, type Firm } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';

export const HR_LOCK_MSG = '🔒 Договорите на вработените во канцеларијата ги гледа само сопственикот.';

export async function hrOfficeLocked(firm: Pick<Firm, 'id'>, u: Pick<SessionUser, 'role'>): Promise<boolean> {
  if (u.role === 'admin') return false;
  const O = await getOfficeProfile(db());
  const off = kdOfficeFirm(await db().select().from(firms), O as Parameters<typeof kdOfficeFirm>[1]);
  return !!off && off.id === firm.id;
}
