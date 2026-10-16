import { describe, expect, it } from 'vitest';
import { buildOpening, parseOpeningSheet, type ObRow } from '../ledger';
import { normalSide, obAutoSide } from './ob';

const sides = (R: readonly ObRow[]) => R.map((r) => [r[0], r[4], r[5]]);
const sum = (R: readonly ObRow[]) => [R.reduce((a, r) => a + r[4], 0), R.reduce((a, r) => a + r[5], 0)];

describe('P39 normalSide', () => {
  it('assets debit, liabilities / capital credit, unsure for value adjustments and result classes', () => {
    expect(['1000', '1200', '0220', '3100', '6600'].map(normalSide)).toEqual(['d', 'd', 'd', 'd', 'd']);
    expect(['2200', '2400', '9000', '9500'].map(normalSide)).toEqual(['p', 'p', 'p', 'p']);
    expect(normalSide('9600')).toBe('d');
    expect(['0290', '1290', '5000', '7400', '8000', '9940', 'xx'].map(normalSide)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('P39 obAutoSide on typical imported sheets', () => {
  it('one „Салдо“ column with signs: the sign decides, nothing to press', () => {
    const P = parseOpeningSheet([['Конто', 'Назив', 'Комитент', 'Салдо'],
      ['1000', 'Жиро сметка', '', '50.000,00'], ['1200', 'Купувачи', 'Алфа ДООЕЛ', '20.000,00'], ['1200', 'Купувачи', 'Бета ДОО', '-1.000,00'],
      ['2200', 'Добавувачи', 'Гама ДОО', '-30.000,00'], ['9000', 'Основна главнина', '', '-39.000,00']])!;
    expect(P.side).toEqual({ mode: 'signed', hdr: null });
    const r = obAutoSide(P.rows, P.side);
    expect(r).toMatchObject({ how: 'kept', sure: true, changed: 0 });
    // the customer with an overpayment stays on побарува (exception by the sign)
    expect(sides(r.rows)).toEqual([['1000', 50000, 0], ['1200', 20000, 0], ['1200', 0, 1000], ['2200', 0, 30000], ['9000', 0, 39000]]);
  });

  it('a signed column in the П−Д convention: by the heading, or detected from the normal balances', () => {
    const G = (h: string) => [['Конто', 'Назив', h], ['1000', 'Банка', -500], ['1200', 'Купувачи', -300], ['3100', 'Материјали', -200], ['2200', 'Добавувачи', 600], ['9000', 'Капитал', 400]];
    const H = parseOpeningSheet(G('Салдо (П-Д)'))!;
    expect(H.side).toEqual({ mode: 'signed', hdr: 'pd' });
    expect(sides(obAutoSide(H.rows, H.side).rows)).toEqual([['1000', 500, 0], ['1200', 300, 0], ['3100', 200, 0], ['2200', 0, 600], ['9000', 0, 400]]);
    const N = parseOpeningSheet(G('Салдо'))!;
    const r = obAutoSide(N.rows, N.side);
    expect(r.how).toBe('flip');
    expect(sides(r.rows)).toEqual(sides(obAutoSide(H.rows, H.side).rows));
    expect(r.hint).toMatch(/обратен знак/);
  });

  it('separate Должи / Побарува columns: kept as they are', () => {
    const P = parseOpeningSheet([['Конто', 'Назив', 'Салдо должи', 'Салдо побарува'], ['1000', 'Банка', 1000, 0], ['2200', 'Добавувачи', 0, 400], ['2200', 'Добавувачи', 100, 0], ['9000', 'Капитал', 0, 700]])!;
    expect(P.side?.mode).toBe('columns');
    const r = obAutoSide(P.rows, P.side);
    expect(r).toMatchObject({ how: 'kept', sure: true, hint: '' });
    expect(r.rows).toEqual(P.rows);
  });

  it('everything as positive numbers: placed by class, Σ должи = Σ побарува', () => {
    const P = parseOpeningSheet([['Конто', 'Назив', 'Комитент', 'Салдо'],
      ['1000', 'Жиро сметка', '', 50000], ['1200', 'Купувачи', 'Алфа', 20000], ['3100', 'Материјали', '', 9000],
      ['2200', 'Добавувачи', 'Гама', 30000], ['2400', 'Обврски за плати', '', 10000], ['9000', 'Основна главнина', '', 39000]])!;
    expect(P.side).toEqual({ mode: 'unsigned', hdr: null });
    expect(sum(P.rows)).toEqual([158000, 0]);
    const r = obAutoSide(P.rows, P.side);
    expect(r).toMatchObject({ how: 'class', sure: true, changed: 3 });
    expect(sum(r.rows)).toEqual([79000, 79000]);
    expect(sides(r.rows)).toEqual([['1000', 50000, 0], ['1200', 20000, 0], ['3100', 9000, 0], ['2200', 0, 30000], ['2400', 0, 10000], ['9000', 0, 39000]]);
    // and the editor builds a balanced opening from it
    expect(buildOpening({ rows: r.rows, totals: [], src: 'excel' }, { full: false, partners: [] }).control.D).toBe(79000);
  });

  it('positive numbers with a value adjustment (x9): the one balancing assignment decides', () => {
    const rows: ObRow[] = [['0220', 'Опрема', '', '', 10000, 0], ['0290', 'Исправка на вредноста', '', '', 4000, 0], ['1000', 'Банка', '', '', 2000, 0], ['9000', 'Капитал', '', '', 8000, 0]];
    const r = obAutoSide(rows); // a read without a mode: everything on должи
    expect(r.sure).toBe(true);
    expect(sides(r.rows)).toEqual([['0220', 10000, 0], ['0290', 0, 4000], ['1000', 2000, 0], ['9000', 0, 8000]]);
  });

  it('not sure (does not balance): rows stay as read, a hint and the class suggestion instead of a guess', () => {
    const rows: ObRow[] = [['1000', 'Банка', '', '', 1000, 0], ['2200', 'Добавувачи', '', '', 300, 0]];
    const r = obAutoSide(rows, { mode: 'unsigned', hdr: null });
    expect(r).toMatchObject({ how: 'kept', sure: false, changed: 1 });
    expect(r.rows).toEqual(rows);
    expect(sides(r.suggestion!)).toEqual([['1000', 1000, 0], ['2200', 0, 300]]);
    expect(r.hint).toMatch(/не може сигурно/);
    // two unknown accounts of the same amount balance either way → not sure
    const amb = obAutoSide([['1000', 'Банка', '', '', 100, 0], ['9000', 'Капитал', '', '', 100, 0], ['5000', 'x', '', '', 50, 0], ['8000', 'y', '', '', 50, 0]]);
    expect(amb.sure).toBe(false);
    expect(amb.hint).toMatch(/повеќе распореди/);
  });
});
