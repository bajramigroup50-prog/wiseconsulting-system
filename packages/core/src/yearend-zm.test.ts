import { describe, expect, it } from 'vitest';
import { zmCsvGrid, zmParse, zmSplit } from './yearend/zm-import';

describe('zmImport (legacy 10953)', () => {
  it('reads a CSV with ; and decimal commas, sections from the headings', () => {
    const G = zmCsvGrid('﻿Лист;Биланс на состојба\nЛ;001;Постојани средства;1.234.567,00;1.000.000,00\nЛ;Биланс на успех\nЛ;201;Приходи;500,00;;400,00\nЛ;Вкупно;без АОП\n');
    const R = zmParse(G);
    expect(R).toEqual([['bs', '001', 1234567, 1000000], ['bu', '201', 500, 400]]);
    expect(zmSplit(R)).toEqual({ cur: { bs001: 1234567, bu201: 500 }, prev: { bs001: 1000000, bu201: 400 } });
  });
  it('without a heading the section follows the AOP range; one number = current only', () => {
    const R = zmParse([['Sheet1', 'x', '063', 'Вкупна актива', 900], ['Sheet1', '255', 'Нето добивка', 12.4]]);
    expect(R).toEqual([['bs', '063', 900, null], ['bu', '255', 12.4, null]]);
    expect(zmSplit(R).cur).toEqual({ bs063: 900, bu255: 12 });
  });
});
