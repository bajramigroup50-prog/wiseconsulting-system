import { describe, expect, it } from 'vitest';
import { parseBankTable } from './bank-parsers';
import { convApply, convCheck, convTarget } from './convert/index';
import { parseCardTable } from './finance';
import { parseOpeningSheet } from './ledger';
import { statementFromPdf } from './noai/bank';
import { pdfLines, type PdfItem } from './noai/pdf-lines';
import { invoiceFromPdf } from './noai/purchase';
import { AmbiguousAmountsError, colFormat, numEvidence, numStr, parseNumAuto } from './numfmt';
import { plxParse } from './payroll/xlsx-import';
import { impNum, impNumFormats } from './retail/import';

describe('number format detection', () => {
  it('value evidence', () => {
    expect(['10.000,50', '1.234,56', '12,5', '1234,56', '0,125'].map(numEvidence)).toEqual(['mk', 'mk', 'mk', 'mk', 'mk']);
    expect(['1,234.56', '1234.56', '0.5', '0.125', '12.3456'].map(numEvidence)).toEqual(['dot', 'dot', 'dot', 'dot', 'dot']);
    expect(['10.000', '1.500.000', '1,500'].map(numEvidence)).toEqual(['amb', 'amb', 'amb']);
    expect(['1234', '', 'текст', 12.5].map(numEvidence)).toEqual(['none', 'none', 'none', 'none']);
  });

  it('a column takes the evidence of all its values', () => {
    expect(colFormat(['10.000', '1.234,56'])).toBe('mk');
    expect(colFormat(['10.000', '1234.56'])).toBe('dot');
    expect(colFormat(['10.000', '1.500'])).toBe('amb');
    expect(colFormat(['1.234,56', '1234.56'])).toBe('conflict');
  });

  it('„10.000“ in an MK column → 10000, „10.000,50“ → 10000.50, „1234.56“ → 1234.56', () => {
    expect(parseNumAuto('10.000', 'mk')).toBe(10000);
    expect(parseNumAuto('10.000,50', 'dot')).toBe(10000.5); // own evidence wins
    expect(parseNumAuto('1234.56', 'mk')).toBe(1234.56);
    expect(parseNumAuto('10.000', 'dot')).toBe(10);
    expect(parseNumAuto('12,50-', 'mk')).toBe(-12.5);
    expect(impNum('10.000')).toBe(10000);
    expect(impNum('10.000', 'dot')).toBe(10);
  });

  it('JS numbers are written so that no reader misreads them', () => {
    expect(numStr(10.123)).toBe('10.1230');
    expect(numEvidence(numStr(10.123))).toBe('dot');
    expect(numStr(30000)).toBe('30000');
  });
});

describe('ambiguous-only columns are blocked until „Децимали“ is chosen', () => {
  it('converter: blocked, the check refuses, a choice unblocks', () => {
    const t = convTarget('imp:journal')!;
    const rows = [['01.01.2026', '1000', '10.000', ''], ['01.01.2026', '9000', '', '10.000']];
    const map = { date: 0, k: 1, d: 2, p: 3 };
    const r = convApply(t, rows, map);
    expect(r).toMatchObject({ blocked: true, ambiguous: ['Должи', 'Побарува'] });
    expect(convCheck(t, r).error).toMatch(/Децимали/);
    const mk = convApply(t, rows, map, { dec: 'comma' });
    expect(mk.blocked).toBe(false);
    expect(mk.recs.map((x) => [x.d, x.p])).toEqual([[10000, undefined], [undefined, 10000]]);
    expect(convApply(t, rows, map, { dec: 'dot' }).recs[0]!.d).toBe(10);
    // a column with MK evidence is not blocked: „10.000“ there is ten thousand
    const ev = convApply(t, [['01.01.2026', '1000', '10.000', ''], ['01.01.2026', '1100', '250,50', ''], ['01.01.2026', '9000', '', '10.250,50']], map);
    expect(ev.blocked).toBe(false);
    expect(ev.recs[0]!.d).toBe(10000);
  });

  it('generic importer / payroll: the ambiguous columns are reported', () => {
    expect(impNumFormats([['10.000'], ['1.500']], [{ key: 'qty', label: 'Количина', idx: 0 }])).toMatchObject({ ambiguous: ['Количина'], examples: ['10.000', '1.500'] });
    expect(impNumFormats([['10.000'], ['1.500,25']], [{ key: 'qty', label: 'Количина', idx: 0 }])).toMatchObject({ ambiguous: [], dec: { qty: 'comma' } });
    const aoa = [['ЕМБГ', 'Име и презиме', 'Нето плата', 'Годишен одмор (ч)'], ['0101990450001', 'Б', '30.000', '16']];
    expect(plxParse(aoa)).toMatchObject({ error: expect.stringMatching(/Децимали/) });
    expect(plxParse(aoa, 'comma')).toMatchObject({ rows: [expect.objectContaining({ net: 30000 })] });
  });

  it('partner card: ambiguous amounts are not guessed', () => {
    expect(() => parseCardTable([['Датум', 'Документ', 'Должи', 'Побарува'], ['05.01.2026', '15', '1.180', '']])).toThrow(AmbiguousAmountsError);
    expect(parseCardTable([['Датум', 'Документ', 'Должи', 'Побарува'], ['05.01.2026', '15', '1.180', ''], ['06.01.2026', '16', '', '2.000,50']])!.rows[0]!.debit).toBe(1180);
  });
});

describe('reconciliation picks the interpretation whose totals agree', () => {
  it('bank table: opening + movements = closing', () => {
    const head = [['Претходна состојба: 500'], ['Датум', 'Опис', 'Прилив', 'Одлив']];
    const mk = parseBankTable([...head, ['02.03.2026', 'Уплата', '10.000', ''], ['Нова состојба: 10.500']])!;
    expect(mk.lines[0]!.amount).toBe(1000000);
    const dot = parseBankTable([...head, ['02.03.2026', 'Уплата', '10.000', ''], ['Нова состојба: 510']])!;
    expect(dot.lines[0]!.amount).toBe(1000);
    // nothing decides (no balances): flagged
    expect(() => parseBankTable([['Датум', 'Опис', 'Прилив'], ['02.03.2026', 'Уплата', '10.000']])).toThrow(AmbiguousAmountsError);
    // explicit choice
    expect(parseBankTable([['Датум', 'Опис', 'Прилив'], ['02.03.2026', 'Уплата', '10.000']], 'mk')!.lines[0]!.amount).toBe(1000000);
  });

  it('opening balance: debit = credit', () => {
    const H = ['Конто', 'Назив', 'Салдо должи', 'Салдо побарува'];
    const P = parseOpeningSheet([H, ['1000', 'Жиро', '10.000', ''], ['1200', 'Купувачи', '500', ''], ['9000', 'Капитал', '', '10.500']])!;
    expect(P.rows.map((r) => [r[4], r[5]])).toEqual([[10000, 0], [500, 0], [0, 10500]]);
    // every amount ambiguous: both readings balance → flagged
    expect(() => parseOpeningSheet([H, ['1000', 'Жиро', '10.000', ''], ['9000', 'Капитал', '', '10.000']])).toThrow(AmbiguousAmountsError);
    expect(parseOpeningSheet([H, ['1000', 'Жиро', '10.000', ''], ['9000', 'Капитал', '', '10.000']], 'excel', 'dot')!.rows[0]![4]).toBe(10);
  });

  const page = (rows: [number, string][][]): PdfItem[] => rows.flatMap((r, i) => r.map(([x, s]) => ({ page: 1, x, y: 800 - i * 14, w: s.length * 5, h: 9, s })));

  it('invoice PDF: base × rate = VAT and Σ = total', () => {
    const inv = invoiceFromPdf(pdfLines(page([[[50, 'ФАКТУРА бр. 5']], [[50, 'Датум: 01.02.2026']], [[50, 'ДДВ 18%'], [200, '1.000'], [300, '180']], [[50, 'Вкупно за плаќање'], [300, '1.180']]])))!;
    expect(inv.groups).toEqual([{ rate: 18, base: 1000, vat: 180, kind: 'other' }]);
    expect(inv.total).toBe(1180);
  });

  it('bank statement PDF: the balances decide; unreconcilable → flagged', () => {
    const mk = (closing: string) => pdfLines(page([
      [[50, 'Претходна состојба:'], [300, '500']],
      [[50, 'Датум'], [130, 'Налогодавач'], [300, 'Цел'], [430, 'Должи'], [500, 'Побарува']],
      [[50, '02.03.2026'], [130, 'АЛФА'], [300, 'Уплата'], [500, '10.000']],
      [[50, 'Нова состојба:'], [300, closing]],
    ]));
    expect(statementFromPdf(mk('10.500'))!.items![0]!.amount).toBe(10000);
    expect(statementFromPdf(mk('510'))!.items![0]!.amount).toBe(10);
    expect(() => statementFromPdf(mk('999'))).toThrow(AmbiguousAmountsError);
  });
});
