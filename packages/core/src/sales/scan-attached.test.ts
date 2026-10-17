/** Attached pages (specification, annex, page 2 of the same invoice) join the invoice before them. Synthetic data. */
import { describe, expect, it } from 'vitest';
import { mergeAttachedInvoices, scanInvoices, scanPageList, scanPagesText, type ScanInvoice } from './scan';

const g = (rate: number, base: number) => ({ rate, base, vat: Math.round(base * rate) / 100 });
const A: ScanInvoice = { supplierEdb: '4030999000701', supplierName: 'АЛФА ДОО', number: '11/2026', groups: [g(18, 1000)], total: 1180, pages: '1' };
const EVN: ScanInvoice = { supplierEdb: '4030999000777', supplierName: 'ЕВН ПРИМЕР', number: '7700123456', groups: [g(18, 2000)], total: 2360, pages: '2' };
const SPEC: ScanInvoice = { supplierEdb: '4030999000777', supplierName: 'ЕВН ПРИМЕР', number: '', groups: [], total: 0, pages: '3', lines: [{ name: 'Активна енергија', qty: 812 }] };
const B: ScanInvoice = { supplierEdb: '4030999000702', supplierName: 'БЕТА ДООЕЛ', number: 'F-55/2026', groups: [g(5, 400)], total: 420, pages: '4' };

describe('mergeAttachedInvoices', () => {
  it('pages helpers', () => {
    expect(scanPageList('1-2, 5')).toEqual([1, 2, 5]);
    expect(scanPageList('4,3')).toEqual([3, 4]);
    expect(scanPagesText([4, 3, 5, 9])).toBe('3-5,9');
  });

  it('a specification page with no total / VAT right after the EVN bill → its pages, no invoice of its own', () => {
    const I = scanInvoices(mergeAttachedInvoices({ invoices: [A, EVN, SPEC, B] }));
    expect(I.map((x) => [x.number, x.pages])).toEqual([['11/2026', '1'], ['7700123456', '2-3'], ['F-55/2026', '4']]);
    // the specification's consumption lines never join the bill (its VAT recapitulation stays as read)
    expect(I[1]!.lines ?? []).toEqual([]);
    expect(I[1]!.total).toBe(2360);
  });

  it('the same number on the next page (normalized, same supplier) → merged, missing fields taken from it', () => {
    const I = scanInvoices(mergeAttachedInvoices({ invoices: [{ ...B, date: '' }, { ...B, number: 'F 55 / 2026', date: '2026-08-10', pages: '5' }] }));
    expect(I).toHaveLength(1);
    expect(I[0]).toMatchObject({ number: 'F-55/2026', date: '2026-08-10', pages: '4-5', total: 420 });
  });

  it('a page 2 that carries the totals completes a page 1 without them', () => {
    const I = scanInvoices(mergeAttachedInvoices({ invoices: [{ ...B, groups: [], total: 0, lines: [{ name: 'x', amount: 400 }] }, { ...B, pages: '5', lines: [] }] }));
    expect(I).toHaveLength(1);
    expect(I[0]).toMatchObject({ total: 420, pages: '4-5' });
    expect(I[0]!.lines).toHaveLength(1);
  });

  it('kept apart: a copy further on, another supplier, another number without amounts', () => {
    // the same invoice printed again on a later page: a duplicate for the drafts, not merged
    expect(scanInvoices(mergeAttachedInvoices({ invoices: [A, B, { ...A, pages: '5' }] }))).toHaveLength(3);
    // the same number of ANOTHER supplier on the next page: another invoice
    expect(scanInvoices(mergeAttachedInvoices({ invoices: [A, { ...B, number: A.number, pages: '2' }] }))).toHaveLength(2);
    // a header whose amounts were not read (another number): kept, its draft says „нема износ“
    expect(scanInvoices(mergeAttachedInvoices({ invoices: [A, { ...B, groups: [], total: 0, pages: '2' }] }))).toHaveLength(2);
    // a page with no amounts of another supplier (ЕДБ differs): kept
    expect(scanInvoices(mergeAttachedInvoices({ invoices: [A, { ...SPEC, pages: '2' }] }))).toHaveLength(2);
  });

  it('no pages in the read: an amount-less page without a number still joins the invoice before it', () => {
    const I = scanInvoices(mergeAttachedInvoices({ invoices: [{ ...EVN, pages: undefined }, { ...SPEC, pages: undefined }] }));
    expect(I).toHaveLength(1);
    expect(I[0]!.number).toBe('7700123456');
  });

  it('a single invoice / nothing to merge: returned as it is', () => {
    const r = { invoices: [A, B] };
    expect(mergeAttachedInvoices(r)).toBe(r);
    expect(mergeAttachedInvoices(A)).toBe(A);
  });
});
