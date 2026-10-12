import 'server-only';
/**
 * Access to „✍ Договори за вработување“ of the client portal (`klDogovori`, KL_SEC `vdog`): a `klient` of the firm
 * when the office switched the section on; an office user who may see the firm (👁 Преглед како клиент). The office
 * firm's own employees stay owner-locked (`hrOfficeLocked`). Read-only: the documents are made by the office in
 * Вработени → Договор / Мерки (`/vraboteni`, `/dogovori`).
 */
import { firmAllowed } from '@wise/core';
import { klAllowedViews, type KlConfig } from '@wise/core/office';
import type { Firm } from '@wise/db';
import { getUser, type SessionUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { hrOfficeLocked } from '@/lib/hr-lock';

export const KL_DOG_VIEW = 'klDogovori';

/** Pure part: may this role open the section of this firm? */
export function klDogAllowed(role: string, sectionOn: boolean, firmVisible: boolean): boolean {
  if (role === 'teren') return false;
  if (role === 'klient') return sectionOn;
  return firmVisible;
}

export async function klDogCtx(): Promise<{ u: SessionUser; firm: Firm } | null> {
  const u = await getUser();
  if (!u) return null;
  const firm = await currentFirm(u);
  if (!firm) return null;
  const on = klAllowedViews((firm.settings as { kl?: KlConfig }).kl, firm.mods).includes(KL_DOG_VIEW);
  if (!klDogAllowed(u.role, on, firmAllowed(u.principal, firm.id, firm.ownerId))) return null;
  if (await hrOfficeLocked(firm, u)) return null;
  return { u, firm };
}
