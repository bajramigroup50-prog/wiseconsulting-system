/**
 * Text typed on a Macedonian keyboard left in Latin mode → Cyrillic, key by key (e.g. "A-FE[N" → "А-ФЕШН",
 * "SKOPJE" → "СКОПЈЕ"). Legal-form suffixes and digits are unaffected; the case of each letter is kept.
 * Strings that already contain Cyrillic are returned unchanged.
 */
const KEYS: Record<string, string> = {
  q: 'љ', w: 'њ', e: 'е', r: 'р', t: 'т', y: 'ѕ', u: 'у', i: 'и', o: 'о', p: 'п', '[': 'ш', ']': 'ѓ',
  a: 'а', s: 'с', d: 'д', f: 'ф', g: 'г', h: 'х', j: 'ј', k: 'к', l: 'л', ';': 'ч', "'": 'ќ', '\\': 'ж',
  z: 'з', x: 'џ', c: 'ц', v: 'в', b: 'б', n: 'н', m: 'м',
  // Shifted punctuation keys on the same layout.
  '{': 'Ш', '}': 'Ѓ', ':': 'Ч', '"': 'Ќ', '|': 'Ж',
  // Latin letters people type for Macedonian sounds.
  'š': 'ш', 'ž': 'ж', 'č': 'ч', 'ć': 'ќ', 'đ': 'ѓ', 'ç': 'ч', 'ë': 'е', 'ş': 'ш',
};

export const hasCyrillic = (s: string): boolean => /[Ѐ-ӿ]/.test(s);
export const hasLatin = (s: string): boolean => /[A-Za-z]/.test(s);

export function kbdToCyr(text: string | null | undefined): string {
  const s = String(text ?? '');
  if (!s || hasCyrillic(s) || !hasLatin(s)) return s;
  // Punctuation keys ([ ] ; ' \) have no case: they follow the case of the word they are in.
  return s.split(/(\s+)/).map((w) => {
    const letters = w.replace(/[^A-Za-z]/g, '');
    const upperWord = letters.length > 0 && letters === letters.toUpperCase();
    let out = '';
    for (const ch of w) {
      const lo = ch.toLowerCase();
      const m = KEYS[ch] ?? KEYS[lo];
      if (!m) { out += ch; continue; }
      const isLetter = /[A-Za-z]/.test(ch);
      const up = isLetter ? ch !== lo : upperWord;
      out += up ? m.toUpperCase() : m;
    }
    return out;
  }).join('');
}
