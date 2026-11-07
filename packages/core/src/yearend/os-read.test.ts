import { describe, expect, it } from 'vitest';
import { osParse, osRowsFromRead } from './assets-io';

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
});
