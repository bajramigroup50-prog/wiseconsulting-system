/** The back side / second page of a fiscal report or receipt is part of it, never counted twice (synthetic data). */
import { describe, expect, it } from 'vitest';
import { fiskAfterRead, fiskDedupeDays } from './fisk';
import { attachReceiptPages, receiptDrafts } from './receipts';

describe('fiscal report: front + back side', () => {
  it('the same Z number and date read twice (front with totals, back with the payment breakdown) is one day', () => {
    const D = fiskDedupeDays([
      { date: '2026-09-30', z: '0412', gross: { А: 11800, Б: 1050 }, total: 12850 },
      { date: '2026-09-30', z: '412', cash: 9000, card: 3850, receipts: 57 },
      { date: '2026-10-01', z: '0413', gross: { А: 5900 }, total: 5900 },
    ]);
    expect(D).toHaveLength(2);
    expect(D[0]).toMatchObject({ z: '0412', total: 12850, cash: 9000, card: 3850, receipts: 57 });
  });

  it('a read of both sides gives the report once (totals not doubled)', () => {
    const R = fiskAfterRead({ device: 'АБ123456', from: '2026-09-30', to: '2026-09-30', groups: { А: 18, Б: 5 }, days: [
      { date: '2026-09-30', z: '412', gross: { А: 11800, Б: 1050 }, vat: { А: 1800, Б: 50 }, total: 12850 },
      { date: '2026-09-30', z: '412', gross: { А: 11800, Б: 1050 }, total: 12850, cash: 12850 },
    ] });
    expect(R.days).toHaveLength(1);
    expect(R.days![0]).toMatchObject({ total: 12850, cash: 12850 });
  });
});

describe('receipts: back side', () => {
  const o = { today: '2026-10-17', kontoFor: () => '4490', fxFor: () => 61.5 };
  it('the same receipt number and date twice is one receipt; a side with no amount and no number is not a receipt', () => {
    const D = receiptDrafts({ receipts: [
      { country: 'MK', date: '2026-10-01', docNo: '0012345', merchant: 'ПЕТРОЛ ПРИМЕР', total: 2500, category: 'fuel' },
      { country: 'MK', date: '2026-10-01', docNo: '12345', merchant: 'ПЕТРОЛ ПРИМЕР', total: '' },
      { country: 'MK', date: '2026-10-01', docNo: '', merchant: '', total: '' },
      { country: 'MK', date: '2026-10-01', docNo: '0012346', merchant: 'ПЕТРОЛ ПРИМЕР', total: 2500, category: 'fuel' },
    ] }, o);
    expect(D.map((x) => [x.docNo, x.amt])).toEqual([['0012345', 2500], ['0012346', 2500]]);
  });
  it('across photos: the back side read later is attached (dropped), the front kept; another seller with the same number stays', () => {
    const A = [
      { docNo: '77', date: '2026-10-02', amt: '' as const, merchant: 'ЛУКОИЛ', vatId: '' },
      { docNo: '77', date: '2026-10-02', amt: 1200, merchant: 'ЛУКОИЛ', vatId: '' },
      { docNo: '77', date: '2026-10-02', amt: 300, merchant: 'ТОЛ ПРИМЕР', vatId: '' },
    ];
    expect(attachReceiptPages(A).map((x) => [x.merchant, x.amt])).toEqual([['ЛУКОИЛ', 1200], ['ТОЛ ПРИМЕР', 300]]);
    // a single amount-less read stays (the user sees „нема износ“)
    expect(attachReceiptPages([A[0]!])).toHaveLength(1);
  });
});
