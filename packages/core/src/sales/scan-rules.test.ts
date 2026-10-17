/**
 * Draft rules of read incoming invoices (synthetic data): the supplier's konto memory, the electricity konto, the
 * previous debt of utility bills, pro-formas, and partner matching that never trusts a Treasury account.
 */
import { describe, expect, it } from 'vitest';
import { findPartnerMatch, type MatchablePartnerRow } from '../partners/match';
import { treasuryAccount } from '../bank/mk-banks';
import {
  docTypeFromText, energyKontoFromChart, notInvoiceMsg, prevDebtFix, purchaseDraftFromScan, scanConsistent, scanContentSig, supplierKontoMemory,
  type PurchaseDraftOptions, type ScanInvoice,
} from './scan';

const ACC = { goods: '6600', material: '3100', other: '4000', energy: '4030' };
const P: MatchablePartnerRow[] = [
  { id: 'evn', name: 'ЕВН ПРИМЕР ДООЕЛ', code: '10', edb: '4030999000777' },
  { id: 'tel', name: 'ТЕЛЕКОМ ПРИМЕР АД', code: '11', edb: '4030999000888' },
  { id: 'deb', name: 'ДЕБАР – ОРГАН НА ОПШТИНА', code: '12', edb: '4030999000999', data: { accounts: [{ acc: '100000000063095', iban: '', bank: 'НБРМ' }] } },
  { id: 'firm', name: 'АЛФА ПРИМЕР ДОО', code: '13', edb: '4030999000111', data: { accounts: [{ acc: '300000001234555', iban: '', bank: 'КБ' }] } },
];
const opts = (o: Partial<PurchaseDraftOptions> = {}): PurchaseDraftOptions => ({ partners: P, items: [], accounts: ACC, today: '2026-10-17', ...o });
const inv = (o: Partial<ScanInvoice>): ScanInvoice => ({ supplierName: 'ЕВН ПРИМЕР ДООЕЛ', supplierEdb: '4030999000777', number: '1', date: '2026-08-31', lines: [], ...o });

describe('expense konto of a read purchase', () => {
  it('electricity (kind energy) → the energy konto; everything else → the purchase default; goods → stock', () => {
    const d = purchaseDraftFromScan(inv({ supplierEdb: '4030999000555', supplierName: 'НОВ ДОО', groups: [{ rate: 18, base: 100, vat: 18, kind: 'energy' }, { rate: 5, base: 10, vat: 0.5, kind: 'service' }], total: 128.5 }), opts());
    expect(d.groups.map((g) => g.konto)).toEqual(['4030', '4000']);
    const g = purchaseDraftFromScan(inv({ groups: [{ rate: 18, base: 100, vat: 18, kind: 'goods' }], total: 118 }), opts({ supplierKontos: () => ({ byRate: { 18: '4120' }, main: '4120' }) }));
    expect(g.groups[0]!.konto).toBe('6600');
    // no energy konto given → the purchase default
    expect(purchaseDraftFromScan(inv({ groups: [{ rate: 18, base: 1, vat: 0.18, kind: 'energy' }] }), opts({ accounts: { ...ACC, energy: '' } })).groups[0]!.konto).toBe('4000');
  });

  it("the matched supplier's last purchase: same rate first, else its main konto; never the generic / stock kontos", () => {
    const mem = supplierKontoMemory([{ account: '4120', rate: 18, base: 900 }, { account: '4130', rate: 5, base: 100 }, { account: '4120', rate: 18, base: 50 }])!;
    expect(mem).toEqual({ byRate: { 18: '4120', 5: '4130' }, main: '4120' });
    const S = (pid: string) => (pid === 'tel' ? mem : null);
    const d = purchaseDraftFromScan(inv({ supplierName: 'Телеком', supplierEdb: '4030999000888', groups: [{ rate: 18, base: 10, vat: 1.8, kind: 'service' }, { rate: 5, base: 1, vat: 0.05 }, { rate: 10, base: 1, vat: 0.1 }] }), opts({ supplierKontos: S }));
    expect(d.partnerId).toBe('tel');
    expect(d.groups.map((g) => g.konto)).toEqual(['4120', '4130', '4120']);
    // the last purchase was on the default 4000 (no choice): electricity still goes to the energy konto
    const e = purchaseDraftFromScan(inv({ groups: [{ rate: 18, base: 10, vat: 1.8, kind: 'energy' }] }), opts({ supplierKontos: () => ({ byRate: { 18: '4000' }, main: '4000' }) }));
    expect(e.groups[0]!.konto).toBe('4030');
    // ... but a konto the user chose for the supplier wins
    expect(purchaseDraftFromScan(inv({ groups: [{ rate: 18, base: 10, vat: 1.8, kind: 'energy' }] }), opts({ supplierKontos: () => ({ byRate: { 18: '4020' }, main: '4020' }) })).groups[0]!.konto).toBe('4020');
  });

  it('the electricity konto from the chart: 4030 „Електрична енергија“ first, else 4020, else none', () => {
    expect(energyKontoFromChart([{ code: '4020', name: 'Електрична енергија' }, { code: '4030', name: 'ЕЛЕКТРИЧНА ЕНЕРГИЈА' }])).toBe('4030');
    expect(energyKontoFromChart([{ code: '4020', name: 'Електрична енергија' }, { code: '4030', name: 'Гориво' }])).toBe('4020');
    expect(energyKontoFromChart([{ code: '4030', name: 'Потрошена енергија' }])).toBe('');
  });
});

describe('previous debt of a utility bill is never booked', () => {
  it('EVN: 18 % 2463.13 / 443.36 + 0 % 382 = 3288.49, total read 3711 with a previous debt 422.51 → total 3288.49', () => {
    const r = inv({ groups: [{ rate: 18, base: 2463.13, vat: 443.36 }, { rate: 0, base: 382, vat: 0 }], total: 3711, prevDebt: 422.51 });
    // without the debt read the amounts do not match; with it the bill checks on its own amount
    expect(scanConsistent({ ...r, prevDebt: 0 })).toBe(false);
    expect(scanConsistent(r)).toBe(true);
    const { inv: x, debt } = prevDebtFix(r);
    expect([x.total, debt]).toEqual([3288.49, 422.51]);
    expect(scanConsistent(x)).toBe(true);
  });
  it('Телеком: 2480.38 / 446.47 = 2926.85, total 2999 with a previous debt 72.15', () => {
    expect(prevDebtFix(inv({ groups: [{ rate: 18, base: 2480.38, vat: 446.47 }], total: 2999, prevDebt: 72.15 })).inv.total).toBe(2926.85);
  });
  it('unchanged: no debt read, or the difference is not the debt', () => {
    const r = inv({ groups: [{ rate: 18, base: 2480.38, vat: 446.47 }], total: 2999 });
    expect(prevDebtFix(r)).toEqual({ inv: r, debt: 0 });
    const q = { ...r, prevDebt: 500 };
    expect(prevDebtFix(q)).toEqual({ inv: q, debt: 0 });
  });
});

describe('pro-forma / offer', () => {
  it('by the title, never by a reference on an invoice', () => {
    expect(docTypeFromText('ПРОФАКТУРА бр. 01488\nДЕНМАК ДООЕЛ')).toBe('proforma');
    expect(docTypeFromText('Про-фактура 12/2026')).toBe('proforma');
    expect(docTypeFromText('Предрачун бр. 4')).toBe('proforma');
    expect(docTypeFromText('PRO FORMA INVOICE')).toBe('proforma');
    expect(docTypeFromText('Понуда бр. 7')).toBe('offer');
    expect(docTypeFromText('ФАКТУРА бр. F01324\nпо профактура бр. 01488')).toBe('');
    expect(docTypeFromText('ФАКТУРА бр. 5\nПонудата важи 30 дена')).toBe('');
  });
  it('the draft note', () => {
    expect(notInvoiceMsg({ docType: 'proforma' })).toBe('профактура – не се книжи');
    expect(notInvoiceMsg({ docType: 'invoice' })).toBe('');
    expect(notInvoiceMsg({})).toBe('');
    expect(notInvoiceMsg({ docType: 'offer' })).toMatch(/понуда/);
  });
  it('content signature: same supplier, lines and total under another number → same; a 1-line monthly bill → none', () => {
    const lines = Array.from({ length: 16 }, (_, i) => ({ name: 'LAVAZZA ' + (i + 1), qty: 2, price: 100, amount: 200 }));
    const a = inv({ supplierEdb: '4030999000333', number: 'F01324', date: '2026-08-31', lines, total: 15826 });
    const b = { ...a, number: '01488', date: '2026-09-28', lines: [...lines].reverse() };
    expect(scanContentSig(a)).toBe(scanContentSig(b));
    expect(scanContentSig(a)).not.toBe('');
    expect(scanContentSig({ ...b, total: 15000 })).not.toBe(scanContentSig(a));
    expect(scanContentSig(inv({ lines: [{ name: 'Закуп', qty: 1, amount: 1000 }], total: 1180 }))).toBe('');
  });
});

describe('partner by bank account', () => {
  it('a Treasury account (bank 100) never identifies a partner → no partner (a new one from the ЕДБ + name)', () => {
    expect(treasuryAccount('100-0000000630-95')).toBe(true);
    expect(treasuryAccount('300-0000012345-55')).toBe(false);
    const m = findPartnerMatch(P, { name: 'Министерство за финансии – Биро за јавни набавки', id: 'MK4080009505456', bankAccount: '100-0000000630-95' });
    expect(m.partner).toBeNull();
    const d = purchaseDraftFromScan(inv({ supplierName: 'Министерство за финансии – Биро за јавни набавки', supplierEdb: 'MK4080009505456', supplierBankAccount: '100-0000000630-95', groups: [{ rate: 18, base: 100, vat: 18 }] }), opts());
    expect(d.partnerId).toBe('');
  });
  it('a bank match whose partner has another ЕДБ than the document is rejected; the same ЕДБ / no ЕДБ still matches', () => {
    expect(findPartnerMatch(P, { name: 'Друга фирма', id: '4030999000444', bankAccount: '300000001234555' }).partner).toBeNull();
    expect(findPartnerMatch(P, { name: 'Друга фирма', bankAccount: '300000001234555' }).partner?.id).toBe('firm');
    expect(findPartnerMatch(P, { name: 'X', id: '4030999000111', bankAccount: '300000001234555' }).partner?.id).toBe('firm');
  });
});
