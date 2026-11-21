import 'server-only';
/**
 * Language of the НПО screens (🍲 Корисници и оброци, 🧑‍🤝‍🧑 Регистар на членови): the МК / SQ switch (cookie
 * `wise-lang`, also set by the login page), else for the association's own user (klient) the firm's portal language
 * (`kl.lang`), else Macedonian.
 */
import { cookies } from 'next/headers';
import { klLang, type KlConfig } from '@wise/core/office/portal';
import type { Lang } from './npo-i18n';

export async function npoLang(firm: { settings: unknown } | null, role?: string): Promise<Lang> {
  const c = (await cookies()).get('wise-lang')?.value;
  if (c === 'sq' || c === 'mk') return c;
  const kl = ((firm?.settings ?? {}) as { kl?: KlConfig }).kl;
  return role === 'klient' && klLang(kl) === 'sq' ? 'sq' : 'mk';
}
