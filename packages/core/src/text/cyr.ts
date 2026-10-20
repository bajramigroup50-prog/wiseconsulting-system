/**
 * Latin → Macedonian Cyrillic for partner names / addresses imported or typed in Latin („TRULI NOLEN DOOEL Skopje“ →
 * „ТРУЛИ НОЛЕН ДООЕЛ Скопје“). A transliteration, letter by letter – foreign brand names may need a hand, so the screens
 * show a preview. Macedonian digraphs (dž lj nj gj kj zh ch sh dz) and the Serbo-Croatian / Albanian letters seen in
 * names (č ć š ž đ, xh q ç ë) are handled; case is kept (DŽ / Dž → Џ). Words with digits, e-mail / web addresses and
 * words already in Cyrillic stay as they are.
 */

const DI: [string, string][] = [
  ['dzh', 'џ'], ['dž', 'џ'], ['xh', 'џ'], ['lj', 'љ'], ['nj', 'њ'], ['gj', 'ѓ'], ['kj', 'ќ'], ['zh', 'ж'], ['ch', 'ч'], ['sh', 'ш'], ['dz', 'ѕ'],
];
const ONE: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', z: 'з',
  x: 'кс', w: 'в', q: 'ќ', y: 'и', č: 'ч', ć: 'ќ', š: 'ш', ž: 'ж', đ: 'ѓ', ç: 'ч', ë: 'е', ü: 'и', ö: 'о', ä: 'а',
};

const up = (s: string) => s.toLocaleUpperCase('mk');

/** One word: keep the case of the source (all caps → all caps, Capitalised → Capitalised, else per letter). */
function word(w: string): string {
  let out = '';
  for (let i = 0; i < w.length;) {
    const rest = w.slice(i).toLowerCase();
    const d = DI.find(([k]) => rest.startsWith(k));
    const src = d ? w.slice(i, i + d[0].length) : w[i]!;
    const cy = d ? d[1] : ONE[src.toLowerCase()];
    if (cy == null) { out += src; i += src.length; continue; }
    // a digraph is upper case when its first letter is („Dž“, „DŽ“ → Џ)
    out += src[0] !== src[0]!.toLowerCase() ? (src.length > 1 && src === src.toUpperCase() && cy.length > 1 ? up(cy) : up(cy[0]!) + cy.slice(1)) : cy;
    i += src.length;
  }
  // a word that was ALL CAPS stays all caps („DOOEL“ → „ДООЕЛ“, also „XH“ → „Џ“)
  return w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? up(out) : out;
}

const KEEP = /\d|@|^www\.|\.(com|mk|net|org)$|^https?:/i;

/** Latin → Cyrillic (Macedonian). Cyrillic parts, numbers, e-mail / web addresses are kept. */
export function latToCyr(s: string | null | undefined): string {
  // a whitespace-separated chunk with an e-mail / web address or digits stays whole; the others are split on punctuation
  return String(s ?? '').split(/(\s+)/).map((c) => (!c.trim() || KEEP.test(c) ? c
    : c.split(/([,;()"„“/\-.])/).map((t) => (!t || !/[A-Za-zčćšžđçëüöä]/i.test(t) ? t : word(t))).join(''))).join('');
}

/** The text has Latin letters and no Cyrillic (a candidate for the conversion). */
export const isLatinName = (s: string | null | undefined): boolean => /[A-Za-z]/.test(String(s ?? '')) && !/[Ѐ-ӿ]/.test(String(s ?? ''));
