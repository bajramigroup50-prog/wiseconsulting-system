import { describe, expect, it } from 'vitest';
import { BAJRAM, mkHolidays, monthHours, monthSplit, orthEaster, workHoursBetween, workingDays } from '../../../src/payroll';
import { loadLegacy, plain } from './legacy';

const L = loadLegacy();
const months = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);

describe('calendar — golden', () => {
  it('orthEaster 1990–2100', () => {
    for (let y = 1990; y <= 2100; y++) expect(orthEaster(y).toISOString()).toBe(L.orthEaster(y).toISOString());
  });

  it('mkHolidays 2025–2032 (legacy Bajram range) and years without Bajram', () => {
    for (let y = 2025; y <= 2032; y++) expect(mkHolidays(y)).toEqual(plain(L.mkHolidays(y)));
    for (const y of [2018, 2019, 2033, 2040]) expect(mkHolidays(y)).toEqual(plain(L.mkHolidays(y)));
  });

  it('BAJRAM keeps every legacy date', () => {
    for (const [y, d] of Object.entries(plain(L.BAJRAM) as Record<string, string>)) expect(BAJRAM[+y]).toBe(d);
  });

  it('FIX: Bajram 2020–2024 added (legacy had none → wrong working hours in historic months)', () => {
    for (let y = 2020; y <= 2024; y++) {
      const port = mkHolidays(y);
      const legacy = plain(L.mkHolidays(y)) as { date: string; n: string }[];
      expect(port.filter((h) => !h.n.startsWith('Рамазан Бајрам'))).toEqual(legacy);
      expect(port.some((h) => h.date === `${y}-${BAJRAM[y]}`)).toBe(true);
    }
    // 2023-04-21 is a Friday: legacy counted it as a working day
    expect(monthSplit('2023-04').hol).toBe(plain(L.monthSplit('2023-04')).hol + 8);
  });

  it('monthSplit / monthHours / workHoursBetween for every month 2025–2032', () => {
    for (let y = 2025; y <= 2032; y++)
      for (const ym of months(y)) {
        expect(monthSplit(ym)).toEqual(plain(L.monthSplit(ym)));
        expect(monthHours(ym)).toBe(L.monthHours(ym));
        expect(workHoursBetween(ym, `${ym}-10`, `${ym}-20`)).toEqual(plain(L.workHoursBetween(ym, `${ym}-10`, `${ym}-20`)));
        expect(workHoursBetween(ym)).toEqual(plain(L.workHoursBetween(ym)));
        expect(workingDays(ym)).toBe(plain(L.monthSplit(ym)).work / 8);
      }
  });
});
