/**
 * Partner picker search across scripts: „ВЕНГ“ finds „VENG HAUS DOO SKOPJE“ and „veng“ finds „ВЕНГ ХАУС ДОО“ — both the
 * query and the names are compared in the Latin key form ({@link translitKey}). Pure and small, so client components
 * can import it (`@wise/core/partners/search`).
 */
import { translitKey } from '../text/yuscii';

export interface SearchablePartner { id: string; name: string; code?: string | null }

/** Search key of a partner (the name and code in the Latin key form). */
export const partnerSearchKey = (p: SearchablePartner): string => translitKey(p.name) + ' ' + translitKey(p.code ?? '');

/**
 * Partners matching a query, best first: code equal / starting with the query, name (key) starting with it, a word of
 * the name starting with it, then the name containing it. Every query word must match (in any script).
 */
export function searchPartners<P extends SearchablePartner>(partners: readonly P[], query: string, limit = 12): P[] {
  const q = String(query ?? '').trim();
  if (!q) return partners.slice(0, limit);
  const words = q.split(/\s+/).map(translitKey).filter(Boolean);
  if (!words.length) return partners.slice(0, limit);
  const qc = q.toLowerCase();
  const scored: { p: P; s: number }[] = [];
  for (const p of partners) {
    const code = String(p.code ?? '').toLowerCase();
    const nameWords = String(p.name).split(/[^\p{L}\p{N}]+/u).map(translitKey).filter(Boolean);
    const full = nameWords.join('');
    if (!words.every((w) => full.includes(w) || code.includes(w))) continue;
    const s = code && code === qc ? 0 : code.startsWith(qc) ? 1 : full.startsWith(words.join('')) ? 2 : nameWords.some((w) => w.startsWith(words[0]!)) ? 3 : 4;
    scored.push({ p, s });
  }
  return scored.sort((a, b) => a.s - b.s || String(a.p.name).localeCompare(String(b.p.name))).slice(0, limit).map((x) => x.p);
}
