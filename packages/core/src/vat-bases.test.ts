import { describe, expect, it } from 'vitest';
import type { PostingContext } from './posting';
import { invoiceVatBases, purchaseVatBases, salesVatBases, vbControl, vbLines, vbNote } from './vat-bases';

const ctx: PostingContext = { firm: { ddv: true } };

describe('off-balance VAT-base lines (legacy docBases / vbLines)', () => {
  it('invoice: base by rate on 994 / 999; credit note negative; чл. 32-а none', () => {
    const items = [{ qty: 1, price: 1000, rate: 18 }, { qty: 2, price: 50, rate: 5 }];
    const B = invoiceVatBases({ items }, ctx);
    expect(B).toEqual(expect.arrayContaining([{ t: 'out', r: 18, b: 1000 }, { t: 'out', r: 5, b: 100 }]));
    const L = vbLines(B, ctx);
    expect(L).toContainEqual({ account: '994018', debit: 1000, credit: 0, note: 'Основица ДДВ излез 18%' });
    expect(L).toContainEqual({ account: '999018', debit: 0, credit: 1000, note: 'Основица ДДВ излез 18%' });
    expect(invoiceVatBases({ items, art32: true }, ctx)).toEqual([]);
    const C = vbLines(invoiceVatBases({ items: [items[0]!], credit: true }, ctx), ctx);
    expect(C).toEqual([{ account: '994018', debit: 0, credit: 1000, note: vbNote('out', 18) }, { account: '999018', debit: 1000, credit: 0, note: vbNote('out', 18) }]);
    const S = vbLines(invoiceVatBases({ items: [items[0]!], credit: true }, ctx), ctx, true);
    expect(S[0]).toMatchObject({ account: '994018', debit: -1000, credit: 0 });
  });
  it('purchase: groups as input bases, customs VAT as import; switched off with „-“', () => {
    const B = purchaseVatBases({ groups: [{ konto: '6600', rate: 18, base: 1000, vat: 180 }], costs: { car: { amt: 0, lines: [{ rate: 18, base: 500, vat: 90 }] } } });
    expect(B).toEqual(expect.arrayContaining([{ t: 'in', r: 18, b: 1000 }, { t: 'imp', r: 18, b: 500 }]));
    expect(purchaseVatBases({ groups: [{ konto: '6600', rate: 18, base: 1000, vat: 180 }], imp: true })).toEqual([]);
    expect(vbLines(B, { firm: { sch: { vbin18d: '-' } } }).map((l) => l.account)).toEqual(['99408', '9990018']);
  });
  it('control card: ДДВ-04 against the booked bases', () => {
    const L = [...vbLines(salesVatBases([{ rate: 18, base: 1000 }]), ctx), ...vbLines([{ t: 'in', r: 18, b: 400 }], ctx)];
    const X = vbControl(L, ctx, { '01': 1000, '21': 400 }, { 18: 400 })!;
    expect(X.ok).toBe(true);
    expect(X.rows.find((r) => r.k === '01')).toMatchObject({ f: 1000, v: 1000 });
    expect(vbControl(L, ctx, { '01': 1500, '21': 400 }, { 18: 400 })!.ok).toBe(false);
    expect(vbControl([], ctx, {}, {})).toBeNull();
  });
});
