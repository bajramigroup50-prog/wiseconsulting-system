import 'server-only';
/**
 * Access to „💧 Паричен тек – прогноза“: office users who may open the view (menu Анализи) for their current firm; a
 * `klient` of the firm when the office switched the portal section `cash` on (read-only). Manual items and the minimum
 * are saved by office users with `write` only.
 */
import { notFound } from 'next/navigation';
import { can, firmAllowed } from '@wise/core';
import { klAllowedViews, type KlConfig } from '@wise/core/office';
import type { Firm } from '@wise/db';
import { requireUser, type SessionUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { viewAllowed } from '@/lib/nav';

export const CF_VIEW = 'paricenTek';

/** Pure part: may this role open the forecast, and may it change the manual items? */
export function cfAccess(role: string, sectionOn: boolean, viewOk: boolean): { open: boolean; ro: boolean } {
  if (role === 'teren') return { open: false, ro: true };
  if (role === 'klient') return { open: sectionOn, ro: true };
  return { open: viewOk, ro: role === 'view' };
}

export async function cfPage(): Promise<{ u: SessionUser; firm: Firm | null; ro: boolean }> {
  const u = await requireUser();
  const firm = await currentFirm(u);
  const on = !!firm && klAllowedViews((firm.settings as { kl?: KlConfig }).kl, firm.mods).includes(CF_VIEW);
  const a = cfAccess(u.role, on, viewAllowed(u.role, CF_VIEW));
  if (!a.open) notFound();
  if (firm && u.role !== 'klient' && !firmAllowed(u.principal, firm.id, firm.ownerId)) notFound();
  return { u, firm, ro: a.ro || !firm || !can(u.principal, 'write', firm.id) };
}
