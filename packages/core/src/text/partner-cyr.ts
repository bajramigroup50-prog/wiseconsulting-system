/**
 * „Поправка на кирилица“ for partners (комитенти): which conversion fits a name / address / city, and whether the
 * partner is a real foreign company whose Latin name should stay.
 *
 * - YUSCII leftovers in Cyrillic („ДЕЛ^ЕВ“) → {@link fixYuscii};
 * - Latin typed on a Macedonian keyboard in Latin mode (a key such as [ ] ; ' \ inside a word: „MA[INA“, „KU;E“)
 *   → {@link kbdToCyr};
 * - other Latin („Bajrami DOOEL“, „Xhemaili“, „Shtip“) → {@link latToCyr}, letter by letter with the digraphs.
 */
import { latToCyr } from './cyr';
import { hasCyrillic, hasLatin, kbdToCyr } from './kbd-cyr';
import { fixYuscii, hasYuscii } from './yuscii';

/** Keys of the Macedonian layout that are punctuation on the Latin one. */
const KEY_ANY = /[A-Za-z][[\]\\{}|]|[[\]\\{}|][A-Za-z]/;
/** ; : ' " are also ordinary punctuation – only between two letters („KU;E“, „SRE'A“). */
const KEY_MID = /[A-Za-z][;:'"][A-Za-z]/;

/** The Latin text was typed on a Macedonian keyboard in Latin mode (a letter key that is punctuation in Latin). */
export function isKbdLatin(s: string | null | undefined): boolean {
  const t = String(s ?? '');
  if (!hasLatin(t) || hasCyrillic(t)) return false;
  return t.split(/\s+/).some((w) => !/@|^www\.|^https?:/i.test(w) && (KEY_ANY.test(w) || KEY_MID.test(w)));
}

export type CyrMode = 'yuscii' | 'kbd' | 'lat' | null;

/** Which conversion {@link partnerToCyr} uses for the text (null = nothing to do). */
export function cyrMode(s: string | null | undefined): CyrMode {
  const t = String(s ?? '');
  if (hasYuscii(t)) return 'yuscii';
  if (!hasLatin(t) || hasCyrillic(t)) return null;
  return isKbdLatin(t) ? 'kbd' : 'lat';
}

/** The text in Macedonian Cyrillic, by {@link cyrMode}; text that needs nothing is returned as it is. */
export function partnerToCyr(s: string | null | undefined): string {
  const t = String(s ?? '');
  const m = cyrMode(t);
  return m === 'yuscii' ? fixYuscii(t) : m === 'kbd' ? kbdToCyr(t) : m === 'lat' ? latToCyr(t) : t;
}

const MK_COUNTRY = /^(mk|mkd|makedonija|macedonia|north macedonia|severna makedonija|r\.?\s*makedonija|република( северна)? македонија|(северна )?македонија|maqedoni(a)?( e veriut)?)$/i;
/** Macedonian legal forms: a partner with one of these is domestic whatever other words it has. */
const MK_FORM = /^(dooel|doo|ad|dpts|dptu|dptsu|tp|jp|jzu|pzu|zk|zz|oou|ou|su|ju|kd|jtd|dpu|ad\.?)$/i;
/** Foreign legal forms and words that are clearly English (brands that are never written in Cyrillic). */
const FOREIGN_WORD = new Set([
  'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'gmbh', 'mbh', 'ag', 'kg', 'srl', 'sro', 'spa', 'sas', 'sarl',
  'bv', 'nv', 'oy', 'aps', 'corp', 'corporation', 'company', 'co', 'sh.p.k', 'shpk', 'ohg', 'kft', 'zrt',
  'ireland', 'germany', 'austria', 'netherlands', 'luxembourg', 'usa', 'uk', 'europe', 'emea',
  'microsoft', 'google', 'amazon', 'apple', 'facebook', 'meta', 'paypal', 'booking', 'airbnb', 'adobe', 'zoom', 'linkedin',
  'netflix', 'spotify', 'wizz', 'ryanair', 'dhl', 'ups', 'fedex', 'tnt', 'aliexpress', 'alibaba', 'ebay', 'oracle', 'cisco',
  'services', 'solutions', 'technologies', 'technology', 'software', 'payments', 'holdings', 'trading', 'the', 'and', 'of',
]);

export interface ForeignHint { name: string; edb?: string | null; country?: string | null; foreign?: boolean | null }

/**
 * Why the partner looks like a real foreign company (its Latin name should stay), or null when it looks domestic:
 * the „странски“ flag, a country other than Macedonia, a tax number that is not a 13-digit ЕДБ, or (without a
 * Macedonian legal form) a foreign legal form / English word such as „Microsoft Ireland Operations Ltd“.
 * Text typed on a Macedonian keyboard („MA[INA“) is always domestic.
 */
export function foreignReason(p: ForeignHint): string | null {
  if (p.foreign) return 'странски комитент';
  const c = String(p.country ?? '').trim();
  if (c && !MK_COUNTRY.test(c)) return `држава: ${c}`;
  const edb = String(p.edb ?? '').replace(/[\s.-]/g, '');
  if (edb && !/^(MK)?\d{13}$/i.test(edb)) return `даночен број ${p.edb}`;
  if (isKbdLatin(p.name) || !hasLatin(p.name) || hasCyrillic(p.name)) return null;
  const words = p.name.toLowerCase().split(/[\s,()"„“/]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  if (words.some((w) => MK_FORM.test(w.replace(/\./g, '')))) return null;
  const hit = words.find((w) => FOREIGN_WORD.has(w) || FOREIGN_WORD.has(w.replace(/\./g, '')));
  return hit ? `англиски / странски збор „${hit}“` : null;
}

export interface PartnerCyrFix { name: string; address: string; city: string; changed: boolean; foreign: string | null }

/** The proposal for one partner: the three fields in Cyrillic, whether anything changes, and the foreign hint. */
export function partnerCyrFix(p: ForeignHint & { address?: string | null; city?: string | null }): PartnerCyrFix {
  const name = partnerToCyr(p.name), address = partnerToCyr(p.address), city = partnerToCyr(p.city);
  const changed = name !== p.name || address !== String(p.address ?? '') || city !== String(p.city ?? '');
  return { name, address, city, changed, foreign: changed ? foreignReason(p) : null };
}
