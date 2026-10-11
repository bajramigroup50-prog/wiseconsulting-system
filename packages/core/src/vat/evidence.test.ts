import { describe, expect, it } from 'vitest';
import type { VatDocuments } from '../vat';
import { DDV_EVIDENCE_HEAD, ddvEvidenceRows, invoiceBookOutSum, invoiceBookRows } from './evidence';

const docs: VatDocuments = {
  invoices: [
    { id: 'i2', date: '2026-02-10', number: '2', partner: 'p1', items: [{ qty: 2, price: 100, rate: 18 }, { qty: 1, price: 50, rate: 5 }, { qty: 1, price: 30, rate: 0 }] },
    { id: 'i1', date: '2026-01-05', number: '1', partner: 'p2', art32: true, items: [{ qty: 1, price: 1000, rate: 18 }] },
    { id: 'c1', date: '2026-03-01', number: 'O1', partner: 'p1', credit: true, items: [{ qty: 1, price: 100, rate: 18 }] },
    { id: 'x', date: '2026-04-01', number: '9', items: [{ qty: 1, price: 1, rate: 18 }] },
    { id: 'pend', date: '2026-01-20', number: '8', pend: true, items: [{ qty: 1, price: 1, rate: 18 }] },
  ],
  purchases: [
    { id: 'u1', date: '2026-02-01', number: 'F-7', partner: 'p2', groups: [{ rate: 18, base: 500, vat: 90 }, { rate: 10, base: 100, vat: 10 }] },
    { id: 'u2', date: '2026-01-15', number: 'G-1', supplierName: 'Градител', art32: true, groups: [{ rate: 0, base: 200, vat: 0 }] },
  ],
};
const partners = { p1: { name: 'Купувач ДООЕЛ', edb: '4030000000001' }, p2: { name: 'Градба АД', edb: '4030000000002' } };

describe('ddvEvidenceRows (legacy ddvCsv)', () => {
  const R = ddvEvidenceRows(docs, '2026-01-01', '2026-03-31', { partners });
  it('header and one row per rate group', () => {
    expect(R[0]).toEqual(DDV_EVIDENCE_HEAD);
    expect(R.slice(1)).toEqual([
      ['Излезна', '2026-02-10', '2', 'Купувач ДООЕЛ', '4030000000001', 18, 200, 36, ''],
      ['Излезна', '2026-02-10', '2', 'Купувач ДООЕЛ', '4030000000001', 5, 50, 2.5, ''],
      ['Излезна', '2026-02-10', '2', 'Купувач ДООЕЛ', '4030000000001', 0, 30, 0, ''],
      ['Излезна', '2026-01-05', '1', 'Градба АД', '4030000000002', 18, 1000, 0, 'Да'],
      ['Одобрение', '2026-03-01', 'O1', 'Купувач ДООЕЛ', '4030000000001', 18, -100, -18, ''],
      ['Влезна', '2026-02-01', 'F-7', 'Градба АД', '4030000000002', 18, 500, 90, ''],
      ['Влезна', '2026-02-01', 'F-7', 'Градба АД', '4030000000002', 10, 100, 10, ''],
      // art. 32-a purchase: VAT = base × (rate || 18) / 100
      ['Влезна', '2026-01-15', 'G-1', 'Градител', '', 0, 200, 36, 'Да'],
    ]);
  });
});

describe('invoiceBookRows (legacy ddvBookPdf)', () => {
  const B = invoiceBookRows(docs, '2026-01-01', '2026-03-31', { partners });
  it('output book sorted by date, art. 32-a in the last column, credit notes negative', () => {
    expect(B.out.map((r) => r.no)).toEqual(['1', '2', 'O1']);
    expect(B.out[0]).toMatchObject({ b18: 0, v18: 0, oth: 1000 });
    expect(B.out[1]).toMatchObject({ b18: 200, v18: 36, b10: 0, b5: 50, v5: 2.5, oth: 30 });
    expect(B.out[2]).toMatchObject({ b18: -100, v18: -18, oth: 0 });
    expect(invoiceBookOutSum(B.out)).toEqual({ b18: 100, v18: 18, b10: 0, v10: 0, b5: 50, v5: 2.5, oth: 1030 });
  });
  it('input book: totals per document, art. 32-a VAT calculated', () => {
    expect(B.inn).toEqual([
      { date: '2026-01-15', no: 'G-1', name: 'Градител', edb: '', base: 200, vat: 36, art32: true },
      { date: '2026-02-01', no: 'F-7', name: 'Градба АД', edb: '4030000000002', base: 600, vat: 100, art32: false },
    ]);
  });
});
