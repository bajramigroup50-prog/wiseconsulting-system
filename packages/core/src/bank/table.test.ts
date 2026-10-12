import { describe, expect, it } from 'vitest';
import { parseBankDate, readBankTable } from '../bank-parsers';
import { bankColRoles, prepBankGrid } from './table';
import { convApply, convCheck, convTarget } from '../convert/index';
import { mergeCloseRows } from '../noai/pdf-rows';

/** The Халк layout the user loaded in the converter (a PDF converted to Excel). */
const HALK = [
  ['HALKBANK АД СКОПЈЕ'], ['ИЗВОД бр. 45 од 05.03.2026 година'], ['Сметка: 270-0000012399-11'], ['Претходна состојба: 1,000,000.00'],
  ['Ред. бр.', 'Назив и седиште на примачот - налогодавач', '', 'ИЗНОС', 'Шифра', 'цел на дознаката', 'Повикување на број (задолжување и'],
  ['', 'број на сметката', '', 'задолжува одобрува', '', '', 'одобрување)'],
  ['1', 'ГАМА КОМЕРЦ ДООЕЛ', '', '0.00', '25,000.00 200', 'Уплата по фактура 47', '0047-2026'],
  ['', '300000000211234', '', '', '', 'и 48/2026', ''],
  ['2', 'ХАЛК БАНКА АД СКОПЈЕ', '', '45.00', '0.00 696', '[AutoProv]надомест за', ''],
  ['', '250000000000001', '', '', '', 'платен промет', ''],
  ['Вкупно задолжување: 45.00'], ['Вкупно одобрување: 25,000.00'], ['Нова состојба: 1,024,955.00'],
];

describe('statement tables (bank/table.ts)', () => {
  it('column roles from headings', () => {
    expect(bankColRoles('ИЗНОС задолжува одобрува')).toEqual(['debit', 'credit']);
    expect(bankColRoles('Повикување на број (задолжување и одобрување)')).toEqual(['ref']);
    expect(bankColRoles('Назив и седиште на примачот - налогодавач број на сметката')).toEqual(['name', 'account']);
    expect(bankColRoles('Дат. книж.')).toEqual(['date']);
    expect(bankColRoles('Дат. вал.')).toEqual(['valDate']);
    expect(bankColRoles('Салдо')).toEqual(['balance']);
    expect(bankColRoles('Р.бр.')).toEqual(['seq']);
  });

  it('Халк: two header rows, two directions in one column, amount glued to the code, no date column', () => {
    const P = prepBankGrid(HALK)!;
    expect([P.hi, P.hn]).toEqual([4, 2]);
    expect(P.meta).toMatchObject({ no: '45', date: '2026-03-05', account: '270000001239911', opening: '1,000,000.00', closing: '1,024,955.00', debit: '45.00', credit: '25,000.00' });
    const R = readBankTable(HALK);
    expect(R.warnings).toEqual([]);
    expect(R.st!.lines).toEqual([
      expect.objectContaining({ date: '2026-03-05', amount: 2500000, counterparty: 'ГАМА КОМЕРЦ ДООЕЛ', iban: '300000000211234', osnov: '200', ref: '0047-2026', purpose: 'Уплата по фактура 47 и 48/2026' }),
      expect.objectContaining({ amount: -4500, osnov: '696', purpose: '[AutoProv]надомест за платен промет' }),
    ]);
    expect([R.st!.opening, R.st!.closing, R.st!.debit, R.st!.credit]).toEqual([100000000, 102495500, 4500, 2500000]);
  });

  it('converter: Халк mapped by roles, the date from the header, balances reconcile, the importer reads it back', () => {
    const t = convTarget('bank')!;
    const p = t.prepare!(HALK)!;
    expect(p.map).toMatchObject({ name: 1, acc: 2, out: 4, in: 5, osnov: 6, purpose: 7, ref: 8 });
    expect(p.map.date).toBeUndefined();
    expect(p.hdr).toEqual({ date: '05.03.2026' });
    const res = convApply(t, p.grid.slice(p.hi + 1), p.map, { hdr: p.hdr, meta: p.meta, rowNos: p.rowNos });
    expect(res.errors).toEqual([]);
    expect(res.notes).toEqual([{ ok: true, msg: expect.stringMatching(/^Салдата се совпаѓаат/) }]);
    const c = convCheck(t, res);
    expect([c.error, c.diff, c.n]).toEqual([undefined, [], 2]);
    // without the header date (and no column) the required field is reported per row
    const bad = convApply(t, p.grid.slice(p.hi + 1), p.map, {});
    expect(bad.errors).toEqual([{ row: 1, msg: 'недостасува: Датум' }, { row: 2, msg: 'недостасува: Датум' }]);
  });

  it('amounts printed below the text line, ordinal starts a transaction, page header repeated, footer skipped', () => {
    const R = readBankTable([
      ['Извод бр. 3', '', '', ''], ['Претходна состојба: 100,00'],
      ['Датум', 'Опис', 'Должи', 'Побарува'],
      ['02.03.2026', 'Уплата АЛФА', '', ''], ['', '', '', '50,00'],
      ['Страна 1 од 2'], ['Датум', 'Опис', 'Должи', 'Побарува'],
      ['03.03.2026', 'Провизија', '', ''], ['', 'за промет', '5,00', ''],
      ['Нова состојба: 145,00'],
    ]);
    expect(R.warnings).toEqual([]);
    expect(R.st!.lines.map((l) => [l.date, l.amount, l.purpose])).toEqual([['2026-03-02', 5000, 'Уплата АЛФА'], ['2026-03-03', -500, 'Провизија за промет']]);
  });

  it('balances as a row of labels over a row of amounts; Д/П indicator; two-digit years', () => {
    const R = readBankTable([
      ['Претходна состојба', 'Вкупно задолжување', 'Вкупно одобрување', 'Нова состојба'], ['1.000,00', '200,00', '50,00', '850,00'],
      ['Датум', 'Опис', 'Износ', 'Д/П'], ['02.03.26', 'Плата', '200,00', 'Д'], ['03.03.26', 'Уплата', '50,00', 'П'],
    ]);
    expect(R.warnings).toEqual([]);
    expect(R.st!.lines.map((l) => [l.date, l.amount])).toEqual([['2026-03-02', -20000], ['2026-03-03', 5000]]);
    expect([R.st!.opening, R.st!.closing, R.st!.debit, R.st!.credit]).toEqual([100000, 85000, 20000, 5000]);
  });

  it('dates: impossible dates are not dates; yyyy.mm.dd', () => {
    expect(parseBankDate('31.02.2026')).toBe('');
    expect(parseBankDate('2026.03.05')).toBe('2026-03-05');
    expect(parseBankDate('05/03/2026')).toBe('2026-03-05');
    expect(parseBankDate('05.03.26')).toBe('2026-03-05');
  });

  it('PDF rows a few points apart without overlapping columns are one row', () => {
    const R = mergeCloseRows([
      { page: 1, y: 700, h: 8, cells: ['02.03.2026', 'АЛФА', '', ''] },
      { page: 1, y: 697, h: 8, cells: ['', '', '', '50,00'] },
      { page: 1, y: 688, h: 8, cells: ['', 'Скопје', '', ''] },
    ]);
    expect(R.map((r) => r.cells)).toEqual([['02.03.2026', 'АЛФА', '', '50,00'], ['', 'Скопје', '', '']]);
  });
});
