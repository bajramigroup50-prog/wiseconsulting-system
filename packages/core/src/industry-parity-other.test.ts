import { describe, expect, it } from 'vitest';
import {
  accFeeStatus, apptRemindTargets, apptWaLink, apptWaPhone, CONS_PROJECT_IMPORT, consByCity, consByMonth, consFilter, consRow, consSum, effectiveModules,
  firmProfiles, importArrKind, importArrStatus, importEvery, importRecDay, importVat, legalFormForEntity, moduleOnFor, moduleOverrides, oxBool, oxDate, oxNum, oxRows,
  oxTemplate, passportWarn, pctOf, profilesAuto, recBulkPlan, REC_IMPORT, seatsExceeded, setModule,
} from './industry';

describe('import helpers', () => {
  it('maps columns by header text, skips empty rows, reports missing required cells', () => {
    const r = oxRows([['Објект', 'Инвеститор', 'Шифра'], ['Зграда А', 'Инвест ДОО', 'О-1'], ['', '', ''], ['Куќа', '', '']], CONS_PROJECT_IMPORT);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Зграда А', investor: 'Инвест ДОО', code: 'О-1', _row: '2' });
    expect(r.errors).toEqual(['Ред 4: празно „Инвеститор“.']);
  });
  it('fails on a missing required column', () => {
    expect(oxRows([['Шифра'], ['1']], CONS_PROJECT_IMPORT).errors[0]).toContain('Објект / проект');
  });
  it('template starts with the first header of each column', () => {
    expect(oxTemplate(REC_IMPORT)[0]!.slice(0, 3)).toEqual(['Комитент', 'ЕДБ', 'Се повторува']);
  });
  it('parses numbers in local and English formats', () => {
    expect(oxNum('1.234,50')).toBe(1234.5);
    expect(oxNum('1,234.50')).toBe(1234.5);
    expect(oxNum('1234,5')).toBe(1234.5);
    expect(oxNum('3000 ден.')).toBe(3000);
    expect(oxNum('1.000.000')).toBe(1000000);
    expect(oxNum('')).toBe(0);
  });
  it('parses dates', () => {
    expect(oxDate('2026-03-05')).toBe('2026-03-05');
    expect(oxDate('5.3.2026')).toBe('2026-03-05');
    expect(oxDate('3/5/26')).toBe('2026-03-05');
    expect(oxDate('45000')).toBe('2023-03-15');
    expect(oxDate('31.02.2026')).toBe('');
    expect(oxBool('Да')).toBe(true);
    expect(oxBool('не')).toBe(false);
  });
});

describe('construction analyses (legacy cpRow / gradbaIzv)', () => {
  const base = { investor: 'И', boq: 1000, pct: 50, gross: 590, paid: 200, pur: 100, blg: 50, lab: 150, cost: 300 };
  const A = consRow({ ...base, id: 'a', name: 'A', city: 'Скопје', status: 'open', exe: 500, rev: 500 });
  const B = consRow({ ...base, id: 'b', name: 'B', city: '', status: 'done', exe: 800, rev: 500 });
  it('derives open receivable, result and not-invoiced executed work', () => {
    expect(A).toMatchObject({ open: 390, res: 200, nonInv: 0 });
    expect(B).toMatchObject({ city: '—', nonInv: 300 });
  });
  it('groups by city with totals and filters by status', () => {
    const G = consByCity([A, B]);
    expect(G.map((g) => g.city)).toEqual(['Скопје', '—'].sort((a, b) => a.localeCompare(b, 'mk')));
    expect(consSum([A, B]).res).toBe(400);
    expect(consFilter([A, B], 'done').map((x) => x.id)).toEqual(['b']);
    expect(consFilter([A, B], 'open').map((x) => x.id)).toEqual(['a']);
    expect(pctOf(200, 500)).toBe('40%');
    expect(pctOf(1, 0)).toBe('');
  });
  it('aggregates situations and costs by month of the year', () => {
    const M = consByMonth([{ date: '2026-01-10', cur: 100, inv: 100 }, { date: '2026-01-20', cur: 50, inv: 0 }, { date: '2025-12-01', cur: 9, inv: 9 }], [{ d: '2026-02-01', amt: 70 }], 2026);
    expect(M).toEqual([{ mo: '2026-01', n: 2, exe: 150, inv: 100, cost: 0, diff: 150 }, { mo: '2026-02', n: 0, exe: 0, inv: 0, cost: 70, diff: -70 }]);
  });
});

describe('travel', () => {
  it('reads kind and status cells', () => {
    expect(importArrKind('Посредување')).toBe('agent');
    expect(importArrKind('сопствен')).toBe('own');
    expect(importArrStatus('реализиран')).toBe('done');
    expect(importArrStatus('')).toBe('open');
  });
  it('warns on a passport valid less than 3 months after the return', () => {
    const A = { from: '2026-07-01', to: '2026-07-10' };
    expect(passportWarn({ name: 'X', doc: 'A1', docExp: '2026-09-01' }, A, '2026-06-01')).toBe(true);
    expect(passportWarn({ name: 'X', doc: 'A1', docExp: '2026-12-01' }, A, '2026-06-01')).toBe(false);
    expect(passportWarn({ name: 'X', doc: '' }, A, '2026-06-01')).toBe(true);
    expect(seatsExceeded(40, 38, 3)).toBe(41);
    expect(seatsExceeded(40, 37, 3)).toBeNull();
    expect(seatsExceeded(null, 100, 3)).toBeNull();
  });
});

describe('appointments', () => {
  it('builds the WhatsApp link like legacy apRemOne', () => {
    expect(apptWaPhone('070 123 456')).toBe('38970123456');
    expect(apptWaLink('070123456', 'Почитувани')).toBe('https://wa.me/38970123456?text=' + encodeURIComponent('Почитувани'));
    expect(apptWaLink('', 'x')).toBe('');
  });
  it('remind targets: tomorrow, booked, not reminded', () => {
    const L = [{ date: '2026-01-02', status: 'booked', remindAt: null }, { date: '2026-01-02', status: 'booked', remindAt: new Date() }, { date: '2026-01-02', status: 'done' }, { date: '2026-01-03', status: 'booked' }];
    expect(apptRemindTargets(L, '2026-01-02')).toHaveLength(1);
  });
});

describe('recurring', () => {
  it('reads every / day / vat', () => {
    expect(importEvery('тримесечно')).toBe('quarter');
    expect(importEvery('')).toBe('month');
    expect(importRecDay('последен работен ден')).toBe('L');
    expect(importRecDay('15')).toBe('15');
    expect(importVat('5')).toBe(5);
    expect(importVat('7')).toBe(18);
  });
  it('bulk plan uses the own price, else the common one, and lists partners without a price', () => {
    expect(recBulkPlan(['a', 'b', 'c'], 0, { a: '3000', b: 0 })).toEqual({ rows: [{ id: 'a', price: 3000 }], missing: ['b', 'c'] });
    expect(recBulkPlan(['a', 'b'], 2500, { a: 3000 }).rows).toEqual([{ id: 'a', price: 3000 }, { id: 'b', price: 2500 }]);
  });
  it('accounting-fee status', () => {
    expect(accFeeStatus(3000, '', null)).toBe('нова');
    expect(accFeeStatus(3000, '', { price: 2500 })).toBe('нова цена');
    expect(accFeeStatus(3000, '2026-12-31', { price: 3000, end: '' })).toBe('крај');
    expect(accFeeStatus(3000, '', { price: 3000 })).toBe('ок');
  });
});

describe('modules (legacy modOnF tri-state)', () => {
  it('profiles: manual list wins, else from the NKD code', () => {
    expect(firmProfiles('41.20 Изградба', null)).toEqual(['construct']);
    expect(firmProfiles('41.20', { prof: ['hotel'], profSet: true })).toEqual(['hotel']);
    expect(profilesAuto({ prof: [], profSet: false })).toBe(true);
    expect(profilesAuto({ prof: [], profSet: true })).toBe(false);
  });
  it('explicit setting wins over the profile', () => {
    expect(moduleOnFor('cons', ['construct'], {})).toBe(true);
    expect(moduleOnFor('cons', ['construct'], { cons: false })).toBe(false);
    expect(moduleOnFor('hotel', ['construct'], { hotel: true })).toBe(true);
    expect(effectiveModules(['construct'], {})).toEqual(['cons', 'recur', 'pn']);
  });
  it('derives overrides from an old enabled list without changing it', () => {
    const mods = ['hotel', 'cons'];
    const ov = moduleOverrides(mods, ['construct'], null);
    expect(ov).toEqual({ hotel: true, recur: false, pn: false });
    expect(effectiveModules(['construct'], ov)).toEqual(mods);
    expect(setModule(ov, 'hotel', '')).toEqual({ recur: false, pn: false });
    expect(setModule(ov, 'tour', '1').tour).toBe(true);
  });
  it('entity radio keeps a matching legal form', () => {
    expect(legalFormForEntity('doo', 'co')).toBe('doo');
    expect(legalFormForEntity('doo', 'npo')).toBe('zdr');
    expect(legalFormForEntity(null, 'tp')).toBe('tp');
  });
});
