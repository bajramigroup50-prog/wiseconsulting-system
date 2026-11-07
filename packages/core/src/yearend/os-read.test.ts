import { describe, expect, it } from 'vitest';
import { osParse, osRowsFromRead, type OsImportRow } from './assets-io';
import { depFor } from './depreciation';

describe('fixed-asset register read from PDF', () => {
  it('maps the AI rows to the Excel import and back', () => {
    const R = osRowsFromRead({ assets: [
      { invNo: '001', name: 'Камион ДАФ', konto: '0230', date: '15.03.2021', cost: '1.250.000,00', rate: 25 },
      { name: 'Вкупно', cost: 0 },
    ] });
    expect(R).toHaveLength(2);
    const P = osParse(R);
    expect(P).toEqual([expect.objectContaining({ invNo: '001', name: 'Камион ДАФ', konto: '0230', date: '2021-03-15', cost: 1250000, rate: 25 })]);
  });
  it('the old program list without date / konto / rate (ТРИМИ): konto from the inventory number, rate and date from the depreciation', () => {
    const R = osRowsFromRead({ reportDate: '2026-11-07', assets: [
      { invNo: '01371-01', name: 'ТОВАРНО МАН СК 8493 БФ', cost: 693649, prevDep: 346824.5, curDep: 173412.25 },
      { invNo: '01373-09', name: 'КЕМПФ КИППЕР', cost: 615250, prevDep: 0, curDep: 108890.82 },
    ] });
    const P = osParse(R) as OsImportRow[];
    expect(P[0]).toEqual(expect.objectContaining({ konto: '01371', rate: 25, date: '2023-12-15' }));
    const d = depFor([{ id: 'a', konto: '01371', rate: 25, date: '2023-12-15', cost: 693649 }], 2026).rows[0]!;
    expect(d.year).toBe(173412.25);
    expect(d.acc).toBe(346824.5 + 173412.25);
    // bought this year: the rate of the same konto group is unknown here (other konto) → no rate guessed from nothing
    expect(P[1]!.konto).toBe('01373');
  });
});
