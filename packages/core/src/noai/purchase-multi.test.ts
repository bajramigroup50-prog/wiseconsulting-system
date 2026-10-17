/**
 * One PDF with several incoming invoices (synthetic, `purchase-multi.fixtures.ts`): every invoice is registered
 * separately — its own supplier, number, date, VAT groups and total — the rule of the bank import
 * (`bank-multi.test.ts`). Never one document, never a number range, never a sum.
 */
import { describe, expect, it } from 'vitest';
import { scanConsistent, scanInvoices, type ScanResult } from '../sales/scan';
import { pdfLines } from './pdf-lines';
import { MULTI_INVOICES, MULTI_OWN_EDB, multiInvoiceItems, twoOnOnePageItems } from './purchase-multi.fixtures';
import { invoiceFromPdf, invoicesFromPdf, splitPdfInvoices } from './purchase';

const L = () => pdfLines(multiInvoiceItems());

describe('PDF with three invoices (synthetic)', () => {
  it('BEFORE: the single-invoice reader merges them into ONE document (first number, all VAT groups together)', () => {
    // what the free reader did with the whole file until now (kept as `invoiceFromPdf` for a one-invoice file)
    const one = invoiceFromPdf(L(), { ownEdb: MULTI_OWN_EDB })!;
    expect(one.number).toBe('101/2026');
    expect(one.supplierEdb).toBe('4030999000111');
    expect(one.groups!.map((g) => [g.rate, g.base])).toEqual([[18, 1000], [18, 2500], [5, 400], [10, 300]]);
  });

  it('splits by the invoice headers / seller ЕДБ / totals into 3 parts on their pages', () => {
    const P = splitPdfInvoices(L(), { ownEdb: MULTI_OWN_EDB });
    expect(P).toHaveLength(3);
    expect(P.map((p) => [...new Set(p.map((l) => l.page))])).toEqual([[1], [2, 3], [4]]);
    // the letterhead (supplier name above the title) belongs to its own invoice
    expect(P[1]![0]!.cells[0]!.s).toBe('ТЕСТ ДИСТРИБУЦИЈА ДОО Битола');
  });

  it('3 invoices, each with its own number, date, supplier, VAT and total — each consistent', () => {
    const I = invoicesFromPdf(L(), { ownEdb: MULTI_OWN_EDB });
    expect(I).toHaveLength(3);
    for (const [k, x] of I.entries()) {
      const want = MULTI_INVOICES[k]!;
      expect(x).toMatchObject({ number: want.number, date: want.date, supplierEdb: want.supplierEdb, total: want.total, pages: want.pages });
      expect(x.dueDate ?? '').toBe(want.dueDate);
      expect(x.groups!.map((g) => ({ rate: g.rate, base: g.base, vat: g.vat }))).toEqual(want.groups);
      expect(scanConsistent(x)).toBe(true);
    }
    // never a range, never the sum of the file
    expect(I.map((x) => x.number)).not.toContain('101-77');
    expect(I.map((x) => x.total)).not.toContain(4880);
  });

  it('without the own ЕДБ (the buyer is not known) the split is the same', () => {
    expect(invoicesFromPdf(L()).map((x) => x.number)).toEqual(['101/2026', 'F-2026-0042', '77/26']);
  });

  it('a mismatch is reported on ITS invoice, the others stay correct', () => {
    // invoice 2: VAT 18 % printed as 405,00 instead of 450,00 (the total stays 3.370,00)
    const bad = multiInvoiceItems().map((x) => (x.page === 3 && x.s === '450,00' ? { ...x, s: '405,00' } : x));
    const I = invoicesFromPdf(pdfLines(bad), { ownEdb: MULTI_OWN_EDB });
    expect(I.map((x) => x.number)).toEqual(['101/2026', 'F-2026-0042', '77/26']);
    expect(I.map((x) => scanConsistent(x))).toEqual([true, false, true]);
    // the printed total is kept (not replaced by the sum, which would hide the difference)
    expect(I[1]!.total).toBe(3370);
  });

  it('two invoices on one page (no page break, the second title without a number on its line)', () => {
    const P = splitPdfInvoices(pdfLines(twoOnOnePageItems()), { ownEdb: MULTI_OWN_EDB });
    expect(P).toHaveLength(2);
    expect(P[1]![0]!.cells[0]!.s).toBe('БЕТА ПРОБА ДОО Штип');
    const I = invoicesFromPdf(pdfLines(twoOnOnePageItems()), { ownEdb: MULTI_OWN_EDB });
    expect(I.map((x) => [x.number, x.date, x.supplierEdb, x.total])).toEqual([
      ['5/2026', '2026-10-01', '4030999000444', 118], ['0009/2026', '2026-10-02', '4030999000555', 210],
    ]);
  });

  it('a one-invoice file is read exactly as before (no pages, one invoice)', () => {
    const one = pdfLines(multiInvoiceItems().filter((x) => x.page === 2 || x.page === 3));
    const I = invoicesFromPdf(one, { ownEdb: MULTI_OWN_EDB });
    expect(I).toHaveLength(1);
    expect(I[0]).toEqual(invoiceFromPdf(one, { ownEdb: MULTI_OWN_EDB }));
    expect(I[0]!.pages).toBeUndefined();
  });

  it('the read as stored ({invoices:[…]}) gives 3 invoices', () => {
    const r: ScanResult = { invoices: invoicesFromPdf(L(), { ownEdb: MULTI_OWN_EDB }) };
    expect(scanInvoices(JSON.parse(JSON.stringify(r)))).toHaveLength(3);
  });
});
