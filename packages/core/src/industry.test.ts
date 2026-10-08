import { describe, expect, it } from 'vitest';
import {
  arrangementVatTotals, bookingInvoice, frTourWindow, hotelConfig, hotelInvoiceLines, nextModuleNumber, nkdProfiles, normalizeMods,
  orderAdd, orderQty, orderSend, parseBoqPaste, rcCalc, rentConfig, rentalInvoiceLines, situationCalc, situationInvoiceLines,
  consConfig, suggestedModules, travelConfig, travelOrderNo, viewEnabled,
} from './industry';
import { travelMarginOf, type VatContext } from './vat';
import { calcLines } from './vat';

const dmy = (d: string) => d.split('-').reverse().join('.');

describe('module toggles (FIX 10.4 item 9)', () => {
  it('gates module views for office users too, not only clients', () => {
    expect(viewEnabled('hotel', [], { hasFirm: true })).toBe(false);
    expect(viewEnabled('hotel', ['hotel'], { hasFirm: true })).toBe(true);
    expect(viewEnabled('gradbaIzv', ['hotel'], { hasFirm: true })).toBe(false);
    expect(viewEnabled('mojpn', ['pn'], { hasFirm: true })).toBe(true);
    expect(viewEnabled('nalozi', [], { hasFirm: true })).toBe(true);
    expect(viewEnabled('hotel', [], { hasFirm: false })).toBe(true);
  });
  it('production planning stays visible to the office, not to clients', () => {
    expect(viewEnabled('mrp', [], { hasFirm: true })).toBe(true);
    expect(viewEnabled('mrp', [], { hasFirm: true, client: true })).toBe(false);
  });
  it('suggests modules from the NKD activity', () => {
    expect(nkdProfiles('55.10 Хотели')).toEqual(['hotel']);
    expect(nkdProfiles('79.12')).toEqual(['travel']);
    expect(nkdProfiles('77.11 Изнајмување')).toEqual(['rent']);
    expect(suggestedModules(nkdProfiles('49.41'))).toEqual(['pn', 'frt']);
    expect(normalizeMods(['tour', 'x', 'hotel', 'hotel'])).toEqual(['hotel', 'tour']);
  });
});

describe('numbering (FIX 10.4 item 12)', () => {
  it('numbers from the highest used number, not the count', () => {
    expect(nextModuleNumber('О-', ['О-001/2026', 'О-005/2026'], 2026)).toBe('О-006/2026');
    expect(nextModuleNumber('Р-', [], 2026)).toBe('Р-001/2026');
    expect(travelOrderNo(['001/2026', '014/2026'], 2026)).toBe('015/2026');
  });
});

describe('hotel invoice lines', () => {
  it('nights net of the accommodation rate, charges by rate, tourist tax at 0% on the tax konto', () => {
    const C = hotelConfig({ tax: 40 });
    const L = hotelInvoiceLines({ from: '2026-07-01', to: '2026-07-03', price: 3150, adults: 2, children: 0, board: 'BB', charges: [{ date: '2026-07-01', name: 'Вино', qty: 1, price: 1180, rate: 18 }] }, C, '12', dmy);
    expect(L.map((l) => [l.qty, l.price, l.rate, l.account])).toEqual([[2, 3000, 5, null], [1, 1000, 18, null], [1, 160, 0, '2399']]);
    expect(L[0]!.name).toContain('соба 12');
  });
});

describe('rent-a-car invoice (FIX 10.4 item 6: no rounding drift)', () => {
  it('the rent line reproduces the gross rent exactly', () => {
    const C = rentConfig({ grace: 2 });
    const r = { from: '2026-02-01T09:00', to: '2026-02-04T09:00', priceTot: 1001, out: { km: 1, fuel: 8 }, ret: { km: '', fuel: '' }, extras: [], plate: 'SK-1234-AB' };
    const k = rcCalc(r, { rDay: 1999 }, C);
    expect([k.days, k.rent]).toEqual([3, 1001]);
    const L = rentalInvoiceLines(r, k, C);
    expect(L).toHaveLength(1);
    // 1001 at 18% has no cent-exact base (848.30 → 1000.99, 848.31 → 1001.01): the closest one is used.
    expect(Math.abs(calcLines(L.map((l) => ({ qty: l.qty, price: l.price, rate: l.rate }))).total - 1001)).toBeLessThanOrEqual(0.01);
    for (const rent of [5997, 2950, 1180, 7080]) {
      const k2 = rcCalc({ ...r, priceTot: rent }, { rDay: 1 }, C);
      expect(calcLines(rentalInvoiceLines(r, k2, C).map((l) => ({ qty: l.qty, price: l.price, rate: l.rate }))).total).toBe(rent);
    }
  });
});

describe('travel agency', () => {
  const A = { id: 'A', kind: 'own' as const, price: 30000, costs: [{ cat: 'Сместување (хотел)', amt: 40000 }, { cat: 'Сопствена услуга на агенцијата (не е претходна)', amt: 5000 }], code: 'A-001/2026', name: 'Охрид', from: '2026-08-01', to: '2026-08-05' };
  const B = [{ adults: 2, children: 0 }, { adults: 1, priceTot: 28000 }];
  it('own arrangement → margin-scheme invoice with the gross price at 0% and the VAT inputs for Phase 5', () => {
    const I = bookingInvoice(B[0]!, A, travelConfig({}), dmy);
    expect(I.tourM).toBe(true);
    expect(I.lines).toEqual([expect.objectContaining({ qty: 1, price: 60000, rate: 0 })]);
    const T = arrangementVatTotals(A, B, () => undefined, travelConfig({}))!;
    expect(T).toEqual({ rev: 88000, cost: 40000, own: 5000 });
    const ctx = { firm: { ddv: true } } as unknown as VatContext;
    const M = travelMarginOf([{ id: 'i1', date: '2026-08-05', tourM: true, arrangementId: 'A', items: [{ qty: 1, price: 60000, rate: 0 }] }], ctx, { arrangements: { A: T } });
    // margin on the invoice share: 60000 − 40000×60/88 − 5000×60/88
    expect(M.m).toBeCloseTo(60000 - (40000 * 60000) / 88000 - (5000 * 60000) / 88000, 1);
  });
  it('intermediary → commission with 18% VAT and the rest on the pass-through konto', () => {
    const I = bookingInvoice({ adults: 2 }, { ...A, kind: 'agent', comm: 10 }, travelConfig({}), dmy);
    expect(I.tourM).toBe(false);
    expect(I.lines.map((l) => [l.price, l.rate, l.account])).toEqual([[5084.7458, 18, null], [54000, 0, '2290']]);
    expect(arrangementVatTotals({ ...A, kind: 'agent' }, B, () => undefined, travelConfig({}))).toBeNull();
  });
});

describe('construction', () => {
  it('situation invoice lines carry this situation’s quantities at the configured rate', () => {
    const boq = [{ pos: '1', desc: 'Ископ', unit: 'м3', qty: 100, price: 450 }, { pos: '2', desc: 'Бетон', unit: 'м3', qty: 10, price: 6000 }];
    const all = [{ id: 'a', no: '1', date: '2026-01-31', cum: { 0: 40 } }];
    const c = situationCalc(boq, all, { no: '2', date: '2026-02-28', cum: { 0: 100, 1: 2 } });
    expect(c.cur).toBe(60 * 450 + 2 * 6000);
    expect(situationInvoiceLines(c, consConfig({ rate: 18 })).map((l) => [l.qty, l.price, l.rate])).toEqual([[60, 450, 18], [2, 6000, 18]]);
  });
  it('parses a pasted BOQ', () => {
    expect(parseBoqPaste('1\tИскоп\tм3\t1.200,50\t450\n\nx')).toEqual([{ pos: '1', desc: 'Ископ', unit: 'м3', qty: 1200.5, price: 450 }]);
  });
});

describe('restaurant bill', () => {
  it('merges unsent lines, removes at zero, marks sent', () => {
    let L = orderAdd([], { id: 'i', name: 'Пица', price: 450, rate: 10 });
    L = orderAdd(L, { id: 'i', name: 'Пица', price: 450, rate: 10 });
    expect(L).toHaveLength(1);
    expect(L[0]!.qty).toBe(2);
    L = orderSend(L, '2026-01-01T12:00');
    L = orderAdd(L, { id: 'i', name: 'Пица', price: 450, rate: 10 });
    expect(L).toHaveLength(2);
    expect(orderQty(L, 1, -1)).toHaveLength(1);
  });
});

describe('freight fuel window (FIX 10.4 item 14)', () => {
  it('ends at the last border exit (return leg) instead of an unset retDate', () => {
    expect(frTourWindow({ date: '2026-03-01', unloadDate: '2026-03-03', segs: [{ c: 'DE', in: '2026-03-02T10:00', out: '2026-03-06T08:00' }] })).toEqual(['2026-03-01', '2026-03-06']);
    expect(frTourWindow({ date: '2026-03-01', unloadDate: '2026-03-03' })).toEqual(['2026-03-01', '2026-03-03']);
  });
});
