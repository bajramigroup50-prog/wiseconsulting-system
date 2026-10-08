import { describe, expect, it } from 'vitest';
import {
  amountInWords, checkCredit, creditGrossLines, findDuplicate, fixLines, fixRates, invoiceTotals, isServiceInvoice, mkWords,
  nextDocNumber, ownerCheck, parseXml, purchaseDraftFromScan, saleDraftFromScan, scanConsistent, ublToScan, ublXml, unitCode,
  batchStatus, scanInvoices,
} from './sales';
import { purchaseEntries, SCH0 } from './posting';
import { calcLines } from './vat';

describe('mkWords', () => {
  it('spells amounts like legacy', () => {
    expect(mkWords(0)).toBe('нула');
    expect(mkWords(1)).toBe('еден');
    expect(mkWords(21)).toBe('дваесет и еден');
    expect(mkWords(115)).toBe('сто и петнаесет');
    expect(mkWords(1000)).toBe('илјада');
    expect(mkWords(2001)).toBe('две илјади и еден');
    expect(mkWords(21000)).toBe('дваесет и една илјада');
    expect(mkWords(1_250_340)).toBe('еден милион двесте и педесет илјади триста и четириесет');
    expect(amountInWords(11800.5)).toBe('единаесет илјади и осумстотини денари и 50/100');
  });
});

describe('nextDocNumber', () => {
  it('keeps prefix/padding and ignores the count (FIX 17)', () => {
    expect(nextDocNumber([], 2026)).toBe('001/2026');
    expect(nextDocNumber(['007/2026', '003/2026'], 2026)).toBe('008/2026');
    expect(nextDocNumber(['5/2026', '', null], 2026)).toBe('6/2026');
    expect(nextDocNumber(['F-0099'], 2026)).toBe('F-0100');
  });
});

describe('invoiceTotals', () => {
  const items = [{ qty: 3, price: 33.33, rate: 18 }, { qty: 1, price: 10, rate: 5 }];
  it('pays total minus advances; art. 32-a pays the base and shows transferred VAT', () => {
    const t = invoiceTotals({ items });
    expect(t).toMatchObject({ base: 109.99, vat: 18.5, total: 128.49, pay: 128.49 });
    const a = invoiceTotals({ items, art32: true });
    expect(a.pay).toBe(109.99);
    expect(a.transferredVat).toBe(19.8);
    const adv = invoiceTotals({ items: [{ qty: 1, price: 1000, rate: 18 }], advances: [{ amount: 500, invoice: { items: [{ qty: 1, price: 1000, rate: 18 }] } }] });
    expect(adv.advTotal).toBe(590);
    expect(adv.pay).toBe(590);
  });
  it('non-VAT firm has no VAT', () => {
    expect(invoiceTotals({ items }, { nonVat: true })).toMatchObject({ vat: 0, pay: 109.99 });
  });
});

describe('service invoices (FIX 13)', () => {
  const type = (id: string) => ({ s: 'service', g: 'goods' })[id];
  it('free-text lines are not services', () => {
    expect(isServiceInvoice({ items: [{ itemId: '' }] }, type)).toBe(false);
    expect(isServiceInvoice({ items: [{ itemId: 's' }] }, type)).toBe(true);
    expect(isServiceInvoice({ items: [{ itemId: 's' }, { itemId: 'g' }] }, type)).toBe(false);
    expect(isServiceInvoice({ svc: true, items: [{ itemId: '' }] }, type)).toBe(true);
  });
});

describe('credit notes', () => {
  const ref = { id: 'r', partnerId: 'p', date: '2026-03-01', number: '5/2026', total: 1180, items: [{ itemId: 'g', qty: 10 }] };
  const type = () => 'goods';
  it('validates partner, date, remainder and returned quantity', () => {
    const ok = { partnerId: 'p', date: '2026-03-02', total: 590, kind: 'ret', items: [{ itemId: 'g', qty: 5 }] };
    expect(checkCredit(ok, ref, [], type)).toBeNull();
    expect(checkCredit({ ...ok, partnerId: 'x' }, ref, [], type)).toMatch(/ист/);
    expect(checkCredit({ ...ok, date: '2026-02-01' }, ref, [], type)).toMatch(/пред/);
    expect(checkCredit({ ...ok, total: 700 }, ref, [{ total: 590, kind: 'price', items: [] }], type)).toMatch(/остатокот/);
    expect(checkCredit(ok, ref, [{ total: 100, kind: 'ret', items: [{ itemId: 'g', qty: 6 }] }], type)).toMatch(/повеќе/);
  });
  it('spreads a gross amount over rates', () => {
    const L = creditGrossLines({ number: '5', items: [{ qty: 1, price: 1000, rate: 18 }, { qty: 1, price: 1000, rate: 5 }] }, 500);
    expect(calcLines(L).total).toBe(500);
  });
});

describe('UBL', () => {
  const seller = { name: 'Продавач ДООЕЛ', edb: '4030000000001', address: 'ул. 1', vatRegistered: true };
  const buyer = { name: 'Купувач & Со', edb: '4030000000002' };
  const inv = { number: '12/2026', date: '2026-05-04', due: '2026-05-19', items: [{ name: 'Стока', qty: 2, price: 100, rate: 18, unit: 'ком', code: 'A1' }, { name: 'Услуга', qty: 1, price: 50.555, rate: 5, unit: 'час' }] };
  it('exports an invoice with MK tax ids, units and rounded amounts', () => {
    const x = ublXml(inv, seller, buyer, { bankAccount: '300000000000001' });
    expect(x).toContain('<Invoice ');
    expect(x).toContain('<cbc:CompanyID>MK4030000000001</cbc:CompanyID>');
    expect(x).toContain('unitCode="H87"');
    expect(x).toContain('unitCode="HUR"');
    expect(x).toContain('<cbc:LineExtensionAmount currencyID="MKD">50.56</cbc:LineExtensionAmount>');
    expect(x).toContain('Купувач &amp; Со');
    expect(() => parseXml(x)).not.toThrow();
  });
  it('exports credit notes as CreditNote and art. 32-a payable = base (FIX 7)', () => {
    const c = ublXml({ ...inv, credit: true, refNumber: '11/2026' }, seller, buyer);
    expect(c).toContain('<CreditNote ');
    expect(c).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(c).toContain('<cac:CreditNoteLine>');
    expect(c).toContain('<cbc:ID>11/2026</cbc:ID>');
    const a = ublXml({ ...inv, art32: true }, seller, buyer);
    expect(a).toContain('<cbc:PayableAmount currencyID="MKD">250.56</cbc:PayableAmount>');
    expect(a).toContain('<cbc:ID>AE</cbc:ID>');
  });
  it('round-trips through ublToScan; credit notes negative, art32 detected (FIX 8)', () => {
    const s = ublToScan(ublXml(inv, seller, buyer))!;
    expect(s).toMatchObject({ supplierName: 'Продавач ДООЕЛ', supplierEdb: '4030000000001', number: '12/2026', date: '2026-05-04', total: 289.09, art32: false, credit: false });
    expect(s.lines).toHaveLength(2);
    expect(s.groups!.map((g) => [g.rate, g.base, g.vat])).toEqual([[18, 200, 36], [5, 50.56, 2.53]]);
    const c = ublToScan(ublXml({ ...inv, credit: true }, seller, buyer))!;
    expect(c.credit).toBe(true);
    expect(c.total).toBe(-289.09);
    expect(ublToScan(ublXml({ ...inv, art32: true }, seller, buyer))!.art32).toBe(true);
    expect(ublToScan('<foo/>')).toBeNull();
    expect(ublToScan('not xml <')).toBeNull();
    expect(unitCode('кг')).toBe('KGM');
  });
});

describe('scan post-processing', () => {
  it('fixLines repairs the decimal scale from the amount', () => {
    expect(fixLines([{ qty: 80000, price: 2, amount: 160 }])[0]).toMatchObject({ qty: 80, price: 2 });
    expect(fixLines([{ qty: 4, price: 0, amount: 10 }])[0]).toMatchObject({ price: 2.5 });
  });
  it('fixRates moves a line to the right rate', () => {
    const r = fixRates({ groups: [{ rate: 18, base: 100, vat: 18 }, { rate: 5, base: 50, vat: 2.5 }], lines: [{ amount: 100, rate: 18 }, { amount: 50, rate: 18 }] });
    expect(r.lines!.map((l) => l.rate)).toEqual([18, 5]);
  });
  it('scanConsistent checks recapitulation against total and lines', () => {
    expect(scanConsistent({ groups: [{ rate: 18, base: 100, vat: 18 }], lines: [{ qty: 1, price: 100, amount: 100 }], total: 118 })).toBe(true);
    expect(scanConsistent({ groups: [{ rate: 18, base: 100, vat: 18 }], total: 150 })).toBe(false);
  });
  it('builds a purchase draft with scheme kontos (FIX 3)', () => {
    const d = purchaseDraftFromScan({
      supplierName: 'Добавувач', supplierEdb: '4030999000123', number: '7', date: '2026-04-01',
      groups: [{ rate: 18, base: 100, vat: 18, kind: 'goods' }, { rate: 18, base: 50, vat: 9, kind: 'service' }],
      lines: [{ name: 'Шраф', qty: 10, price: 10, amount: 100, rate: 18, code: 'S1' }],
    }, {
      partners: [{ id: 'P', name: 'Друго име', edb: 'MK4030999000123' }], items: [{ id: 'I', name: 'Шраф М8', supCodes: { P: 'S1' } }],
      accounts: { goods: '6600', material: '3100', other: '4000' }, today: '2026-05-01', vatClosed: (d) => d < '2026-04-01',
    });
    expect(d).toMatchObject({ partnerId: 'P', number: '7', date: '2026-04-01', shifted: false, ptype: 'stock' });
    expect(d.groups.map((g) => g.konto)).toEqual(['6600', '4000']);
    expect(d.stock).toEqual([expect.objectContaining({ itemId: 'I', qty: 10, price: 10 })]);
    const shifted = purchaseDraftFromScan({ date: '2026-01-10', total: 118 }, { partners: [], items: [], accounts: { goods: '6600', material: '3100', other: '4000' }, today: '2026-05-01', vatClosed: (d) => d < '2026-04-01' });
    expect(shifted).toMatchObject({ date: '2026-05-01', docDate: '2026-01-10', shifted: true });
    expect(shifted.groups[0]).toMatchObject({ base: 100, vat: 18, konto: '4000' });
  });
  it('builds a sales draft; art32 lines rate 18 (FIX 16)', () => {
    const d = saleDraftFromScan({ number: '', buyerName: 'Купувач', art32: true, lines: [{ name: 'Работа', qty: 2, price: 50, amount: 100, rate: 0 }] },
      { partners: [{ id: 'B', name: 'купувач' }], items: [], revKonto: '7400', today: '2026-05-01', nextNumber: '009/2026' });
    expect(d).toMatchObject({ number: '009/2026', partnerId: 'B', date: '2026-05-01' });
    expect(d.items[0]).toMatchObject({ rate: 18, konto: '7400', qty: 2, price: 50 });
  });
  it('ownerCheck is explicit per kind (FIX 9)', () => {
    expect(ownerCheck('purchase', { buyerEdb: '4030000000001' }, 'MK4030000000001')).toBeNull();
    expect(ownerCheck('purchase', { buyerEdb: '4030000000999' }, '4030000000001')).toMatch(/друга фирма/);
    expect(ownerCheck('sale', { buyerEdb: '4030000000999' }, '4030000000001')).toBeNull();
    expect(ownerCheck('sale', { buyerEdb: '4030000000001' }, '4030000000001')).toMatch(/влезна/);
    expect(scanInvoices({ invoices: [{ number: '1' }, { number: '2' }] })).toHaveLength(2);
  });
  it('one duplicate rule: partner + number + amount (FIX 10)', () => {
    const ex = [{ id: '1', partnerId: 'P', number: 'Ф-12/26', total: 1180, date: '2026-01-01' }];
    expect(findDuplicate({ partnerId: 'P', number: 'ф 12 26', total: 1180.5 }, ex)?.id).toBe('1');
    expect(findDuplicate({ partnerId: 'Q', number: 'Ф-12/26', total: 1180 }, ex)).toBeNull();
    expect(findDuplicate({ partnerId: 'P', number: 'Ф-12/26', total: 1300 }, ex)).toBeNull();
    expect(findDuplicate({ id: '1', partnerId: 'P', number: 'Ф-12/26', total: 1180 }, ex)).toBeNull();
    const d = purchaseDraftFromScan({ number: '1', total: 118, supplierName: 'X' }, { partners: [], items: [], accounts: { goods: '6600', material: '3100', other: '4000' }, today: '2026-05-01' });
    expect(batchStatus(d, null, null, null).status).toBe('ok');
    expect(batchStatus(d, null, { date: '2026-01-01' }, null).status).toBe('dup');
  });
});

describe('purchaseEntries: foreign cost supplier (FIX 4)', () => {
  it('credits supplierFx for a foreign cost supplier', () => {
    const L = purchaseEntries({ date: '2026-01-01', partner: 'S', imp: true, fx: 61.5, groups: [{ konto: '6600', rate: 0, base: 6150, vat: 0 }],
      costs: { trans: { amt: 1000, partner: 'T', foreign: true } } }, { firm: { ddv: true } });
    expect(L.find((l) => l.partnerId === 'T')!.account).toBe(SCH0.supplierFx);
  });
});
