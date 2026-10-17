/**
 * YUSCII (the old 7-bit Macedonian „MAC C“ fonts): the ASCII punctuation [ \ ] ^ @ ` { | } ~ stood for the letters
 * Ш Ѓ Ќ Ч Ж ж ш ѓ ќ ч. Data converted from old programs often has the plain letters converted to Cyrillic but these
 * characters left as they were: „ДЕЛ^ЕВ“ (Делчев), „^аир“ (Чаир), „Ш~ип“. `fixYuscii` repairs such text: inside a word
 * that already has Cyrillic letters, each YUSCII character becomes its letter, in the case of the word.
 * Pure-Latin text (typed on a keyboard in Latin mode) is the job of `kbdToCyr`, a different layout.
 */
export const YUSCII_SPECIAL: Readonly<Record<string, string>> = {
  '[': 'Ш', '\\': 'Ѓ', ']': 'Ќ', '^': 'Ч', '@': 'Ж',
  '{': 'ш', '|': 'ѓ', '}': 'ќ', '~': 'ч', '`': 'ж',
};

const CYR = /[Ѐ-ӿ]/;
const SPECIAL = /[[\\\]^@{|}~`]/;

/** The text has a YUSCII character inside a Cyrillic word (what `fixYuscii` would change). */
export const hasYuscii = (s: string | null | undefined): boolean =>
  String(s ?? '').split(/\s+/).some((w) => SPECIAL.test(w) && CYR.test(w) && !/@.*\./.test(w));

/** Repair YUSCII leftovers in Cyrillic words; other text (e-mail addresses, Latin words) is unchanged. */
export function fixYuscii(text: string | null | undefined): string {
  const s = String(text ?? '');
  if (!SPECIAL.test(s) || !CYR.test(s)) return s;
  return s.split(/(\s+)/).map((w) => {
    if (!SPECIAL.test(w) || !CYR.test(w) || /@.*\./.test(w)) return w;
    const letters = [...w].filter((c) => CYR.test(c));
    const upper = letters.length > 1 && letters.every((c) => c === c.toUpperCase());
    const lower = letters.every((c) => c === c.toLowerCase());
    return [...w].map((c, i) => {
      const m = YUSCII_SPECIAL[c];
      if (!m) return c;
      if (upper) return m.toUpperCase();
      // „Ш~ип“: inside a lower-case run the letter is lower-case whatever the key; at the word start it keeps its case
      if (lower && i > 0) return m.toLowerCase();
      if (!lower && i > 0 && CYR.test(w[i - 1] ?? '') && w[i - 1] === w[i - 1]!.toLowerCase()) return m.toLowerCase();
      return m;
    }).join('');
  }).join('');
}

/** Latin YUSCII (the old program's Latin font): [ Š, { š, ] Ć, } ć, ^ Č, ~ č, @ Ž, ` ž, \ Đ, | đ. */
export const YUSCII_LATIN: Readonly<Record<string, string>> = {
  '[': 'Š', '{': 'š', ']': 'Ć', '}': 'ć', '^': 'Č', '~': 'č', '@': 'Ž', '`': 'ž', '\\': 'Đ', '|': 'đ',
};
const LAT = /[A-Za-z]/;

/**
 * Repair YUSCII leftovers in Latin words („IN[AAT“ → „INŠAAT“) too; Cyrillic words go through {@link fixYuscii};
 * e-mail addresses and words without letters are unchanged.
 */
export function fixYusciiAll(text: string | null | undefined): string {
  const s = fixYuscii(text);
  if (!SPECIAL.test(s) || !LAT.test(s)) return s;
  return s.split(/(\s+)/).map((w) => (SPECIAL.test(w) && LAT.test(w) && !CYR.test(w) && !/@.*\./.test(w) ? [...w].map((c) => YUSCII_LATIN[c] ?? c).join('') : w)).join('');
}

const CYR_LAT: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm',
  н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh',
  // Serbian / Russian letters of other programs
  ђ: 'gj', ћ: 'kj', й: 'j', ы: 'i', э: 'e', ю: 'ju', я: 'ja', щ: 'sht', ъ: '', ь: '',
};
const LAT_LAT: Readonly<Record<string, string>> = { š: 'sh', č: 'ch', ć: 'kj', ž: 'zh', đ: 'gj', ǵ: 'gj', ḱ: 'kj', ẑ: 'dz', w: 'v', q: 'k', y: 'i', x: 'ks' };

/**
 * A spelling-independent key of a name for matching Latin ↔ Cyrillic (Macedonian): both scripts to plain Latin
 * („КАН ИНТЕРНАТИОНАЛ“ and „KAN INTERNATIONAL“ → „kaninternational“), YUSCII repaired, only letters and digits kept.
 */
export function translitKey(text: string | null | undefined): string {
  const s = fixYusciiAll(text).toLowerCase();
  let o = '';
  for (const c of s) o += CYR_LAT[c] ?? LAT_LAT[c] ?? c;
  return o.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/dzh/g, 'dz').replace(/[^a-z0-9]/g, '');
}
