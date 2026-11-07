import { describe, expect, it } from 'vitest';
import { parseOpeningSheet } from './ledger';

describe('parseOpeningSheet: headings in Latin / other programs', () => {
  it('reads Konto / Naziv / Dolzi / Pobaruva', () => {
    const R = parseOpeningSheet([['Konto', 'Naziv', 'Dolzi', 'Pobaruva'], ['1000', 'Жиро сметка', 1500, 0], ['2200', 'Добавувачи', 0, 1500]]);
    expect(R?.rows.map((r) => [r[0], r[4], r[5]])).toEqual([['1000', 1500, 0], ['2200', 0, 1500]]);
  });
  it('reads Account / Debit / Credit and Saldo only', () => {
    expect(parseOpeningSheet([['Account', 'Name', 'Debit', 'Credit'], ['1200', 'Купувачи', '2.000,00', '']])?.rows[0]).toEqual(['1200', 'Купувачи', '', '', 2000, 0]);
    expect(parseOpeningSheet([['Konto', 'Saldo'], ['1000', -300]])?.rows[0]?.slice(4)).toEqual([0, 300]);
  });
  it('still reads the Cyrillic headings', () => {
    expect(parseOpeningSheet([['Конто', 'Назив', 'Должи', 'Побарува'], ['1000', 'x', 10, 0]])?.rows.length).toBe(1);
  });
  it('reads a journal export (налог „P.S.“) with denar and foreign-currency columns: the denar ones, partner code „Ком.ш.“', () => {
    const H = ['*', 'Р.бр.', 'Датум', 'Содржина', 'Конто', 'Должи', 'Побарува', 'Документ', 'Дев.должи', 'Дев.побарува', 'О.ед.', 'Ком.ш.', 'Комитент', 'Прекн/Непрекн.', 'Поч. сос.'];
    const r = (k: string, d: number, p: number, c = '', n = '') => ['', 0, '2026-01-01', 'SALDO', k, d, p, '', 0, 0, '', c, n, 0, 'Da'];
    const R = parseOpeningSheet([H, r('0030', 200000, 0), r('1200', 0, 6000, '1029', 'MAJANCE TRANSPORT SKOPJE'), r('2200', 0, 194000, '1034', 'GLOBUS GROUP')]);
    expect(R?.rows).toEqual([['0030', '', '', '', 200000, 0], ['1200', '', 'MAJANCE TRANSPORT SKOPJE', '1029', 0, 6000], ['2200', '', 'GLOBUS GROUP', '1034', 0, 194000]]);
  });
});
