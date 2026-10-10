import { describe, expect, it } from 'vitest';
import {
  cellDate, cellNum, fxCurrencies, fxExportRows, fxImportRows, kompKindError, kompResolveNumber, kompTotals,
  ppCalValue, ppExportRows, ppFillBanks, ppMuniCode, ppSortByDue, ppToStamp,
} from './fin-parity';
import { analyzeStatements } from './statements';
import { kompNextNumber } from './komp';
import { FX_DEF } from '../bank-match';

describe('курсна листа', () => {
  it('new list holds every FX_DEF currency plus the entered ones', () => {
    const C = fxCurrencies([{ cur: 'EUR' }, { cur: 'MXN' }]);
    expect(C.length).toBe(FX_DEF.length + 1);
    expect(C.at(-1)).toBe('MXN');
  });
  it('export: Датум, Валута, Назив, Среден курс ascending', () => {
    const R = fxExportRows([{ date: '2026-10-02', cur: 'USD', rate: '54.1' }, { date: '2026-10-01', cur: 'EUR', rate: 61.5 }]);
    expect(R).toEqual([['Датум', 'Валута', 'Назив', 'Среден курс'], ['2026-10-01', 'EUR', 'Евро', 61.5], ['2026-10-02', 'USD', 'Американски долар', 54.1]]);
  });
  it('cell parsing', () => {
    expect(cellDate('01.10.2026')).toBe('2026-10-01');
    expect(cellDate('2026-1-5')).toBe('2026-01-05');
    expect(cellDate(46296)).toBe('2026-10-01');
    expect(cellDate('x')).toBe('');
    expect(cellNum('61,5')).toBe(61.5);
    expect(cellNum('1.234,56')).toBe(1234.56);
    expect(cellNum('1,234.56')).toBe(1234.56);
    expect(cellNum('')).toBeNaN();
  });
  it('import groups by date, recognises headings in any order, reports bad rows', () => {
    const r = fxImportRows([
      ['Курс', 'Валута', 'Датум'],
      ['61,6', 'eur', '02.10.2026'],
      [54.2, 'USD', '2026-10-02'],
      [61.5, 'EUR', '2026-10-01'],
      [1, 'MKD', '2026-10-01'],
      ['', '', ''],
      ['abc', 'GBP', '2026-10-01'],
    ]);
    expect(r.lists).toEqual([
      { date: '2026-10-01', rows: [{ cur: 'EUR', rate: 61.5 }] },
      { date: '2026-10-02', rows: [{ cur: 'EUR', rate: 61.6 }, { cur: 'USD', rate: 54.2 }] },
    ]);
    expect(r.errors).toEqual(['Ред 5: неважечка валута „MKD“.', 'Ред 7: неважечки курс.']);
  });
  it('import without headings uses columns A/B/C', () => {
    expect(fxImportRows([['2026-10-01', 'CHF', 65]]).lists).toEqual([{ date: '2026-10-01', rows: [{ cur: 'CHF', rate: 65 }] }]);
  });
});

describe('банки и формати', () => {
  it('KBFileFormat without a recognised bank falls back to 300', () => {
    expect(analyzeStatements([{ no: '1', lines: [] } as never], 'kb', '').bank).toBe('300');
    expect(analyzeStatements(null, 'kb', '').bank).toBe('300');
    expect(analyzeStatements(null, 'kb', '270').bank).toBe('270');
    expect(analyzeStatements(null, 'mt940', '').bank).toBe('');
  });
});

describe('компензации', () => {
  it('bilateral = one partner', () => {
    expect(kompKindError('bi', ['a', 'a'])).toBe('');
    expect(kompKindError('bi', ['a', 'b'])).toMatch(/еден комитент/);
    expect(kompKindError('multi', ['a', 'b'])).toBe('');
  });
  it('duplicate or empty number → next К-nnn/yyyy', () => {
    const next = () => kompNextNumber('2026-05-01', ['К-001/2026', 'К-004/2026']);
    expect(kompResolveNumber('К-004/2026', ['К-001/2026', 'К-004/2026'], next)).toBe('К-005/2026');
    expect(kompResolveNumber('  ', [], next)).toBe('К-005/2026');
    expect(kompResolveNumber('К-9', ['К-001/2026'], next)).toBe('К-9');
  });
  it('live totals', () => {
    expect(kompTotals([{ side: 'rec', amt: '100.10' }, { side: 'pay', amt: 60 }, { side: 'pay', amt: '' }])).toEqual({ rec: 100.1, pay: 60, diff: 40.1 });
  });
});

describe('платни налози', () => {
  it('municipality code from muni, city or address', () => {
    expect(ppMuniCode({ muni: '169' })).toBe('169');
    expect(ppMuniCode({ city: 'Тетово' })).toBe('169');
    expect(ppMuniCode({ muni: '', city: '', address: 'ул. Маршал Тито 5, Тетово' })).toBe('169');
    expect(ppMuniCode({ city: 'Скопје' })).toBe('');
  });
  it('fills empty bank names from the account', () => {
    const o = ppFillBanks({ kind: 'pp30', date: '2026-10-01', payerAcc: '300000000123420', recipAcc: '100000000063095', recipBank: '' });
    expect(o.payerBank).toMatch(/АД Скопје/);
    expect(o.recipBank).toBe('Народна банка на РСМ');
    expect(ppFillBanks({ kind: 'pp30', date: '2026-10-01', recipAcc: '300000000123420', recipBank: 'Моја' }).recipBank).toBe('Моја');
    expect(ppFillBanks({ kind: 'pp10', date: '2026-10-01', payerAcc: '300000000123420' }).payerBank).toBeUndefined();
  });
  it('calibration values', () => {
    expect(ppCalValue('1,3')).toBe(1.5);
    expect(ppCalValue('-2')).toBe(-2);
    expect(ppCalValue('x')).toBe(0);
    expect(ppCalValue(99)).toBe(50);
  });
  it('stamps only unprinted orders, sorts by due', () => {
    expect(ppToStamp([{ id: 'a', printedAt: null }, { id: 'b', printedAt: new Date() }])).toEqual(['a']);
    expect(ppSortByDue([{ date: '2026-01-01', due: '2026-03-01' }, { date: '2026-02-01', due: null }]).map((x) => x.date)).toEqual(['2026-02-01', '2026-01-01']);
  });
  it('export rows', () => {
    const R = ppExportRows([{ kind: 'pp30', date: '2026-10-01', amount: '100.00', printedAt: null, data: { kind: 'pp30', date: '2026-10-01', recip: 'Бета\nСкопје', purpose: 'ф-ра 7' } }]);
    expect(R[1]).toEqual(['2026-10-01', 'ПП30 – Налог за пренос', '', '', 'Бета', '', '', 'ф-ра 7', '', '', '', 100, '']);
  });
});
