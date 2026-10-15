import 'server-only';
/**
 * Legacy office-owner lock (`empContract` 7754 / `empDisc` 15683): in the office's own firm (`offFirm`) the employees'
 * contracts and disciplinary documents are seen only by the owner (`zzIsOwner`; here the administrator role).
 */
import { eq } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
import { firms, getOfficeProfile, officeFirmOf, type Firm } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';

export const HR_LOCK_MSG = '🔒 Договорите на вработените во канцеларијата ги гледа само сопственикот.';

export async function hrOfficeLocked(firm: Pick<Firm, 'id'>, u: Pick<SessionUser, 'role'>): Promise<boolean> {
  if (u.role === 'admin') return false;
  // 🎭 the office firm of the firm's side: the demo office firm for a demo firm, the real office firm (never a demo firm) otherwise
  const [f] = await db().select().from(firms).where(eq(firms.id, firm.id)).limit(1);
  const demo = isDemoFirm(f);
  const off = officeFirmOf(await db().select().from(firms), await getOfficeProfile(db(), { demo }), { demo });
  return !!off && off.id === firm.id;
}
