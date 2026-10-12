import { describe, expect, it } from 'vitest';
import { fiskAfterRead, fiskEditorRows, fiskFinish } from '../ai/fisk';
import { receiptDrafts } from '../ai/receipts';
import { mpinNorm } from '../law/mpin-in';
import { amountsIn, NOAI_NOTE } from './doc-text';
import { fiscalReportFromLines } from './fiscal-report';
import { FISK_DAILY, FISK_PERIODIC, MPIN_DECL, RECEIPT_FUEL, RECEIPT_SHOP } from './free-docs.fixtures';
import { mpinFromPdf, mpinFromText, mpinPeriodIn } from './mpin';
import { pdfLines, type PdfItem } from './pdf-lines';
import { receiptFromLines } from './receipt';

const swap = (L: readonly string[], from: string, to: string) => L.map((s) => s.replace(from, to));

describe('doc-text amounts', () => {
  it('strict 2-decimal amounts in every notation, percentages ignored', () => {
    expect(amountsIn('ПРОМЕТ А 1 880 999.00')).toEqual([1880999]);
    expect(amountsIn('165,529.00  165.529,00  7,50')).toEqual([165529, 165529, 7.5]);
    expect(amountsIn('ДДВ А 18.00%  18 000.00')).toEqual([18000]);
    expect(amountsIn('ВКУПЕН БРОЈ 412  10.000')).toEqual([]);
  });
});

describe('МПИН „Декларација за прием“ without AI', () => {
  it('text export: header, table by column, checks pass, mpinNorm gives the inbox row', () => {
    const r = mpinFromText(MPIN_DECL);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ edb: '4030999123456', name: 'ТЕСТ ТРЕЈД ДООЕЛ Скопје', period: '2026-09', status: 'ПРИФАТЕНА', subNo: '2026091234567',
      subDate: '2026-10-10', gross: 100000, pio: 18800, zdr: 7500, dop: 500, vrab: 1200, staz: 0, tax: 7200, total: 35200, insured: 3, due: '2026-10-15', folio: '1234567890' });
    const M = mpinNorm(r.data);
    expect(M).toMatchObject({ period: '2026-09', net: 64800, diff: 0 });
  });

  it('PDF items: columns found by x position even when the header is wrapped over two lines', () => {
    const it: PdfItem[] = [];
    const put = (y: number, x: number, s: string) => it.push({ page: 1, x, y, w: s.length * 4.5, h: 8, s });
    put(800, 40, 'ДЕКЛАРАЦИЈА ЗА ПРИЕМ'); put(780, 40, 'Идентификација на обврзникот: 4030999123456');
    put(770, 40, 'Период за кој се поднесува: 09/2026');
    // header in two lines, columns at 160 / 230 / 300 / 370 / 440 / 510
    put(720, 150, 'ПИО'); put(720, 220, 'Здравство'); put(720, 290, 'Дополнителен'); put(710, 290, 'придонес 0,5%');
    put(720, 360, 'Придонес за'); put(710, 360, 'вработување'); put(720, 430, 'Стаж со'); put(710, 430, 'зголемено'); put(720, 500, 'Персонален'); put(710, 500, 'данок');
    const row = (y: number, label: string, V: string[]) => { put(y, 40, label); V.forEach((v, i) => { if (v) put(y, 150 + i * 70, v); }); };
    row(690, 'Бруто основица', ['100,000.00', '100,000.00', '100,000.00', '100,000.00', '', '72,000.00']);
    row(675, 'Стапка', ['18.80%', '7.50%', '0.50%', '1.20%', '', '10.00%']);
    row(660, 'Месечен износ на придонес', ['18,800.00', '7,500.00', '500.00', '1,200.00', '', '7,200.00']); // стаж empty
    put(640, 40, 'Вкупен износ на социјални придонеси и персонален данок: 35,200.00');
    const r = mpinFromPdf(pdfLines(it));
    expect(r.why).toBe('');
    expect(r.data).toMatchObject({ gross: 100000, pio: 18800, zdr: 7500, dop: 500, vrab: 1200, staz: 0, tax: 7200, total: 35200 });
  });

  it('a wrong column → not accepted, with the reason (AI then reads it)', () => {
    const r = mpinFromText(swap(MPIN_DECL, '18,800.00', '18,300.00'));
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.why).toMatch(/≠/);
  });

  it('no control printed (no total, no rates) → not accepted', () => {
    const r = mpinFromText(MPIN_DECL.filter((s) => !/^Стапка|^Вкупен износ/.test(s)));
    expect(r).toMatchObject({ ok: false, why: 'нема контролен збир (вкупно / стапки) за проверка' });
  });

  it('not an МПИН → reason', () => {
    expect(mpinFromText(['Фактура бр. 12', 'Вкупно 1.000,00']).why).toBe('не е МПИН декларација');
  });

  it('period notations', () => {
    expect(['09/2026', '9.2026', '2026-09', 'септември 2026'].map(mpinPeriodIn)).toEqual(['2026-09', '2026-09', '2026-09', '2026-09']);
  });
});

describe('fiscal report without AI', () => {
  it('periodic report → FiskRead; the Macedonian subset and storno are not counted', () => {
    const r = fiscalReportFromLines(FISK_PERIODIC);
    expect(r.why).toBe('');
    expect(r.data).toMatchObject({
      device: 'AC240119487', edb: '4030999111222', from: '2026-09-01', to: '2026-09-30', zFrom: '0101', zTo: '0130', days: [], noai: true, note: NOAI_NOTE,
      groups: { А: 18, Б: 5, В: 0, Г: 10 },
      totals: { gross: { А: 118000, Б: 10500, В: 1000, Г: 5500 }, vat: { А: 18000, Б: 500, Г: 500 }, total: 135000, cash: 100000, card: 35000, storno: 590, receipts: 412 },
    });
    // the same normalisation as an AI read → editor rows per VAT rate
    const R = fiskFinish(fiskAfterRead(r.data), '2026-10-12');
    expect(fiskEditorRows(R, { today: '2026-10-12' }).rows).toEqual([
      { date: '2026-09-30', z: '', gross: { 18: 118000, 5: 10500, 0: 1000, 10: 5500 }, total: 135000, card: 35000, cash: 100000, receipts: 412, storno: 590 },
    ]);
  });

  it('daily Z reports → one day each + totals', () => {
    const r = fiscalReportFromLines(FISK_DAILY);
    expect(r.why).toBe('');
    expect(r.data!.days).toMatchObject([
      { date: '2026-09-01', z: '0101', gross: { А: 5900, Г: 1100 }, total: 7000, cash: 7000, receipts: 21 },
      { date: '2026-09-02', z: '0102', gross: { А: 11800 }, total: 11800, cash: 6800, card: 5000, receipts: 30 },
    ]);
    expect(r.data).toMatchObject({ from: '2026-09-01', to: '2026-09-02', zFrom: '0101', zTo: '0102', totals: { total: 18800, card: 5000 } });
  });

  it('a printed rate overrides the default group mapping', () => {
    const L = swap(FISK_PERIODIC, 'ДДВ Г 10.00%          500.00', 'ДДВ Г 5.00%           261.90');
    const r = fiscalReportFromLines(swap(L, 'ДДВ ИЗНОС          19 000.00', 'ДДВ ИЗНОС          18 761.90'));
    expect(r.why).toBe('');
    expect(r.data!.groups!['Г']).toBe(5);
  });

  it('groups that do not add up / wrong VAT / payments ≠ total → not accepted with the reason', () => {
    expect(fiscalReportFromLines(swap(FISK_PERIODIC, 'ПРОМЕТ В            1 000.00', 'ПРОМЕТ В            1 100.00')).why).toMatch(/Σ групи/);
    expect(fiscalReportFromLines(swap(FISK_PERIODIC, 'ДДВ А 18.00%       18 000.00', 'ДДВ А 18.00%       17 000.00')).why).toMatch(/ДДВ А/);
    expect(fiscalReportFromLines(swap(FISK_PERIODIC, 'КАРТИЧКА           35 000.00', 'КАРТИЧКА           30 000.00')).why).toMatch(/плаќања/);
    expect(fiscalReportFromLines(['Некој текст', 'Вкупно 100,00']).ok).toBe(false);
  });
});

describe('fiscal receipt (e-receipt / text PDF) without AI', () => {
  it('shop receipt: items, groups, VAT, cash with change → BLG shape → voucher draft', () => {
    const r = receiptFromLines(RECEIPT_SHOP);
    expect(r.why).toBe('');
    const q = r.data!.receipts[0]!;
    expect(q).toMatchObject({ country: 'MK', currency: 'MKD', date: '2026-10-12', time: '14:35:20', docNo: '0012345', merchant: 'ТЕСТ МАРКЕТ ДООЕЛ',
      vatId: 'MK4030999111222', edb: '4030999111222', total: 290, vatRate: 18, vatAmount: 40.04, payment: 'cash', category: 'other' });
    expect(q.items).toEqual([
      { name: 'ЛЕБ БЕЛ 500Г', qty: 1, price: 40, amount: 40, group: 'Б', rate: 5 },
      { name: 'КАФЕ МЛЕАНО', qty: 2, price: 125, amount: 250, group: 'А', rate: 18 },
    ]);
    expect(r.data).toMatchObject({ noai: true, note: NOAI_NOTE });
    const [d] = receiptDrafts(r.data, { today: '2026-10-12', kontoFor: () => '449', fxFor: () => 1 });
    expect(d).toMatchObject({ date: '2026-10-12', amt: 290, rate: 18, vat: 40.04, docNo: '0012345', cur: 'MKD' });
  });

  it('fuel receipt: category fuel, liters, card, 10 %', () => {
    const q = receiptFromLines(RECEIPT_FUEL).data!.receipts[0]!;
    expect(q).toMatchObject({ category: 'fuel', liters: 45.5, payment: 'card', vatRate: 10, vatAmount: 330.91, total: 3640, docNo: '77/2026', date: '2026-10-05' });
  });

  it('items ≠ total / wrong VAT / underpaid → reason, no data', () => {
    expect(receiptFromLines(swap(RECEIPT_SHOP, 'ВКУПНО   290.00', 'ВКУПНО   300.00')).why).toMatch(/Σ ставки/);
    expect(receiptFromLines(swap(RECEIPT_SHOP, 'ДДВ А 18%   38.14', 'ДДВ А 18%   45.00')).why).toMatch(/ДДВ А/);
    expect(receiptFromLines(swap(RECEIPT_SHOP, 'КУСУР   10.00', 'КУСУР   20.00')).why).toMatch(/платено/);
    expect(receiptFromLines(RECEIPT_SHOP.filter((s) => !/^ЕДБ|^ДДВ БРОЈ/.test(s))).why).toBe('нема ЕДБ на продавачот');
  });
});
