import { describe, expect, it } from 'vitest';
import { firmSettingsFrom } from './firmform';
import { fimpParse, fimpToFirm } from './firmimp';
import { firmActiveIn, firmFromYear, firmToYear, firmYearNote, fyCheck, fyOfDate, fyOnDeactivate, fyOnRestore, fyParse } from './years';

const NEW = { settings: {}, createdAt: new Date('2026-10-11T08:00:00Z') };

describe('firm working years (firmActiveIn)', () => {
  it('a future year stays empty until the balances are carried there (or the firm starts in it)', () => {
    expect(firmActiveIn(NEW, 2027, null, null, 2026)).toBe(false);
    expect(firmActiveIn(NEW, 2027, null, 2026, 2026)).toBe(false);
    expect(firmActiveIn(NEW, 2027, null, 2027, 2026)).toBe(true); // „Почетна состојба“ 01.01.2027 posted by the carry
    expect(firmActiveIn({ settings: { fromYear: '2027' }, createdAt: NEW.createdAt }, 2027, null, null, 2026)).toBe(true);
    expect(firmYearNote(NEW, 2027, null, null, 2026)).toBe('Фирмата сè уште нема пренос во 2027 – затворете ја 2026 и пренесете ги салдата.');
    expect(firmYearNote(NEW, 2027, null, 2027, 2026)).toBeNull();
  });
  it('a firm entered in 2026 without older data exists only from 2026', () => {
    expect(firmFromYear(NEW)).toBe(2026);
    expect(firmActiveIn(NEW, 2026)).toBe(true);
    expect(firmActiveIn(NEW, 2027, null, null, 2027)).toBe(true);
    expect(firmActiveIn(NEW, 2025)).toBe(false);
    expect(firmActiveIn(NEW, 2024)).toBe(false);
  });
  it('journals in an earlier year lower the first year', () => {
    expect(firmActiveIn(NEW, 2024, 2024)).toBe(true);
    expect(firmActiveIn(NEW, 2023, 2024)).toBe(false);
    expect(firmFromYear(NEW, 2027)).toBe(2026); // later data never raises it
  });
  it('legacy curYear and regDate do not move the first year back', () => {
    const f = { settings: { curYear: '2023', regDate: '2010-05-01' }, createdAt: '2026-10-11T08:00:00Z' };
    expect(firmActiveIn(f, 2025)).toBe(false);
  });
  it('explicit fromYear wins over creation and data', () => {
    const f = { settings: { fromYear: '2022' }, createdAt: NEW.createdAt };
    expect(firmActiveIn(f, 2022)).toBe(true);
    expect(firmActiveIn(f, 2021, 2019)).toBe(false);
    expect(firmActiveIn({ settings: { fromYear: 2027 }, createdAt: NEW.createdAt }, 2026, 2020)).toBe(false);
  });
  it('toYear closes the firm after that year', () => {
    const f = { settings: { fromYear: '2020', toYear: '2024' }, createdAt: NEW.createdAt };
    expect(firmToYear(f)).toBe(2024);
    expect(firmActiveIn(f, 2024)).toBe(true);
    expect(firmActiveIn(f, 2025)).toBe(false);
    expect(firmYearNote(f, 2025)).toBe('Фирмата не е активна во 2025 – затворена е во 2024.');
  });
  it('callout text for a year before the first year', () => {
    expect(firmYearNote(NEW, 2024)).toBe('Фирмата не е активна во 2024 – работи од 2026.');
    expect(firmYearNote(NEW, 2026)).toBeNull();
  });
  it('invalid settings are ignored, Skopje new-year hour counts as the new year', () => {
    expect(fyParse('20x4')).toBeNull();
    expect(fyParse('1800')).toBeNull();
    expect(firmFromYear({ settings: { fromYear: 'abc' }, createdAt: NEW.createdAt })).toBe(2026);
    expect(fyOfDate(new Date('2025-12-31T23:30:00Z'))).toBe(2026);
    expect(fyOfDate('2024-03-01')).toBe(2024);
    expect(firmFromYear({ settings: null, createdAt: null }, null, 2030)).toBe(2030);
  });
  it('deactivation sets toYear once; restore drops only the automatic one', () => {
    const d = fyOnDeactivate({ a: 1 }, 2026);
    expect(d).toEqual({ a: 1, toYear: '2026', toYearAuto: true });
    expect(fyOnRestore(d)).toEqual({ a: 1 });
    expect(fyOnDeactivate({ toYear: '2024' }, 2026)).toEqual({ toYear: '2024' });
    expect(fyOnRestore({ toYear: '2024' })).toEqual({ toYear: '2024' });
  });
  it('Excel import: „Година“ is curYear only, never the first working year', () => {
    const P = fimpParse([['Име на фирма', 'Година'], ['АЛФА ДООЕЛ', 2024], ['БЕТА ДОО', ''], ['ГАМА', 'тековна']]);
    if ('error' in P) throw new Error(P.error);
    expect(fimpToFirm(P.L[0]!).settings).toMatchObject({ curYear: '2024' });
    expect(fimpToFirm(P.L[0]!).settings.fromYear).toBeUndefined();
    expect(fimpToFirm(P.L[1]!).settings.fromYear).toBeUndefined();
    expect(fimpToFirm(P.L[2]!).settings).toEqual({ curYear: 'тековна' });
  });
  it('form check and save', () => {
    expect(fyCheck('2024', '2023')).toMatch(/не може/);
    expect(fyCheck('24', '')).toMatch(/Активна од/);
    expect(fyCheck('', '')).toBeNull();
    const r = firmSettingsFrom({ text: { fromYear: ' 2024 ', toYear: '2026' }, checked: new Set(), settings: { toYear: '2025', toYearAuto: true } });
    expect(r).toMatchObject({ ok: true, settings: { fromYear: '2024', toYear: '2026' } });
    expect(r.ok && r.settings.toYearAuto).toBeFalsy();
    expect(firmSettingsFrom({ text: { fromYear: '2025', toYear: '2024' }, checked: new Set(), settings: {} }).ok).toBe(false);
    const kept = firmSettingsFrom({ text: { toYear: '2025' }, checked: new Set(), settings: { toYear: '2025', toYearAuto: true } });
    expect(kept.ok && kept.settings.toYearAuto).toBe(true);
  });
});
