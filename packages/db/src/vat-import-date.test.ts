import { describe, expect, it } from 'vitest';
import { isVatSettlement, vatDateOf } from './vat-source';

describe('VAT date of a nalog imported from the old program', () => {
  it('counts in the nalog period (as the old program reported)', () => {
    expect(vatDateOf('2026-04-03', '1/1-3', 'import')).toBe('2026-03-31');
    expect(vatDateOf('2026-05-11', '1/1-3', 'import')).toBe('2026-03-31');
    expect(vatDateOf('2026-03-31', '1/4-6', 'import')).toBe('2026-04-01');
    expect(vatDateOf('2026-02-10', '1/1-3', 'import')).toBe('2026-02-10');
    expect(vatDateOf('2026-02-28', '12/2-2', 'import')).toBe('2026-02-28');
    expect(vatDateOf('2026-04-03', '1/1-3У', 'import')).toBe('2026-03-31');
  });
  it('documents and nalozi made in WISE keep their own date', () => {
    expect(vatDateOf('2026-04-03', '1/1-3', null)).toBe('2026-04-03');
    expect(vatDateOf('2026-04-03', '1/1-3', 'bank')).toBe('2026-04-03');
    expect(vatDateOf('2026-04-03', 'Налог 15', 'import')).toBe('2026-04-03');
  });
});

describe('isVatSettlement', () => {
  const out = (c: number) => ({ role: { kind: 'out' }, c }), inp = (c: number) => ({ role: { kind: 'in' }, c });
  it('the old program\'s VAT closing nalog (Д 230018 / П 130018 / П 23008) is a settlement', () => {
    expect(isVatSettlement([out(-14847300), inp(-6063300)], [{ account: '230018' }, { account: '130018' }, { account: '13005' }, { account: '23008' }])).toBe(true);
  });
  it('a sales nalog (П 230018) or a purchase (Д 130018) is not', () => {
    expect(isVatSettlement([out(14847300)], [{ account: '230018' }, { account: '1200' }])).toBe(false);
    expect(isVatSettlement([inp(1328300)], [{ account: '130018' }, { account: '2200' }])).toBe(false);
  });
  it('a credit note without the VAT payable konto is not', () => {
    expect(isVatSettlement([out(-100)], [{ account: '230018' }, { account: '1200' }])).toBe(false);
  });
});
