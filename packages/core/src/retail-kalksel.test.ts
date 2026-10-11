import { describe, expect, it } from 'vitest';
import { ksInvLines, ksMergeCheck, ksMergeGroups, ksMergeHead } from './retail';

describe('calculation selection (legacy ksInv / ksMerge)', () => {
  it('invoice lines: one per item, item price or retail price without VAT, account', () => {
    const I = new Map([
      ['a', { id: 'a', name: 'Кафе', unit: 'ком', rate: 18, price: 100, konto: '7600' }],
      ['b', { id: 'b', name: 'Леб', unit: 'ком', rate: 5, price: 0 }],
    ]);
    expect(ksInvLines([{ itemId: 'a', qty: 2 }, { itemId: 'b', qty: 3, sp: 63 }, { itemId: 'a', qty: 1.5 }, { itemId: 'b', qty: 0 }], I)).toEqual([
      { itemId: 'a', name: 'Кафе', unit: 'ком', qty: 3.5, price: 100, rate: 18, account: '7600' },
      { itemId: 'b', name: 'Леб', unit: 'ком', qty: 3, price: 60, rate: 5, account: '7400' },
    ]);
  });
  it('merge checks, header and VAT groups', () => {
    const a = { id: '1', number: 'F1', date: '2026-03-05', docDate: '2026-03-04', partnerId: 'p', wh: 'main' };
    const b = { id: '2', number: 'F2', date: '2026-03-01', partnerId: 'p', wh: 'main' };
    expect(ksMergeCheck([a])).toBe('Селектирајте најмалку две калкулации.');
    expect(ksMergeCheck([a, { ...b, partnerId: 'q' }])).toBe('Спојување е можно само за ист добавувач и ист објект.');
    expect(ksMergeCheck([a, { ...b, imp: true }])).toBe('Увозни калкулации не се спојуваат (различни курсеви и трошоци).');
    expect(ksMergeCheck([a, b])).toBeNull();
    expect(ksMergeHead([a, b])).toMatchObject({ date: '2026-03-05', docDate: '2026-03-01', number: 'F1+F2' });
    expect(ksMergeGroups([{ account: '6600', rate: 18, base: 100, vat: 18 }, { account: '6600', rate: '18', base: '50.5', vat: 9.09 }, { account: '6600', rate: 5, base: 10, vat: 0.5 }]))
      .toEqual([{ account: '6600', rate: 18, base: 150.5, vat: 27.09 }, { account: '6600', rate: 5, base: 10, vat: 0.5 }]);
  });
});
