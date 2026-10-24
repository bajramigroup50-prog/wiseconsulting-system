/** ДБ AOP 57: prepayments of profit tax from the 2330 turnover. */
import { describe, expect, it } from 'vitest';
import { dbAkontFromTurnover } from './tax';

describe('dbAkontFromTurnover', () => {
  it('counts the debits on 2330 of the year', () => {
    expect(dbAkontFromTurnover([{ account: '2330', debit: 6_000 }, { account: '2331', debit: 999 }])).toBe(6_000);
  });
  it('last year\'s final tax settled in the year (opening credit balance) is not a prepayment', () => {
    // opening liability 4 000 paid in March + 12 × 500 prepayments
    expect(dbAkontFromTurnover([{ account: '2330', debit: 10_000, openingDebit: 0, openingCredit: 4_000 }])).toBe(6_000);
    // only part of the liability paid: nothing counts
    expect(dbAkontFromTurnover([{ account: '2330', debit: 3_000, openingCredit: 4_000 }])).toBe(0);
    // an opening debit balance (overpaid) is no liability
    expect(dbAkontFromTurnover([{ account: '2330', debit: 3_000, openingDebit: 1_000 }])).toBe(3_000);
  });
});
