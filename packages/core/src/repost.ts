/**
 * Re-posting a year with the current schemes — legacy `oldVatDocs` / `oldVatHTML` (VAT on a summary konto instead of
 * per rate) and `ACT.schRepost` (confirm text, result toast). The posting itself is the documents' own posting service.
 */

/** Legacy `VAT_BAD`: summary VAT kontos (VAT not split per rate). */
export const VAT_SUMMARY_ACCOUNTS: ReadonlySet<string> = new Set(['2300', '230', '1300', '130', '23000', '13000', '2301', '2302', '1301', '1302']);
export const isSummaryVatAccount = (k: unknown) => VAT_SUMMARY_ACCOUNTS.has(String(k ?? '').trim());

/** Source types re-posted (legacy: purchases, invoices, daily sales, payroll v2). */
export const REPOST_SOURCES = ['purchase', 'invoice', 'sales_daily', 'payroll'] as const;
export type RepostSource = (typeof REPOST_SOURCES)[number];

/** Legacy `oldVatDocs`: documents of the year (invoices, purchases, daily sales) with a journal line on a summary VAT konto. */
export function oldVatDocCount(lines: readonly { sourceType: string | null; sourceId: string | null; account: string }[]): number {
  const S = new Set<string>();
  for (const l of lines) if (l.sourceId && ['invoice', 'purchase', 'sales_daily'].includes(l.sourceType ?? '') && isSummaryVatAccount(l.account)) S.add(`${l.sourceType}:${l.sourceId}`);
  return S.size;
}

/** Legacy `oldVatHTML` text. */
export const oldVatText = (n: number) =>
  `${n} документи се книжени со ДДВ на збирно конто (2300/2301/2302 или 1300/1301/1302) наместо по стапки (230018/230010/23005, 130018…). Прекнижете ги за ДДВ и приходите да се поделат по 18%, 10% и 5%.`;

/** Legacy confirm of `schRepost`. */
export const repostConfirm = (year: number | string) => `Да се прекнижат сите влезни и излезни фактури, дневни промети и плати од ${year} според тековните шеми?`;

/** Legacy result toast of `schRepost`. */
export const repostResult = (n: number, locked: number, failed = 0) =>
  `${n} документи се прекнижани.${locked ? ` ${locked} се прескокнати – заклучен период (не се менуваат).` : ''}${failed ? ` ${failed} не можеа да се прекнижат (проверете ги рачно).` : ''}`;
