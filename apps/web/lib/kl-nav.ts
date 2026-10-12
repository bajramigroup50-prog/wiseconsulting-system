import 'server-only';
/**
 * Client portal menu — legacy `klNav` 9054: „Мојата фирма“ with 🏠 Почетна, every section the office switched on for the
 * firm (`klSections`, module filter) and 🔑 Мојот профил / лозинка. The accounting-service contract (legacy „✍ Договор со сметководителот“) is not in
 * the portal any more: it is the office owner's (`/kdogovori`).
 */
import { klSections, type KlConfig } from '@wise/core/office';
import type { Firm } from '@wise/db';
import type { NavGroup, NavItem } from './nav-data';

/** `preview` = an office user's 👁 Преглед како клиент (legacy `S.asClient`): no profile item, „✕ Излез од прегледот како клиент“ last. */
export async function klNav(firm: Firm | null, preview = false): Promise<readonly NavGroup[]> {
  const items: NavItem[] = [['klHome', '🏠 Почетна']];
  if (firm) {
    for (const s of klSections((firm.settings as { kl?: KlConfig }).kl, firm.mods)) if (s[3] !== 'klHome') items.push([s[3], `${s[2]} ${s[1]}`]);
  }
  items.push(preview ? ['klExit', '✕ Излез од прегледот како клиент'] : ['lozinka', '🔑 Мојот профил / лозинка']);
  return [['Мојата фирма', items]];
}
