/**
 * Payroll liabilities missing from the opening balance: the December salary of the previous year is paid in January
 * (bank Д 2340–2344 / 2401) but its liability is not in „Почетна состојба“, so every later month leaves a small
 * difference and the konta never reach 0. Per konto: what the bank paid before the first payroll of the year (the
 * year's first Побарува outside the opening), less what the opening already holds on Побарува. Pure.
 */
export const PAY_LIAB_KONTA = ['2340', '2341', '2342', '2343', '2344', '2401'] as const;

export interface PayLiabLine { account: string; date: string; kind: string; debit: number; credit: number }
export interface PayLiabGap { account: string; paid: number; open: number; missing: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function missingPayLiabilities(lines: readonly PayLiabLine[]): PayLiabGap[] {
  const out: PayLiabGap[] = [];
  for (const k of PAY_LIAB_KONTA) {
    const L = lines.filter((l) => l.account === k);
    const open = r2(L.filter((l) => l.kind === 'open').reduce((a, l) => a + l.credit - l.debit, 0));
    const T = L.filter((l) => l.kind !== 'open').sort((a, b) => a.date.localeCompare(b.date));
    const first = T.find((l) => l.credit > 0)?.date;
    /* payments dated before the first accrual of the year (same day counts as before: paid with the payroll date) */
    const paid = r2(T.filter((l) => l.debit > 0 && (!first || l.date < first)).reduce((a, l) => a + l.debit, 0));
    const missing = r2(paid - Math.max(0, open));
    if (missing > 0.009) out.push({ account: k, paid, open, missing });
  }
  return out;
}
