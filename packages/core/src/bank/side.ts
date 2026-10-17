/** Customer / supplier side of a bank line (pure, client-safe; re-exported by `bank-match`). */

/**
 * A description rule may book this direction: a supplier konto (22x) never takes an inflow, a customer konto (12x)
 * never an outflow (production: a learned „ВЕНГ ХАУС → 2200“ proposed an inflow from the customer on 2200).
 */
export const ruleSideOk = (konto: unknown, amount: number): boolean => {
  const k = String(konto ?? '');
  return !(amount > 0 && /^22/.test(k)) && !(amount < 0 && /^12/.test(k));
};

/**
 * Warning for a line on the „wrong“ partner side without a document link: an inflow (прилив) on a supplier konto
 * (22x) or an outflow (одлив) on a customer konto (12x). '' = fine. (A supplier / customer refund is possible, hence a
 * question, not an error.)
 */
export function wrongSideWarning(konto: unknown, amount: number, linked: boolean): string {
  const k = String(konto ?? '');
  if (linked || !k) return '';
  if (amount > 0 && /^22/.test(k)) return `прилив на ${k}?`;
  if (amount < 0 && /^12/.test(k)) return `одлив на ${k}?`;
  return '';
}
