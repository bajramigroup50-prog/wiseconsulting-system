import { describe, expect, it } from 'vitest';
import { missingPayLiabilities } from './opening-paylib';

describe('missingPayLiabilities', () => {
  const L = [
    { account: '2340', date: '2026-01-30', kind: 'bank', debit: 1568, credit: 0 },
    { account: '2340', date: '2026-01-31', kind: 'mpin', debit: 0, credit: 1502 },
    { account: '2340', date: '2026-02-26', kind: 'bank', debit: 1502, credit: 0 },
    { account: '2401', date: '2026-01-31', kind: 'mpin', debit: 0, credit: 24445 },
    { account: '2401', date: '2026-02-26', kind: 'bank', debit: 24445, credit: 0 },
  ];
  it('the January payment of December with nothing in the opening', () => {
    expect(missingPayLiabilities(L)).toEqual([{ account: '2340', paid: 1568, open: 0, missing: 1568 }]);
  });
  it('already in the opening → nothing', () => {
    expect(missingPayLiabilities([...L, { account: '2340', date: '2026-01-01', kind: 'open', debit: 0, credit: 1568 }])).toEqual([]);
  });
});
