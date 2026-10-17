import { describe, expect, it } from 'vitest';
import { jiGroup, jiInvoices, jiIsOpening, jiMonths, jiNameDefault, jiNumber, jiRows, jiSide, jiSynthetic, jiTemplate, jiVatRate } from './journal-import';
import { fixYusciiAll, translitKey } from './text/yuscii';
import { IMP_T, impAuto } from './retail/import';

describe('journal import rows', () => {
  it('debit / credit, amount + side, sign, YUSCII, konto suffix and partner code, fill-down, totals', () => {
    const R = jiRows([
      { r: 2, date: '2026-01-05', type: '06', no: '1', k: '1000', d: 100 },
      { r: 3, k: '1200-029', amt: 100, side: 'П', partner: 'ДЕЛ^ЕВ ДООЕЛ' },
      { r: 4, date: '2026-01-06', type: '06', no: '2', k: '2200', amt: 50, partner: '1029 МАЈАНЦЕ' },
      { r: 5, k: '1000', amt: -50 },
      { r: 6, k: '', desc: 'Вкупно', d: 150, p: 150 },
      { r: 7, date: '2026-01-07', k: '1000', amt: 5, side: 'X' },
      { r: 8, date: '2026-01-07', k: '4000' },
    ]);
    expect(R.rows.map((r) => [r.r, r.date, r.type, r.no, r.k, r.d, r.p, r.pcode, r.pname])).toEqual([
      [2, '2026-01-05', '06', '1', '1000', 10000, 0, '', ''],
      [3, '2026-01-05', '06', '1', '1200', 0, 10000, '029', 'ДЕЛЧЕВ ДООЕЛ'],
      [4, '2026-01-06', '06', '2', '2200', 5000, 0, '1029', 'МАЈАНЦЕ'],
      [5, '2026-01-06', '06', '2', '1000', 0, 5000, '', ''],
    ]);
    expect(R.bad).toEqual([{ r: 7, msg: 'страната „X“ не е Д или П' }]);
    expect(R.skipped).toBe(2);
    expect(jiSide('Dug.')).toBe('d');
    expect(jiSide('pobaruva')).toBe('p');
  });

  it('groups by type + number: per day when every day balances, else per month, else on the last date', () => {
    const { rows } = jiRows([
      { date: '2026-01-05', type: '06', no: '1', k: '1000', d: 10 }, { date: '2026-01-05', type: '06', no: '1', k: '1200', p: 10 },
      { date: '2026-01-09', type: '06', no: '1', k: '1000', d: 5 }, { date: '2026-01-09', type: '06', no: '1', k: '1200', p: 5 },
      { date: '2026-02-03', type: '40', no: '2', k: '1200', d: 7 }, { date: '2026-02-04', type: '40', no: '2', k: '7400', p: 7 },
      { date: '2026-02-28', type: '30', no: '3', k: '4000', d: 3 }, { date: '2026-03-01', type: '30', no: '3', k: '2200', p: 3 },
    ]);
    const G = jiGroup(rows);
    expect(G.unbalanced).toEqual([]);
    expect(G.journals.map((j) => [j.number, j.date, j.rows.length, !!j.warn])).toEqual([
      ['06/1', '2026-01-05', 2, false], ['06/1', '2026-01-09', 2, false], ['40/2', '2026-02-04', 2, true], ['30/3', '2026-03-01', 2, true],
    ]);
    expect(jiMonths(G.journals)).toEqual([
      { m: '2026-01', nalogs: 1, journals: 2, lines: 4, D: 1500, P: 1500 },
      { m: '2026-02', nalogs: 1, journals: 1, lines: 2, D: 700, P: 700 },
      { m: '2026-03', nalogs: 1, journals: 1, lines: 2, D: 300, P: 300 },
    ]);
  });

  it('Latin YUSCII, Latin ↔ Cyrillic key, file-name defaults, invoice groups', () => {
    expect(fixYusciiAll('GULERMAK AGIR SANAJI IN[AAT')).toBe('GULERMAK AGIR SANAJI INŠAAT');
    expect(fixYusciiAll('ДЕЛ^ЕВ и ma~ka')).toBe('ДЕЛЧЕВ и mačka');
    expect(translitKey('KAN INTERNATIONAL')).toBe(translitKey('КАН ИНТЕРНАТИОНАЛ'));
    expect(translitKey('ŠKOLA ŽITO')).toBe(translitKey('ШКОЛА ЖИТО'));
    expect(jiNameDefault('1-1-3.xlsx')).toEqual({ type: '1', no: '1-3' });
    expect(jiNameDefault('NALOG1.xlsx')).toEqual({ type: '', no: '1' });
    expect(jiNameDefault('06-9.xls')).toEqual({ type: '06', no: '9' });
    const { rows } = jiRows([
      { date: '2026-01-06', desc: 'F-1', k: '1200', d: 2360, pcode: '1' }, { date: '2026-01-06', desc: 'F-1', k: '230018', p: 360 }, { date: '2026-01-06', desc: 'F-1', k: '7414', p: 2000 },
      { date: '2026-01-05', desc: 'F-2', k: '1200', d: 77705, pcode: '2' }, { date: '2026-01-05', desc: 'F-2', k: '230018', p: 11853 }, { date: '2026-01-05', desc: 'F-2', k: '7414', p: 65852 },
      { date: '2026-01-07', desc: 'Извод', k: '1000', d: 100 }, { date: '2026-01-07', desc: 'Извод', k: '1200', p: 100, pcode: '1' },
    ]);
    const I = jiInvoices(rows);
    expect(I.inv.map((v) => [v.no, v.lines, v.total])).toEqual([['F-1', [{ account: '7414', base: 200000, rate: 18 }], 236000]]);
    expect(I.refused.map((x) => x.no)).toEqual(['F-2']);
    expect(I.rest).toHaveLength(5);
    expect(jiVatRate('23005')).toBe(5);
    expect(jiIsOpening({ date: '2026-03-01', type: '', no: '', ob: true })).toBe(true);
    expect(jiIsOpening({ date: '2026-01-01', type: 'ПОЧЕТНА СОСТОЈБА', no: '0' })).toBe(true);
    expect(jiIsOpening({ date: '2026-01-01', type: '40', no: '1' })).toBe(false);
  });

  it('numbers never look like WISE counters; synthetic kontos; the template is recognised by the importer', () => {
    expect(jiNumber('06', '9')).toBe('06/9');
    expect(jiNumber('', '1021')).toBe('1021');
    expect(jiNumber('', '0')).toBe('У0');
    expect(jiNumber('', '')).toBeNull();
    expect(jiSynthetic('120', ['120', '1200'])).toBe(true);
    expect(jiSynthetic('1200', ['1200', '12001'])).toBe(false);
    expect(jiSynthetic('999', ['999'])).toBe(false);
    const T = jiTemplate();
    const map = impAuto('journal', T[0]!);
    expect(Object.keys(map).sort()).toEqual(IMP_T.journal.f.map((f) => f[0]).sort());
    expect(IMP_T.journal.f.every(([k], i) => map[k] === i)).toBe(true);
    // the old program's / other programs' headings
    expect(impAuto('journal', ['Datum', 'Vrsta', 'Nalog', 'Konto', 'Iznos', 'D/P', 'Sifra', 'EDB', 'Komitent', 'Opis'])).toEqual({ date: 0, type: 1, no: 2, k: 3, amt: 4, side: 5, pcode: 6, pedb: 7, partner: 8, desc: 9 });
  });
});
