import { describe, expect, it } from 'vitest';
import { grossFromNet } from '../payroll/calc';
import { resolvePayParams } from '../payroll/params';
import { splitStatementByDate } from '../bank/statements';
import { bomFromSuggestion, bomMaterials } from './bom';
import { statementFromRead, readStatementNo } from './bank';
import { inboxClassification } from './classify';
import { employeeFromRead, empNetFromGross } from './employee';
import { fiskAfterRead, fiskApplySimple, fiskEditorRows, fiskFinish, fiskReadTotal, fkFromText, fkN, fkNormDate } from './fisk';
import { rcDoc, rcNum, rcRate, receiptDraftProblem, receiptDrafts } from './receipts';

describe('receipts (BLG_PROMPT → vouchers)', () => {
  it('legacy number / rate / doc helpers', () => {
    expect(rcNum('1.234,56')).toBe(1234.56);
    expect(rcNum('1,234.56')).toBe(1234.56);
    expect(rcNum('1,234')).toBe(1.234); // legacy: a lone comma is the decimal separator
    expect(rcNum('12,5')).toBe(12.5);
    expect(rcNum('1.234')).toBe(1234);
    expect(rcNum('')).toBe(0);
    expect(rcRate(1100, 100, '', 'fuel', 'MK')).toBe(10);
    expect(rcRate(1180, 0, 18, 'food', 'MK')).toBe(18);
    expect(rcRate(500, 0, '', 'fuel', 'MK')).toBe(10);
    expect(rcRate(500, 0, '', 'food', 'MK')).toBe(18);
    expect(rcRate(119, 19, 19, 'fuel', 'DE')).toBe(19);
    expect(rcDoc('ФИСКАЛЕН БРОЈ 0012345')).toBe('0012345');
    expect(rcDoc('Beleg-Nr. 4711')).toBe('4711');
  });
  it('maps every receipt to a draft with konto and rate', () => {
    const r = { receipts: [
      { country: 'mk', currency: 'MKD', date: '2026-03-04', docNo: 'БР: 77', merchant: ' Макпетрол ', total: '1.100,00', vatRate: 10, vatAmount: 100, category: 'fuel', payment: 'cash', liters: 15 },
      { country: 'DE', date: '05.03.2026', total: 119, vatRate: 19, vatAmount: 19, category: 'xxx' },
    ] };
    const D = receiptDrafts(r, { today: '2026-12-31', kontoFor: (cat, abroad) => `${cat}:${abroad ? 'ino' : 'mk'}`, fxFor: (cur) => (cur === 'EUR' ? 61.5 : 0) });
    expect(D).toEqual([
      { date: '2026-03-04', country: 'MK', cur: 'MKD', docNo: '77', merchant: 'Макпетрол', vatId: '', amt: 1100, fx: 1, rate: 10, vat: 100, cat: 'fuel', konto: 'fuel:mk', pay: 'cash', liters: 15 },
      { date: '2026-03-05', country: 'DE', cur: 'EUR', docNo: '', merchant: '', vatId: '', amt: 119, fx: 61.5, rate: 19, vat: '', cat: 'other', konto: 'other:ino', pay: '', liters: '' },
    ]);
    expect(receiptDrafts([{ total: 5 }], { today: '2026-01-01', kontoFor: () => '4499', fxFor: () => 0 })[0]).toMatchObject({ date: '2026-01-01', country: 'MK', cur: 'MKD', amt: 5 });
    expect(receiptDraftProblem({ amt: '', cur: 'MKD', fx: 1, konto: '4499', date: '2026-01-01' }, () => true)).toBe('нема износ');
    expect(receiptDraftProblem({ amt: 5, cur: 'RSD', fx: '', konto: '4499', date: '2026-01-01' }, () => true)).toBe('нема курс');
    expect(receiptDraftProblem({ amt: 5, cur: 'MKD', fx: 1, konto: '9999', date: '2026-01-01' }, (k) => k !== '9999')).toBe('конто не постои');
    expect(receiptDraftProblem({ amt: 5, cur: 'MKD', fx: 1, konto: '4499', date: '2026-01-01' }, () => true)).toBeNull();
  });
});

describe('bank statement (importBankImg → import plan)', () => {
  it('maps items, number, account and one-day balances', () => {
    const st = statementFromRead({
      number: '2026105/1', account: '300-0000012345-67', owner: 'Наша фирма', currency: 'mkd', openingBalance: 1000, closingBalance: 1400, totalDebit: 100, totalCredit: 500,
      items: [
        { date: '2026-03-02', name: 'Купувач ДОО', purpose: 'ф-ра 12/2026', ref: 'R1', code: 625, amount: 500 },
        { date: '2026-03-02', desc: 'Провизија', amount: -100 },
        { date: '', amount: 5 }, { date: '2026-03-02', amount: 0 },
      ],
    })!;
    expect(st).toMatchObject({ format: 'ai', account: '300000001234567', owner: 'Наша фирма', no: '105', date: '2026-03-02', currency: 'MKD', opening: 100000, closing: 140000, debit: 10000, credit: 50000 });
    expect(st.lines).toEqual([
      { date: '2026-03-02', amount: 50000, counterparty: 'Купувач ДОО', ref: 'R1', purpose: 'ф-ра 12/2026', desc: 'Купувач ДОО – ф-ра 12/2026', osnov: '625' },
      { date: '2026-03-02', amount: -10000, counterparty: '', ref: '', purpose: '', desc: 'Провизија' },
    ]);
    expect(splitStatementByDate(st)[0]).toMatchObject({ date: '2026-03-02', no: '105', opening: 100000, closing: 140000 });
  });
  it('several days: no balances; FX lines get the denar value from the printed rate', () => {
    const st = statementFromRead({ currency: 'EUR', rate: 61.5, openingBalance: 10, items: [
      { date: '2026-03-02', amount: 100 }, { date: '2026-03-03', amount: -10, amountMkd: 620 },
    ] })!;
    expect(st.opening).toBeNull();
    expect(st.lines.map((l) => l.amountMkd)).toEqual([615000, -62000]);
    expect(statementFromRead({ items: [] })).toBeNull();
    expect(readStatementNo('Извод бр 7')).toBe('7');
  });
});

describe('employee documents (EMP_PROMPT)', () => {
  const P = resolvePayParams(null, '2026-03');
  it('net from gross is the inverse of grossFromNet with the month params', () => {
    for (const net of [25000, 40000, 90000]) expect(Math.abs(empNetFromGross(grossFromNet(net, P.exempt, P), P) - net)).toBeLessThanOrEqual(1);
  });
  it('new employee and update by ЕМБГ keep legacy precedence', () => {
    const n = employeeFromRead({ name: 'Ана Петрова', embg: '0101990-455-001', position: 'Сметководител', start: '2026-02-01', contract: 'определено', end: '2026-12-31', hoursWeek: 20, grossSalary: 60000 }, { fileName: 'a.pdf', nextNo: '7', P });
    expect(n).toMatchObject({ no: '7', name: 'Ана Петрова', embg: '0101990455001', coef: 0.5, contract: 'определено', leaveDays: 20, active: true });
    expect(n.netBase).toBe(empNetFromGross(60000, P));
    const ex = { id: 'e1', no: '3', name: 'Стар', embg: '0101990455001', position: 'Касиер', netBase: '30000', coef: '1', leaveDays: 25, bankAcc: '200' };
    const u = employeeFromRead({ embg: '0101990455001', netSalary: 35000, contract: 'xx' }, { fileName: 'b.pdf', ex, nextNo: '9', P: null });
    expect(u).toMatchObject({ no: '3', name: 'Стар', position: 'Касиер', netBase: 35000, coef: 1, leaveDays: 25, bankAcc: '200', contract: null });
  });
});

describe('fiscal report (FISK_PROMPT → fiscal rows)', () => {
  it('fkN / fkNormDate', () => {
    expect(fkN('1 880 999.00')).toBe(1880999);
    expect(fkN('1.234,50')).toBe(1234.5);
    expect(fkN('1.234.567')).toBe(1234567);
    expect(fkNormDate('29-09-2026')).toBe('2026-09-29');
  });
  it('daily Z reports → rows per rate; duplicates once; cash = total when no payments', () => {
    const R = fiskAfterRead({ groups: { А: 18, Б: 5, В: 0, Г: 10 }, days: [
      { date: '01.03.2026', z: '11', gross: { А: '1.180,00', Г: 110 }, vat: { А: 180, Г: 10 }, total: 1290, card: 200, cash: 1090 },
      { date: '01.03.2026', z: '11', gross: { А: '1.180,00', Г: 110 }, vat: { А: 180, Г: 10 }, total: 1290, card: 200, cash: 1090 },
      { date: '2026-03-02', z: '12', gross: { А: 590 }, total: 590 },
    ], totals: {} });
    fiskFinish(R, '2026-12-31');
    expect(fiskReadTotal(R)).toBe(1880);
    const X = fiskEditorRows(R, { today: '2026-12-31' });
    expect(X.daily).toBe(true);
    expect(X.rows).toEqual([
      { date: '2026-03-01', z: '11', gross: { 18: 1180, 10: 110 }, total: 1290, card: 200, cash: 1090, receipts: 0, storno: 0 },
      { date: '2026-03-02', z: '12', gross: { 18: 590 }, total: 590, card: 0, cash: 590, receipts: 0, storno: 0 },
    ]);
  });
  it('period total from the transcribed text; non-VAT report', () => {
    const text = 'ПЕРИОД. ФИНАНСИСКИ ИЗВЕШТАЈ\nРЕГ. БРОЈ: AC240119487\nОД: 08-05-2026 ДО: 29-09-2026\nОД: 0001 ДО: 0134\nФИСКАЛНИ СМЕТКИ\nПРОМЕТ Г: 1 880 999.00\nВКУПЕН ПРОМЕТ: 1 880 999.00\nВКУПЕН БРОЈ ФИСК. СМЕТКИ: 420\nСТОРНИ СМЕТКИ\nВКУПЕН ПРОМЕТ: 50.00';
    expect(fkFromText(text)).toMatchObject({ total: 1880999, gross: { Г: 1880999 }, storno: 50, device: 'AC240119487', from: '08-05-2026', to: '29-09-2026', zFrom: '0001', zTo: '0134', receipts: 420, noVat: true });
    const R = fiskAfterRead({ days: [], totals: { gross: {}, total: 0 }, text });
    fiskFinish(R, '2026-12-31');
    expect(R).toMatchObject({ device: 'AC240119487', nonVat: true });
    const X = fiskEditorRows(R, { today: '2026-12-31' });
    expect(X).toEqual({ daily: false, rows: [{ date: '2026-09-29', z: '', gross: { 0: 1880999 }, total: 1880999, card: 0, cash: 1880999, receipts: 420, storno: 50 }] });
    expect(fiskEditorRows(R, { today: '2026-12-31', nonVat: false }).rows[0]!.gross).toEqual({ 10: 1880999 });
  });
  it('FK_SIMPLE second read fills a zero read', () => {
    const R = fiskAfterRead({ days: [], totals: { gross: { А: 0 }, total: 0 } });
    expect(fiskReadTotal(R)).toBe(0);
    fiskApplySimple(R, { total: '12 345.00', group: 'A', vatTotal: 1883.14, to: '31-03-2026', device: 'unknown', receipts: 10 });
    fiskFinish(R, '2026-12-31');
    expect(fiskReadTotal(R)).toBe(12345);
    expect(R.device).toBe('');
    expect(R.nonVat).toBeUndefined();
    expect(fiskEditorRows(R, { today: '2026-12-31' }).rows[0]).toMatchObject({ date: '2026-03-31', gross: { 18: 12345 }, receipts: 10 });
  });
});

describe('BOM suggestion', () => {
  const I = [
    { id: 'p', name: 'Леб', unit: 'ком', type: 'product', active: true },
    { id: 'm1', name: 'Брашно', unit: 'кг', type: 'material', active: true },
    { id: 'm2', name: 'Квасец', unit: 'кг', type: 'goods', active: true },
    { id: 'm3', name: 'Сол', unit: 'кг', type: 'material', active: false },
    { id: 's', name: 'Услуга', unit: '', type: 'service', active: true },
  ];
  it('materials and name matching', () => {
    const M = bomMaterials(I, 'p');
    expect(M.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(bomFromSuggestion({ lines: [{ name: 'Брашно', qty: 0.55555 }, { name: 'квасец', qty: '0.01' }, { name: 'Вода', qty: 0.3 }, { name: 'Брашно', qty: 0 }], missing: [{ name: 'Сол', unit: 'кг', qty: 0.01 }], note: 'Стандарден леб' }, M))
      .toEqual({ lines: [{ itemId: 'm1', qty: 0.5556 }, { itemId: 'm2', qty: 0.01 }], missing: [{ name: 'Сол', unit: 'кг', qty: 0.01 }], note: 'Стандарден леб' });
    expect(bomFromSuggestion(null, M)).toEqual({ lines: [], missing: [], note: '' });
  });
});

describe('inbox classification', () => {
  it('maps legacy kinds to inbox routes', () => {
    expect(inboxClassification({ kind: 'fiscal', what: 'Z извештај' })).toEqual({ kind: 'fiscal', route: 'fisk', what: 'Z извештај' });
    expect(inboxClassification({ kind: 'Purchase' })).toMatchObject({ kind: 'purchase', route: 'purchase' });
    expect(inboxClassification({ kind: 'other' })).toMatchObject({ kind: 'other', route: null });
    expect(inboxClassification({ kind: 'zzz' })).toMatchObject({ kind: null, route: null });
  });
});
