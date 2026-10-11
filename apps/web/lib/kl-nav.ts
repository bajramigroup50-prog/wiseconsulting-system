import 'server-only';
/**
 * Client portal menu — legacy `klNav` 9054: „Мојата фирма“ with 🏠 Почетна, ✍ Договор со сметководителот (once the
 * office has signed a contract), every section the office switched on for the firm (`klSections`, module filter)
 * and 🔑 Мојот профил / лозинка.
 */
import { eq } from 'drizzle-orm';
import { klSections, type KlConfig } from '@wise/core/office';
import { serviceContracts, type Firm } from '@wise/db';
import type { NavGroup, NavItem } from './nav-data';
import { db } from './db';

/** Contracts of the firm signed by the office: `wait` = still waiting for the client's signature. */
export async function klContracts(firmId: string): Promise<{ any: boolean; wait: { id: string; number: string }[] }> {
  const R = await db().select({ id: serviceContracts.id, number: serviceContracts.number, data: serviceContracts.data }).from(serviceContracts).where(eq(serviceContracts.firmId, firmId));
  const sig = R.filter((r) => (r.data as { offSig?: unknown }).offSig);
  return { any: sig.length > 0, wait: sig.filter((r) => !(r.data as { cliSig?: unknown }).cliSig).map((r) => ({ id: r.id, number: r.number ?? '' })) };
}

/** `preview` = an office user's 👁 Преглед како клиент (legacy `S.asClient`): no profile item, „✕ Излез од прегледот како клиент“ last. */
export async function klNav(firm: Firm | null, preview = false): Promise<readonly NavGroup[]> {
  const items: NavItem[] = [['klHome', '🏠 Почетна']];
  if (firm) {
    if ((await klContracts(firm.id)).any) items.push(['kdogovori', '✍ Договор со сметководителот']);
    for (const s of klSections((firm.settings as { kl?: KlConfig }).kl, firm.mods)) if (s[3] !== 'klHome') items.push([s[3], `${s[2]} ${s[1]}`]);
  }
  items.push(preview ? ['klExit', '✕ Излез од прегледот како клиент'] : ['lozinka', '🔑 Мојот профил / лозинка']);
  return [['Мојата фирма', items]];
}
