import { describe, expect, it } from 'vitest';
import { vnesMessageKey, vnesRequest, type VnesMonth } from './vnes-request';

const mon = (m: number, o: { s?: number; p?: number; b?: Record<string, number>; scan?: number } = {}): VnesMonth => ({
  m, sales: { n: o.s ?? 0 }, purchases: { n: o.p ?? 0 }, imported: { outVat: 0, inVat: 0 }, bank: o.b ?? {},
  scanSales: { ready: 0, check: o.scan ?? 0, held: 0 }, scanPurchases: { ready: 0, check: 0, held: 0 },
});
const months = (f: (m: number) => VnesMonth) => Array.from({ length: 12 }, (_, i) => f(i + 1));

describe('vnesRequest', () => {
  it('asks for the statements and invoices of the months already over', () => {
    const M = months((m) => mon(m, m <= 6 ? { s: 3, p: 5, b: { a: 2, b: 1 } } : m === 7 ? { s: 2, b: { a: 1 }, scan: 2 } : {}));
    const R = vnesRequest({ firmName: 'ТЕСТ ДООЕЛ', officeName: 'WISE', year: 2026, today: '2026-10-19', accounts: [{ id: 'a', name: 'Халк' }, { id: 'b', name: 'НЛБ' }], months: M });
    expect(R.items).toEqual([
      'Изводи од Халк за август и септември',
      'Изводи од НЛБ за јули, август и септември',
      'Излезни фактури за август и септември (немаме ниту една – ако немало промет, потврдете ни)',
      'Влезни фактури (набавки, трошоци, комунални) за јули, август и септември',
    ]);
    expect(R.inWork).toBe(2);
    expect(R.body).toContain('1. Изводи од Халк');
    expect(R.body).toContain('2 примени документи се во обработка');
    expect(R.subject).toBe('Документи што недостасуваат – ТЕСТ ДООЕЛ (2026)');
  });
  it('nothing to ask: everything entered, or an account / kind never used', () => {
    const M = months((m) => mon(m, m <= 9 ? { s: 1, b: { a: 1 } } : {}));
    const R = vnesRequest({ firmName: 'X', year: 2026, today: '2026-10-01', accounts: [{ id: 'a', name: 'Халк' }, { id: 'z', name: 'Стара' }], months: M });
    expect(R.items).toEqual([]);
    expect(R.body).toBe('');
  });
  it('the key changes with the list, stays within the month', () => {
    expect(vnesMessageKey('f', '2026-10-19', ['a'])).toBe(vnesMessageKey('f', '2026-10-02', ['a']));
    expect(vnesMessageKey('f', '2026-10-19', ['a'])).not.toBe(vnesMessageKey('f', '2026-10-19', ['b']));
  });
});
