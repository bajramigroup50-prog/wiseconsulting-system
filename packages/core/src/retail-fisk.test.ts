import { describe, expect, it } from 'vitest';
import { fkCheck, fkChecks2, fkEdbOk, fkGrossByRate, fkMetgDays, fkRows2, fkScDef, posSaldo } from './retail';
import { fkRows } from './ai/fisk';

const T = '2026-04-10';
const daily = {
  from: '2026-03-02', to: '2026-03-03',
  days: [
    { date: '2026-03-02', z: '11', gross: { 'А': 1180, 'Б': 105 }, vat: { 'А': 180, 'Б': 5 }, total: 1285, cash: 1000, card: 285 },
    { date: '03.03.2026', z: '12', gross: { 'А': 590 }, vat: { 'А': 90 }, total: 590, cash: 590 },
  ],
};

describe('fiscal report posting (legacy fkRows2 / fkCheck / fkMetgDays)', () => {
  it('checks a row', () => {
    const X = fkRows(daily, T);
    expect(fkCheck(X.rows[0]!, X.G)).toEqual([]);
    const bad = { ...X.rows[0]!, total: 1300, vat: { 'А': 100, 'Б': 5 } };
    expect(fkCheck(bad, X.G)).toEqual(['збир по групи 1285.00 ≠ вкупно 1300.00', 'ДДВ А (18%) 100.00 ≠ пресметан 180.00', 'готовина+картичка 1285.00 ≠ вкупно 1300.00']);
    expect(fkChecks2(bad, X.G, true)).toEqual(['готовина+картичка ≠ вкупно']);
  });
  it('per day, summed, without VAT', () => {
    expect(fkRows2(daily, { today: T }).rows.map((r) => r.date)).toEqual(['2026-03-02', '2026-03-03']);
    const S = fkRows2(daily, { sum: true, date: '2026-03-31', today: T });
    expect(S.rows).toHaveLength(1);
    expect(S.rows[0]).toMatchObject({ date: '2026-03-31', z: '11–12', total: 1875, cash: 1590, card: 285, gross: { 'А': 1770, 'Б': 105 } });
    const N = fkRows2(daily, { nonVat: true, today: T });
    expect(N.G).toEqual({ '—': 0 });
    expect(N.rows[0]!.gross).toEqual({ '—': 1285 });
    expect(fkGrossByRate(S.rows[0]!, S.G, false)).toEqual({ 18: 1770, 5: 105 });
    expect(fkGrossByRate(N.rows[0]!, N.G, true)).toEqual({ 0: 1285 });
  });
  it('МЕТГ days: daily rows of the read, or the spread of a periodic report', () => {
    const S = fkRows2(daily, { sum: true, today: T });
    expect(fkMetgDays(daily, S.rows[0]!, { nonVat: false, today: T })).toEqual([
      { date: '2026-03-02', total: 1285, z: '11', g: { 18: 1180, 5: 105 }, v: { 18: 180, 5: 5 } },
      { date: '2026-03-03', total: 590, z: '12', g: { 18: 590 }, v: { 18: 90 } },
    ]);
    // periodic Mon 02.03 – Sat 07.03 (6 working days), 1000 at 18 %
    const P = { from: '2026-03-02', to: '2026-03-08', totals: { gross: { 'А': 1000 }, vat: { 'А': 152.54 }, total: 1000 } };
    const r = fkRows2(P, { today: T }).rows[0]!;
    const D = fkMetgDays(P, r, { nonVat: false, today: T })!;
    expect(D.map((d) => d.total)).toEqual([166.66, 166.66, 166.66, 166.66, 166.66, 166.7]);
    expect(D.every((d) => d.est)).toBe(true);
    expect(D.reduce((a, d) => a + d.g['18']!, 0)).toBeCloseTo(1000, 6);
    expect(fkMetgDays(P, r, { nonVat: false, mg: 'one', today: T })).toBeNull();
  });
  it('scheme default, EDB check, POS balance', () => {
    expect(fkScDef('', undefined, true)).toBe('trgNoVat');
    expect(fkScDef('', 'usl', false)).toBe('usl');
    expect(fkEdbOk('4030999123456', '9123456')).toBe(true);
    expect(fkEdbOk('4030999123456', '1111111')).toBe(false);
    expect(posSaldo([{ account: '1200001', date: '2026-01-31', debit: 1000, credit: 0 }, { account: '1200001', date: '2026-02-03', debit: 0, credit: 985 }, { account: '1000', date: '2026-02-03', debit: 5, credit: 0 }], '1200001'))
      .toEqual({ k: '1200001', d: 1000, p: 985, s: 15, last: '2026-02-03' });
  });
});
