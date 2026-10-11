import { describe, expect, it } from 'vitest';
import { fiskPostRows, fkCheck, fkSpread } from './fisk-parity';
import { fkRows } from './ai/fisk';

const R = {
  groups: { А: 18, Б: 5 },
  days: [
    { date: '2026-03-02', z: '10', gross: { А: 1180, Б: 105 }, vat: { А: 180, Б: 5 }, total: 1285, cash: 1000, card: 285 },
    { date: '2026-03-03', z: '11', gross: { А: 590 }, vat: { А: 90 }, total: 590, cash: 590, card: 0 },
  ],
};

describe('fiscal report posting (legacy fkRows2 / fkPost / fkMetgDays)', () => {
  it('sums several days into one record with days (default) or posts per day', () => {
    const s = fiskPostRows(R, { today: '2026-03-31', sum: true });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ date: '2026-03-03', z: '10–11', total: 1875, card: 285, gross: { 18: 1770, 5: 105 }, vat: { 18: 270, 5: 5 } });
    expect(s.rows[0]!.days!.map((d) => d.date)).toEqual(['2026-03-02', '2026-03-03']);
    const p = fiskPostRows(R, { today: '2026-03-31', sum: false });
    expect(p.rows.map((r) => r.total)).toEqual([1285, 590]);
    expect(fiskPostRows(R, { today: '2026-03-31', sum: true, nonVat: true }).rows[0]!.gross).toEqual({ 0: 1875 });
  });

  it('spreads a periodic report over Monday–Saturday', () => {
    const D = fkSpread('2026-03-01', '2026-03-08', 100);
    expect(D.map((d) => d.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
    expect(D.reduce((s, d) => s + d.total, 0)).toBeCloseTo(100, 2);
    const p = fiskPostRows({ from: '2026-03-01', to: '2026-03-08', totals: { gross: { А: 118 }, total: 118 } }, { today: '2026-03-31' });
    expect(p.rows[0]!.days).toHaveLength(6);
    expect(fiskPostRows({ from: '2026-03-01', to: '2026-03-08', totals: { gross: { А: 118 }, total: 118 } }, { today: '2026-03-31', mg: 'one' }).rows[0]!.days).toBeUndefined();
  });

  it('control checks (legacy fkCheck)', () => {
    const X = fkRows({ days: [{ date: '2026-03-02', gross: { А: 1180 }, vat: { А: 100 }, total: 1200, cash: 500, card: 100 }] }, '2026-03-31');
    expect(fkCheck(X.rows[0]!, X.G)).toHaveLength(3);
  });
});
