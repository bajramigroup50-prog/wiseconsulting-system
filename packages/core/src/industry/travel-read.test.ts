import { describe, expect, it } from 'vitest';
import { countryCode, normalizeTravelRead } from './travel-read';
import { frPerDiems } from './transport';

describe('travel order read (патен налог)', () => {
  it('maps country names in any language to the per-diem codes', () => {
    expect(countryCode('Германија')).toBe('DE');
    expect(countryCode('Austria')).toBe('AT');
    expect(countryCode('Србија')).toBe('RS');
    expect(countryCode('de')).toBe('DE');
    expect(countryCode('Atlantis')).toBe('');
  });
  it('cleans the read: times, plates, unknown countries; North Macedonia is not a foreign country', () => {
    const r = normalizeTravelRead({
      number: 'ПН 45/26', driver: 'Петар Петров', plate: 'sk 1234 ab', departure: '03.11.2026 06:00', return: '2026-11-08 20:30',
      countries: [{ country: 'Србија', in: '2026-11-03 07:10', out: '2026-11-03 15:40' }, { country: 'Germany', in: '04.11.2026 09:00', out: '06.11.2026 18:00' }, { country: 'Narnia', in: '', out: '' }, { country: 'MK', in: '', out: '' }],
    });
    expect(r.plate).toBe('SK 1234 AB');
    expect(r.departure).toBe('2026-11-03T06:00');
    expect(r.ret).toBe('2026-11-08T20:30');
    expect(r.segs).toEqual([{ c: 'RS', in: '2026-11-03T07:10', out: '2026-11-03T15:40' }, { c: 'DE', in: '2026-11-04T09:00', out: '2026-11-06T18:00' }]);
    expect(r.unknown).toEqual(['Narnia']);
    const d = frPerDiems({ segs: r.segs, date: '2026-11-03' }, () => 61.5);
    expect(d.rows.length).toBe(2);
    expect(d.mkd).toBeGreaterThan(0);
  });
});
