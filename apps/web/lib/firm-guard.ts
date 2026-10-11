/**
 * Firm-mixing guard (shared by the browser, `proxy.ts` and the server helpers; pure, no Next imports).
 *
 * The selected firm lives in one cookie (`wc_fid`) shared by every tab / window of the browser. A page rendered for
 * firm A in one tab could otherwise post into firm B after another tab switched firm (statements uploaded into the
 * wrong firm). So every page of the app sends the firm it was rendered for with each mutation (`x-wise-firm`, added by
 * `components/firm-guard.tsx` to every same-origin non-GET request — server actions included), and `currentFirm`
 * refuses when it differs from the firm of the session (`FirmChanged`, „Фирмата е променета во друг прозорец…“).
 */

export const FIRM_HEADER = 'x-wise-firm';
/** The working year the page was rendered for (same guard as the firm). */
export const YEAR_HEADER = 'x-wise-year';
/** Response header set by `proxy.ts` when a request came from a page of another firm (the tab shows the banner). */
export const FIRM_MISMATCH_HEADER = 'x-wise-firm-mismatch';
export const FIRM_CHANGED_MSG = 'Фирмата е променета во друг прозорец – освежете ја страницата.';
export const YEAR_CHANGED_MSG = 'Годината е променета во друг прозорец – освежете ја страницата.';
/** BroadcastChannel name: a tab announces the firm it renders, the others compare. */
export const FIRM_CHANNEL = 'wise-firm';

const UUID = /^[0-9a-f-]{36}$/i;
export const isFirmId = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/** One cookie out of a raw `Cookie:` request header. */
export function cookieFrom(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return undefined;
}

/**
 * Is the request from a page of another firm? `rendered` = the firm the page was rendered for (header; empty / absent:
 * a page without a firm or a request not made by the app — not checked), `current` = the firm the server resolved for
 * the session (null: none selected).
 */
export function firmMismatch(rendered: string | null | undefined, current: string | null | undefined): boolean {
  if (!rendered || !isFirmId(rendered)) return false;
  return rendered.toLowerCase() !== (current ?? '').toLowerCase();
}

/** Same for the working year (`rendered` = header text, `current` = the year the server resolved). */
export function yearMismatch(rendered: string | null | undefined, current: number): boolean {
  if (!rendered || !/^\d{4}$/.test(rendered)) return false;
  return Number(rendered) !== current;
}

/** Confirmation text of the top-bar year select (a year is never changed silently). */
export const yearSwitchQuestion = (y: number) => `Да се премине во година ${y}? Сите внесови ќе одат во ${y}.`;
/** Warning strip on every screen when the working year is not the calendar year. */
export const yearOffNote = (year: number, calendar: number) => `Работите во ${year}, не во тековната ${calendar}`;

/**
 * `proxy.ts`: is this mutation from a page rendered for another firm / year than the session's cookies? (`'firm'` /
 * `'year'` → response header `x-wise-firm-mismatch`, the tab shows the reload banner.) Only when the cookie is set.
 */
export function staleTab(method: string, header: (n: string) => string | null, cookie: (n: string) => string | undefined): 'firm' | 'year' | null {
  if (method === 'GET' || method === 'HEAD') return null;
  const fid = cookie('wc_fid'), yr = cookie('wc_year');
  if (fid && firmMismatch(header(FIRM_HEADER), fid)) return 'firm';
  if (yr && yearMismatch(header(YEAR_HEADER), Number(yr))) return 'year';
  return null;
}
