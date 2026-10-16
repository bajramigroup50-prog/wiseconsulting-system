/**
 * OUTGOING invoices: several in one file are separate documents (synthetic data). A UBL container with several
 * `Invoice` elements and a text PDF with several issued invoices (the buyer changes) each give one invoice per
 * document — own number, date, buyer, groups and total — never merged or summed.
 */
import { describe, expect, it } from 'vitest';
import { scanConsistent, scanInvoices } from './scan';
import { ublToScan, ublToScanAll, ublXml } from './ubl';
import { pdfLines, type PdfItem } from '../noai/pdf-lines';
import { invoicesFromPdf } from '../noai/purchase';

const seller = { name: 'НАША ФИРМА ДОО', edb: '4030000000001', address: 'ул. 1', vatRegistered: true };
const buyers = [{ name: 'КУПУВАЧ ЕДЕН ДООЕЛ', edb: '4030999000101' }, { name: 'КУПУВАЧ ДВА ДОО', edb: '4030999000202' }];
const invs = [
  { number: '0101/2026', date: '2026-10-01', due: '2026-10-31', items: [{ name: 'Стока', qty: 10, price: 100, rate: 18, unit: 'ком' }] },
  { number: '0102/2026', date: '2026-10-02', due: '2026-11-01', items: [{ name: 'Услуга', qty: 2, price: 250, rate: 5, unit: 'час' }] },
];
const strip = (x: string) => x.replace(/^<\?xml[^>]*\?>\s*/, '');

describe('UBL file with several invoices', () => {
  it('a container of 2 Invoice elements → 2 invoices with their own number, date, buyer and total', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Invoices>' + invs.map((v, k) => strip(ublXml(v, seller, buyers[k]!))).join('') + '</Invoices>';
    expect(ublToScan(xml)).toBeNull(); // the single reader does not take the container
    const r = ublToScanAll(xml)!;
    const I = scanInvoices(r);
    expect(I.map((x) => [x.number, x.date, x.buyerEdb, x.total])).toEqual([
      ['0101/2026', '2026-10-01', '4030999000101', 1180], ['0102/2026', '2026-10-02', '4030999000202', 525],
    ]);
    for (const x of I) expect(scanConsistent(x)).toBe(true);
  });
  it('one Invoice stays one invoice (as before)', () => {
    const xml = ublXml(invs[0]!, seller, buyers[0]!);
    expect(ublToScanAll(xml)).toEqual(ublToScan(xml));
  });
});

describe('text PDF with several issued invoices (kind sale)', () => {
  const page = (p: number, rows: [number, string][][]): PdfItem[] => rows.flatMap((r, i) => r.map(([x, s]) => ({ page: p, x, y: 800 - i * 14, w: s.length * 5, h: 9, s })));
  const one = (p: number, no: string, date: string, buyer: { name: string; edb: string }, rate: number, base: string, vat: string, tot: string) => page(p, [
    [[50, 'НАША ФИРМА ДОО Скопје · ЕДБ 4030000000001']],
    [[50, `Купувач: ${buyer.name}`]], [[50, `ЕДБ купувач: ${buyer.edb}`]],
    [[50, `ФАКТУРА бр. ${no}`]], [[50, `Датум на фактура: ${date}`]],
    [[50, `ДДВ ${rate}%`], [200, base], [300, vat]],
    [[50, 'Вкупно за плаќање:'], [300, tot]],
  ]);
  it('each page its own invoice with its own buyer', () => {
    const items = [...one(1, '0101/2026', '01.10.2026', buyers[0]!, 18, '1.000,00', '180,00', '1.180,00'), ...one(2, '0102/2026', '02.10.2026', buyers[1]!, 5, '500,00', '25,00', '525,00')];
    const I = invoicesFromPdf(pdfLines(items), { ownEdb: '4030000000001', kind: 'sale' });
    expect(I.map((x) => [x.number, x.date, x.buyerEdb, x.total, x.pages])).toEqual([
      ['0101/2026', '2026-10-01', '4030999000101', 1180, '1'], ['0102/2026', '2026-10-02', '4030999000202', 525, '2'],
    ]);
  });
});
