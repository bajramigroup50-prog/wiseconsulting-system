import { describe, expect, it } from 'vitest';
import { supplierWarnings } from './finpar-cards';

const f = (n: number) => n.toFixed(2);
describe('supplier warnings (legacy supWarn 8485 + 8621)', () => {
  it('regular supplier without last month invoice, unlinked payments, debit balance', () => {
    const W = supplierWarnings({
      pid: 'p', name: 'ЕВН', today: '2026-06-15', year: '2026', purchaseMonths: ['2026-02', '2026-03', '2026-04'],
      unlinkedPays: [{ date: '2026-05-10', amount: -500 }, { date: '2026-06-01', amount: -300 }], openInvoices: 100, balance22: 5, fmt: f,
    });
    expect(W.map((w) => w.lvl)).toEqual(['bad', 'warn', 'warn']);
    expect(W[1]!.txt).toContain('за 05/2026 нема влезна фактура');
    expect(W[2]!.txt).toContain('2 плаќања (800.00 ден., последно 01.06.2026)');
  });
  it('quiet before the 10th and when invoices cover the payments', () => {
    expect(supplierWarnings({ pid: 'p', name: 'X', today: '2026-06-05', year: '2026', purchaseMonths: ['2026-02', '2026-03', '2026-04'], unlinkedPays: [{ date: '2026-05-10', amount: -50 }], openInvoices: 100, balance22: 0, fmt: f })).toEqual([]);
  });
});
