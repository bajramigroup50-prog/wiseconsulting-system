import { describe, expect, it } from 'vitest';
import { ISO_PURPOSE, isoOf, isoPurposeName, newPayments, purposeAliases, purposeIs } from './purpose-codes';
import { ppDesc, ppFieldText, ppLayout, ppNew, ppShort, ppTitle, ppWarnings } from './pp';
import { ppIban } from './payment-order';
import { parseAccount } from './mk-banks';

describe('ISO 20022 purpose codes (9 Nov 2026)', () => {
  it('has the official list and maps the most-used old codes', () => {
    expect(ISO_PURPOSE.length).toBeGreaterThan(290);
    expect(isoOf('200')).toBe('GDDS');
    expect(isoOf('220')).toBe('GDSV');
    expect(isoOf('930')).toBe('OTHR');
    expect(isoOf('101')).toBe('SALA');
    expect(isoOf('666')).toBe('FEES');
    expect(isoOf('gdsv')).toBe('GDSV');
    expect(isoOf('840')).toBe('');
    expect(isoPurposeName('SALA')).toBe('Плата');
  });
  it('treats the old and the new spelling of a purpose as the same', () => {
    expect(purposeAliases('GDDS')).toEqual(expect.arrayContaining(['GDDS', '200']));
    expect(purposeIs('ACCT', '457')).toBe(true);
    expect(purposeIs('457', 'ACCT')).toBe(true);
    expect(purposeIs('CASH', '800')).toBe(true);
    expect(purposeIs('OTHR', '800')).toBe(false);
  });
  it('switches on 9 Nov 2026', () => {
    expect(newPayments('2026-11-08')).toBe(false);
    expect(newPayments('2026-11-09')).toBe(true);
  });
});

describe('new payment orders КТД / КТБ / ВГ', () => {
  const firm = { name: 'ДЕМО ДООЕЛ', city: 'Скопје', account: '300000000555123', edb: '4030026555123' };
  it('MK IBANs always carry the check digits 07 (the national account already has MOD 97 control digits)', () => {
    for (const a of ['270077299520174', '100000000063095', '210000000000101', '300000000000606']) {
      if (parseAccount(a)) expect(ppIban(a).slice(0, 4)).toBe('MK07');
    }
  });
  it('names the forms by date', () => {
    expect(ppShort('pp30', '2026-11-06')).toBe('ПП30');
    expect(ppShort('pp30', '2026-11-09')).toBe('КТД');
    expect(ppShort('pp50', '2026-11-10')).toBe('КТБ');
    expect(ppTitle('pp10', '2026-12-01')).toMatch(/^ВГ/);
    expect(ppLayout('pp30', '2026-11-09').title).toMatch(/КТД/);
    expect(ppLayout('pp30', '2026-11-01').title).toBe('НАЛОГ ЗА ПРЕНОС');
  });
  it('merges the references and the purpose into „Опис на плаќањето“ in the banks\' order', () => {
    const n = ppNew('pp30', '2026-11-10', firm, { refCredit: '005/2026', refDebit: '12', purpose: 'Плаќање по фактура' });
    expect(n.code).toBe('OTHR');
    expect(ppDesc(n)).toBe('005/2026 / 12 / Плаќање по фактура');
    expect(ppFieldText(n, 'desc')).toBe('005/2026 / 12 / Плаќање по фактура');
    const b = ppNew('pp50', '2026-11-10', firm, { refDebit: '01102026-31102026', purpose: 'ДДВ за 10/2026' });
    expect(ppDesc(b)).toBe('01102026-31102026 / ДДВ за 10/2026');
  });
  it('prints an old numeric code as its ISO code on new orders and warns about long descriptions', () => {
    const n = ppNew('pp30', '2026-11-10', firm, { code: '220', purpose: 'x'.repeat(150) });
    expect(ppFieldText(n, 'code')).toBe('GDSV');
    const W = ppWarnings(n).join(' ');
    expect(W).toMatch(/140/);
    expect(W).toMatch(/GDSV/);
    expect(ppNew('pp30', '2026-11-06', firm).code).toBe('930');
  });
});
