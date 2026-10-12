/**
 * Халкбанк statement PDF as pdfjs gives it (synthetic data, the coordinates and text runs of a real statement): a
 * sentence above the table, a 4-line header („Р. бр / на / нал.“, „ИЗНОС“ over „задoлжува“ with a LATIN „o“ and
 * „одобрува“ on the 4th line), the counterparty's bank column („Депонент“), the summary as labels stacked over a line
 * of amounts, whitespace runs hundreds of points wide, an amount printed below its row, page 2 with the repeated
 * header, the „Вкупно денари“ row. Production failure: the row number was read as the amount (Прилив 1,00 … 8,00).
 */
import { describe, expect, it } from 'vitest';
import { readBankTable, statementProblems } from '../bank-parsers';
import { convApply, convCheck, convTarget } from '../convert/index';
import { bankPdfGrid } from './bank-grid';
import { statementFromPdfItems } from './bank';
import type { PdfItem } from './pdf-lines';

const it0 = (page: number, y: number, x: number, s: string, w?: number): PdfItem => ({ page, x, y, w: w ?? s.length * 4.5, h: 8.9, s });
/** A phrase as pdfjs splits it: words and the spaces between them as separate runs. */
const ph = (page: number, y: number, x: number, s: string): PdfItem[] => {
  const out: PdfItem[] = [];
  let cx = x;
  for (const w of s.split(' ')) { out.push(it0(page, y, cx, w)); cx += w.length * 4.5; out.push(it0(page, y, cx, ' ', 2.2)); cx += 2.2; }
  return out.slice(0, -1);
};

const AMTS = [7200, 19300, 20000, 46200, 167900, 288800, 723900, 2604600];
const dot = (c: number) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

function header(page: number): PdfItem[] {
  return [
    ...ph(page, 337.3, 26.0, 'Р . бр'), ...ph(page, 337.3, 66.5, 'Назив и средиште на примачот -'), ...ph(page, 337.3, 235.9, 'Депонент на'),
    it0(page, 337.3, 358.9, 'ИЗНОС'), it0(page, 337.3, 437.1, 'Шифра'), ...ph(page, 337.3, 502.6, 'цел на дознаката'),
    ...ph(page, 337.3, 605.8, 'Повикување на број'), ...ph(page, 337.3, 704.5, 'Податоци за'),
    it0(page, 325.3, 26.0, 'на'), it0(page, 325.3, 102.1, 'налогодавачот'), ...ph(page, 325.3, 221.8, '( назив и седиште нa'),
    ...ph(page, 325.3, 612.4, '( задолуживање и'), it0(page, 325.3, 703.5, 'рекламација'),
    ...ph(page, 313.3, 26.0, 'нал .'), ...ph(page, 313.3, 243.1, 'банката )'), ...ph(page, 313.3, 621.3, 'одобрување )'),
    ...ph(page, 304.1, 91.4, 'број на сметката'), it0(page, 304.1, 158.2, ' ', 161.6),
    it0(page, 304.1, 319.9, 'зад', 12.4), it0(page, 304.1, 332.2, 'o', 4.4), it0(page, 304.1, 336.6, 'лжува', 24.9), it0(page, 304.1, 385.5, 'одобрува', 36.1),
  ];
}
/** One transaction (3 lines); `low` = the amount printed on its own line 5.5 pt below the row. */
function row(page: number, y: number, n: number, name: string, acc: string, code: string, low = false): PdfItem[] {
  const a = dot(AMTS[n - 1]!);
  return [
    it0(page, y + 0.9, 215.0, 'ДЕПОНЕНТ БАНКА'), it0(page, y + 1.5, 612.8, '270099999920174'), it0(page, y + 0.9, 694.5, '924342812275' + n),
    it0(page, y, 34.7, String(n)), it0(page, y, 39.1, ' ', 655.4), it0(page, y, 55.2, name), it0(page, y, 445.6, code), it0(page, y, 472.5, 'Плаќање по налог ' + n),
    it0(page, low ? y - 5.5 : y - 0.4, 371.2 - a.length * 4.5, a), it0(page, y - 0.4, 371.2, ' ', 45.2), it0(page, y - 0.2, 416.4, '0.00'), it0(page, y - 0.2, 431.8, ' ', 181),
    it0(page, y - 12, 55.2, acc), it0(page, y - 12, 215.0, 'Скопје'), it0(page, y - 12, 472.5, 'дополнителен опис'),
  ];
}

function statement(amt8 = AMTS[7]!): PdfItem[] {
  AMTS[7] = amt8;
  const I: PdfItem[] = [
    ...ph(1, 584.6, 21.6, 'ХАЛКБАНК АД Скопје'), ...ph(1, 583.3, 345.6, 'ИЗВОД БРОЈ'), it0(1, 583.0, 414.2, '18'),
    ...ph(1, 555.2, 260.4, 'ЗА ПРОМЕНИ НА СОСТОЈБАТА НА СРЕДСТВАТА НА СМЕТКА НА ДЕН'), it0(1, 554.5, 577.6, '01.06.2026'), it0(1, 554.6, 637.4, 'ГОДИНА'),
    ...ph(1, 528.9, 21.8, 'ПРИМЕР ТРЕЈД ДОО Скопје'), it0(1, 528.9, 124.1, ' ', 376.7), it0(1, 529.3, 685.1, '270-0999999201-74'),
    it0(1, 456.4, 38.8, 'претходна'), it0(1, 444.4, 42.6, 'состојба'), ...ph(1, 460.0, 147.2, 'дневен промет'), ...ph(1, 457.6, 274.4, 'нова состојба'),
    ...ph(1, 458.4, 400.5, 'број на налози'),
    it0(1, 431.8, 122.2, 'долгува'), it0(1, 431.2, 198.8, 'побарува'), it0(1, 431.2, 358.6, 'задолжување'), it0(1, 431.2, 444.2, 'одобрување'),
    ...ph(1, 431.2, 514.8, 'Доделен рамковен кредит :'), it0(1, 431.2, 692.1, '0.00'),
    it0(1, 399.3, 58.4, '51,158.00'), it0(1, 399.3, 93.6, ' ', 212.6), it0(1, 398.5, 138.2, '38,779.00'), it0(1, 399.6, 238.8, '0.00'),
    it0(1, 399.1, 306.2, '12,379.00'), it0(1, 400.2, 422.3, '8'), it0(1, 400.0, 503.3, '0'), ...ph(1, 400.0, 515.4, 'Искористен рамк . кредит :'), it0(1, 399.0, 693.1, '0.00'),
    ...ph(1, 366.3, 269.7, 'ЗБИРЕН ИЗВЕШТАЈ ЗА ОДОБРУВАЊЕ - ЗАДОЛЖУВАЊЕ'),
    ...ph(1, 352.0, 22.8, 'Примивме во корист / на товар на сметка'),
    ...header(1),
    ...row(1, 280.7, 1, 'ХАЛКБАНК АД Скопје - Провизија', '270000000010654', '666'),
    ...row(1, 242.5, 2, 'Даночна управа', '100000000063095', '843'),
    ...row(1, 205.4, 3, 'ХАЛКБАНК АД СКОПЈЕ', '270000000100185', '289'),
    ...row(1, 179.2, 4, 'Вработување', '100000000063095', '843'),
    ...row(1, 142.0, 5, 'Данок', '100000000063095', '840'),
    ...row(1, 104.8, 6, 'Здравство', '100000000063095', '843', true),
    ...row(1, 67.7, 7, 'Пензиско', '100000000063095', '843'),
    ...ph(1, 30.0, 22.0, 'Извод број 18 за сметка : 270099999920174'), it0(1, 30.0, 700, 'Страна 1/2'),
    ...ph(2, 584.6, 21.6, 'ХАЛКБАНК АД Скопје'),
    ...header(2),
    ...row(2, 280.7, 8, 'ПЕТРЕСКИ ПЕТАР', '320500028517302', '101'),
    it0(2, 240.0, 22.0, 'Вкупно'), ...ph(2, 240.0, 80, 'за сметката 270-0999999201-74'), ...ph(2, 240.0, 215, 'Вкупно денари'),
    it0(2, 240.0, 336.0, '38,779.00'), it0(2, 240.0, 416.4, '0.00'),
    ...ph(2, 228.0, 22.0, '( Има 8 налози )'),
    ...ph(2, 30.0, 22.0, 'Извод број 18 за сметка : 270099999920174'), it0(2, 30.0, 700, 'Страна 2/2'),
  ];
  return I;
}

describe('Халкбанк statement layout (PDF text items)', () => {
  it('8 debits with exact amounts, none from the row number; statement data; reconciles', () => {
    const r = statementFromPdfItems(statement())!;
    expect(r.items!.map((x) => Math.round(Number(x.amount) * 100))).toEqual(AMTS.map((a) => -a));
    expect(r.items!.reduce((a, x) => a + Math.round(Number(x.amount) * 100), 0)).toBe(-3877900);
    expect(r).toMatchObject({ number: '18', account: '270099999920174', openingBalance: 51158, closingBalance: 12379, totalDebit: 38779, totalCredit: 0, balanced: true });
    expect(r.blocking ?? []).toEqual([]);
    expect(r.items![0]).toMatchObject({ date: '2026-06-01', name: 'ХАЛКБАНК АД Скопје - Провизија', code: '666' });
    expect(r.items![7]).toMatchObject({ name: 'ПЕТРЕСКИ ПЕТАР', code: '101' });
  });

  it('converter: задолжува → Одлив, одобрува → Прилив by position, Р. бр. is not an amount, balances reconcile', () => {
    const t = convTarget('bank')!;
    const p = t.prepare!(bankPdfGrid(statement())!.grid)!;
    expect(p.map.out).toBeDefined();
    expect(p.map.in).toBeDefined();
    expect(p.map.amount).toBeUndefined();
    expect(p.grid[p.hi]![p.map.out!]).toMatch(/ИЗНОС зад.лжува/);
    const res = convApply(t, p.grid.slice(p.hi + 1), p.map, { hdr: p.hdr, meta: p.meta, rowNos: p.rowNos });
    expect(res.recs.map((r) => [r.in ?? 0, r.out])).toEqual(AMTS.map((a) => [0, a / 100]));
    expect(res.notes.every((n) => n.ok)).toBe(true);
    const c = convCheck(t, res);
    expect([c.error, c.diff]).toEqual([undefined, []]);
    // the downloaded file on /banka: same statement, nothing blocking
    const R = readBankTable(res.grid as unknown[][]);
    expect(R.blocking).toEqual([]);
    expect([R.st!.opening, R.st!.closing, R.st!.debit, R.st!.credit]).toEqual([5115800, 1237900, 3877900, 0]);
  });

  it('HARD BLOCK: amounts that do not add up to the printed totals / closing balance', () => {
    const bad = statement(2604700); // one denar off in the last row
    const r = statementFromPdfItems(bad)!;
    expect(r.balanced).toBe(false);
    expect(r.blocking).toEqual([
      expect.stringMatching(/^Салдата не се совпаѓаат: претходна состојба 51\.158,00 \+ приливи 0,00 − одливи 38\.780,00 = 12\.378,00, а во изводот новата состојба е 12\.379,00 \(разлика 1,00\)/),
      expect.stringMatching(/одливи \(задолжување\) е 38\.780,00, а во изводот „Вкупно задолжување“ е 38\.779,00/),
    ]);
    const t = convTarget('bank')!;
    const p = t.prepare!(bankPdfGrid(bad)!.grid)!;
    const res = convApply(t, p.grid.slice(p.hi + 1), p.map, { hdr: p.hdr, meta: p.meta, rowNos: p.rowNos });
    expect(res.notes.filter((n) => !n.ok)).toHaveLength(2);
    AMTS[7] = 2604600;
  });

  it('the production failure (row numbers as Прилив 1,00 … 8,00) is refused by the statement check', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ date: '2026-06-01', amount: (i + 1) * 100, counterparty: '', ref: '', purpose: '', desc: '' }));
    expect(statementProblems({ opening: 5115800, closing: 1237900, debit: 3877900, credit: 0, lines })).toHaveLength(3);
    expect(statementProblems({ opening: null, closing: null, debit: 3877900, credit: 0, lines })).toEqual([
      'Збирот на прочитаните одливи (задолжување) е 0,00, а во изводот „Вкупно задолжување“ е 38.779,00 (разлика 38.779,00).',
      'Збирот на прочитаните приливи (одобрување) е 36,00, а во изводот „Вкупно одобрување“ е 0,00 (разлика -36,00).',
    ]);
  });
});
