import { describe, expect, it } from 'vitest';
import { fxRateSource } from '../bank-match';
import { cashVoucherDuplicate } from './cash';

describe('fxRateSource (legacy fxSrc 6498)', () => {
  it('MKD has no source', () => expect(fxRateSource('MKD', '2026-05-01')).toBe(''));
  it('firm codebook wins', () => expect(fxRateSource('eur', '2026-05-01', { firm: [{ cur: 'EUR', rate: 61.5 }], office: [{ cur: 'EUR', rate: 61.6, date: '2026-04-30' }] })).toBe('фирма'));
  it('newest office rate on or before the date', () => {
    const office = [{ cur: 'EUR', rate: 61.6, date: '2026-04-30' }, { cur: 'EUR', rate: 61.7, date: '2026-05-02' }, { cur: 'EUR', rate: 61.4, date: '2026-04-01' }];
    expect(fxRateSource('EUR', '2026-05-01', { office })).toBe('курсна листа 30.04.2026');
  });
  it('falls back to the default list date', () => expect(fxRateSource('USD', '2026-05-01')).toBe('стандарден 30.09.2026'));
});

describe('cashVoucherDuplicate (legacy blgDup 6524)', () => {
  const L = [{ id: 'a', docNo: ' 123 ', date: '2026-01-02', amt: 100 }];
  it('same number, date and amount', () => expect(cashVoucherDuplicate({ docNo: '123', date: '2026-01-02', amt: '100.004' }, L)?.id).toBe('a'));
  it('not itself, not without a number', () => {
    expect(cashVoucherDuplicate({ id: 'a', docNo: '123', date: '2026-01-02', amt: 100 }, L)).toBeUndefined();
    expect(cashVoucherDuplicate({ docNo: '', date: '2026-01-02', amt: 100 }, L)).toBeUndefined();
  });
});
