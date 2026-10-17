/** Search of the „Аналитика“ lists (pure, no imports: also used by the client keyboard component). */

/** Search text of a list row (lower case). */
export const akSearchText = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ').toLowerCase();

/**
 * Does a row match the search box? Digits = the code starts with them (konto list; with `digitsInText` also a number
 * inside the text, e.g. ЕДБ of a partner); otherwise every word occurs in the text.
 */
export function akMatch(code: string, text: string, q: string, digitsInText = false): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (/^\d+$/.test(s)) return code.startsWith(s) || (digitsInText && text.includes(s));
  const t = text.toLowerCase();
  return s.split(/\s+/).every((w) => t.includes(w));
}
