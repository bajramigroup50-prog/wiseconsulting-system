import { describe, expect, it } from 'vitest';
import { invoicePrintHtml } from './sales/invoice-print';

const input = (firm: Record<string, string>, partner: Record<string, string> | null) => ({
  kind: 'invoice' as const,
  doc: { kind: 'invoice', number: '0042/2026', date: '2026-10-16', currency: 'MKD', fx: 1 },
  firm: { name: firm.name!, address: firm.address, city: firm.city, edb: '4030000000001', vatRegistered: true },
  partner,
  lines: [{ name: 'Стока', qty: 1, price: 100, disc: 0, rate: 18 }],
});

describe('invoice print: old YUSCII characters', () => {
  it('the firm head and the buyer print as letters; stored text is not changed', () => {
    const firm = { name: 'Фирма ДОО', address: 'УЛ.БУЛЕВАР ГОЦЕ ДЕЛ^ЕВ 1', city: 'СКОПЈЕ - ^аир' };
    const partner = { name: 'КУПУВА^ ДООЕЛ', address: 'Ул. Гоце Дел~ев', city: 'Ш~ип' };
    const h = invoicePrintHtml(input(firm, partner));
    expect(h).toContain('УЛ.БУЛЕВАР ГОЦЕ ДЕЛЧЕВ 1');
    expect(h).toContain('КУПУВАЧ ДООЕЛ');
    expect(h).toContain('Ул. Гоце Делчев');
    expect(h).not.toMatch(/ДЕЛ\^ЕВ|Дел~ев|КУПУВА\^/);
    expect(firm.address).toBe('УЛ.БУЛЕВАР ГОЦЕ ДЕЛ^ЕВ 1');
    expect(partner.name).toBe('КУПУВА^ ДООЕЛ');
  });
  it('prints without a buyer', () => {
    expect(invoicePrintHtml(input({ name: 'Фирма', address: 'Ул. 1', city: 'Скопје' }, null))).toContain('ФАКТУРА');
  });
});
