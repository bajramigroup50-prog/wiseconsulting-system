import 'server-only';
/**
 * Server helpers of the office's sales CRM (`/crm`): the owner-only guard (same rule as the contracts `kdogovori`:
 * the office OWNER, never a 🎭 demo user, never another colleague or the portal), and the offer HTML with the office
 * provider data (`loadProvider`, `kdProvider`).
 */
import { crmOfferHtml, crmOfferNormalize, type CrmOffer } from '@wise/core/firms/crm';
import { OfficeError, type CrmLead, type CrmOfferRow } from '@wise/db';
import { getUser, requireUser, type SessionUser } from '@/lib/auth';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { today } from '@/lib/office';
import { firmOf, imgUrl, loadProvider } from '../kdogovori/lib';

/** The signed-in user when they are the real office owner, else `null`. */
export async function crmUser(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && (await isOfficeOwner(u)) ? u : null;
}

/** Server-action guard. */
export async function crmAction(): Promise<SessionUser> {
  const u = await requireUser();
  if (!(await isOfficeOwner(u))) throw new OfficeError(OWNER_ONLY_MSG);
  return u;
}

export const rowToOffer = (r: CrmOfferRow): CrmOffer =>
  crmOfferNormalize({ ...(r.data as Partial<CrmOffer>), number: r.number, date: r.date, validUntil: r.validUntil ?? undefined }, today());

/** Offer HTML for the screen / print view (images through `/api/files`). */
export async function offerHtml(u: SessionUser, p: CrmOffer, lead: CrmLead, signed = true): Promise<string> {
  const { O, off } = await loadProvider(u);
  return crmOfferHtml(p, { lead, O, off: off ? firmOf(off) : null, img: imgUrl, signed });
}
