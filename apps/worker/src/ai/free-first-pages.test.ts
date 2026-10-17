/**
 * Free first never accepts a read that obviously does not cover a multi-page PDF (incident: a 46-page scan of Q3
 * incoming invoices with a scanner's OCR text layer was read free as ONE invoice with three 18 % groups, and 45
 * invoices were lost). Synthetic data only: the import-audit fixture invoice (1 page) plus blank pages.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { acceptFree, freeFirst, PAGES_PER_INVOICE, plausiblePages, sameRateGroups, WHY } from './free-first';

const FIX = join(__dirname, '../../../web/test/import/fixtures');
const INV = new Uint8Array(readFileSync(join(FIX, 'inv-recap.pdf')));
const PDF = { name: 'VLEZNI FAKTURI.pdf', mime: 'application/pdf' };
const OWN = { ownEdb: '4030999000111' };

/** The 1-page fixture invoice followed by `extra` blank (scanned-image-like, no text) pages. */
async function withPages(extra: number): Promise<Uint8Array> {
  const d = await PDFDocument.load(INV);
  for (let i = 0; i < extra; i++) d.addPage([595, 842]);
  return d.save();
}

describe('free first: page count plausible for the invoices found', () => {
  it('a single 1-page text invoice is still read free', async () => {
    const r = await freeFirst('purchase', PDF, INV, OWN);
    expect(r.why).toBe('');
    expect(r.result).toMatchObject({ total: 2010 });
  });

  it('a 2-page single invoice (e.g. a bill + its specification) is still read free', async () => {
    const r = await freeFirst('purchase', PDF, await withPages(1), OWN);
    expect(r.why).toBe('');
    expect(r.result).not.toBeNull();
  });

  it('a 46-page PDF whose text layer gave ONE invoice is rejected → AI (split per invoice) with the reason', async () => {
    const r = await freeFirst('purchase', PDF, await withPages(45), OWN);
    expect(r).toEqual({ result: null, why: WHY.pages });
    // the same for sales
    expect((await freeFirst('sale', PDF, await withPages(45), OWN)).why).toBe(WHY.pages);
  }, 30_000);

  it('thresholds: ≤ 3 pages per invoice without lines, ≤ 6 with lines', () => {
    const g = { groups: [{ rate: 18, base: 100, vat: 18 }], total: 118 };
    const noLines = { invoices: Array.from({ length: 10 }, () => ({ ...g, lines: [] })) };
    expect(PAGES_PER_INVOICE).toEqual({ noLines: 3, lines: 6 });
    expect(plausiblePages(noLines, 30)).toBe(true);
    expect(plausiblePages(noLines, 31)).toBe(false);
    const lines = { ...g, lines: [{ name: 'x', qty: 1, price: 100, amount: 100 }] };
    expect(plausiblePages(lines, 6)).toBe(true);
    expect(plausiblePages(lines, 7)).toBe(false);
    expect(plausiblePages({ ...g, lines: [] }, 3)).toBe(true);
    expect(plausiblePages({ ...g, lines: [] }, 46)).toBe(false);
    // page count unknown / one page: nothing to check
    expect(plausiblePages({ ...g, lines: [] }, null)).toBe(true);
    expect(plausiblePages({ ...g, lines: [] }, 1)).toBe(true);
  });

  it('the incident read: one invoice with three separate 18 % groups (each consistent) is never accepted', () => {
    const r = {
      number: 'br.912026', date: '2026-08-31', supplierName: '', supplierEdb: '4030999000123', lines: [],
      groups: [{ rate: 18, base: 13411.53, vat: 2414.07, kind: 'other' }, { rate: 18, base: 2480.38, vat: 446.47, kind: 'other' }, { rate: 18, base: 2506.62, vat: 451, kind: 'other' }],
      total: 21710.07,
    };
    expect(acceptFree('purchase', r)).toEqual({ ok: false, why: WHY.pages });
    expect(sameRateGroups(r)).toBe(true);
    // different rates: fine; the same rate told apart as goods / services: fine
    expect(sameRateGroups({ groups: [{ rate: 18, base: 100 }, { rate: 5, base: 50 }] })).toBe(false);
    expect(sameRateGroups({ groups: [{ rate: 18, base: 100, kind: 'goods' }, { rate: 18, base: 50, kind: 'services' }] })).toBe(false);
    expect(sameRateGroups({ groups: [{ rate: 18, base: 100, kind: 'other' }, { rate: 18, base: 50, kind: 'other' }] })).toBe(true);
    // an empty group of the same rate does not count
    expect(sameRateGroups({ groups: [{ rate: 18, base: 100 }, { rate: 18, base: 0 }] })).toBe(false);
  });
});
