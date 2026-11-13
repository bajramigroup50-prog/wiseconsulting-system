import { describe, expect, it } from 'vitest';
import { isPersonPartner } from './partner-person';
import { customerAccount, invoiceEntries, type PostingContext } from './index';

describe('isPersonPartner', () => {
  it('people', () => {
    expect(isPersonPartner({ name: 'РАМАЗАН АДЕМ БАЈРАМ' })).toBe(true);
    expect(isPersonPartner({ name: 'Мирослав Митрашиновиќ' })).toBe(true);
    expect(isPersonPartner({ name: 'Хана Миленковска', edb: '0101990455012' })).toBe(true);
    expect(isPersonPartner({ name: 'БЕЦИ-ПРОМ ЛТД ДООЕЛ' })).toBe(false);
  });
  it('companies and professions', () => {
    expect(isPersonPartner({ name: 'Адвокат Бранко Гроздановски' })).toBe(false);
    expect(isPersonPartner({ name: 'НЛБ БАНКА АД Скопје' })).toBe(false);
    expect(isPersonPartner({ name: 'Ѓоко Гажоски', edb: '5080016506054' })).toBe(false);
    expect(isPersonPartner({ name: 'Бранко Петров', edb: '4030990000011' })).toBe(false);
    expect(isPersonPartner({ name: 'ПЛАСЕТ ДОНЕР БУРГЕР' })).toBe(false);
    expect(isPersonPartner({ name: 'ЕВРО СТИЛ ТРЕЈД' })).toBe(false);
  });
  it('explicit flag wins', () => {
    expect(isPersonPartner({ name: 'X ДООЕЛ', data: { person: true } })).toBe(true);
    expect(isPersonPartner({ name: 'Марко Марковски', data: { person: false } })).toBe(false);
  });
});

describe('receivable of a natural person', () => {
  const ctx = (auto: string | null, sch: Record<string, string> = {}): PostingContext => ({ firm: { ddv: false, customerPersonAuto: auto, sch } });
  it('1205 when the chart has it, 1200 otherwise or when switched off', () => {
    expect(customerAccount(ctx('1205'), false, false, false, true)).toBe('1205');
    expect(customerAccount(ctx('1205'), false, false, false, false)).toBe('1200');
    expect(customerAccount(ctx(null), false, false, false, true)).toBe('1200');
    expect(customerAccount(ctx('1205', { customerPerson: '-' }), false, false, false, true)).toBe('1200');
    expect(customerAccount(ctx('1205', { customerPerson: '1201' }), false, false, false, true)).toBe('1201');
  });
  it('the invoice posting uses it', () => {
    const L = invoiceEntries({ date: '2026-03-01', partner: 'p', person: true, items: [{ name: 'Заверка', qty: 1, price: 1000, rate: 0 }] }, ctx('1205'));
    expect(L.find((l) => l.debit > 0)?.account).toBe('1205');
  });
});
