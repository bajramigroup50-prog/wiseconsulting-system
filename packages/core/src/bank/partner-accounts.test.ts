import { describe, expect, it } from 'vitest';
import { accountsInText, fromIban, mkBankName, parseAccount, supplierAccountIn, toIban } from './mk-banks';
import { accountsFromStatementLines, addPartnerAccount, partnerAccountPatch, partnerAccounts } from './partner-accounts';
import { ppApplyIban, ppBatchOrders, ppInvoicesFill, ppNacin, ppRecipientFields } from './pp-fill';
import { ppBankName, ppNew, ppWarnings, ppFieldText } from './pp';
import { fixYuscii, hasYuscii } from '../text/yuscii';
import { ublToScan } from '../sales/ubl';
import { purchaseDraftFromScan } from '../sales/scan';
import { invoiceFromPdf } from '../noai/purchase';
import { pdfLines, type PdfItem } from '../noai/pdf-lines';

const HALK = '270077299520174'; // the firm's account from the owner's screenshot (valid control digits)
const KB = '300000001234555';
const NLB = '210000006789007';

describe('MK accounts and IBAN', () => {
  it('validates the control digits (MOD 97-10) in every spelling', () => {
    for (const a of [HALK, '270-0772995201-74', '270 0772995201 74', 'MK07270077299520174', 'MK07 2700 7729 9520 174']) expect(parseAccount(a)?.acc).toBe(HALK);
    expect(parseAccount('270077299520175')).toBeNull();
    expect(parseAccount('27007729952017')).toBeNull();
    expect(parseAccount('MK08270077299520174')).toBeNull();
    expect(parseAccount('DE89370400440532013000')).toMatchObject({ acc: '', foreign: true });
  });
  it('converts to IBAN (MK07 + 15 digits) and back', () => {
    expect(toIban(HALK)).toBe('MK07270077299520174');
    expect(toIban('300-0000000424-25')).toBe('MK07300000000042425');
    expect(toIban('250120000058984')).toBe('MK07250120000058984');
    expect(fromIban('MK07 2700 7729 9520 174')).toBe(HALK);
    expect(toIban('12345')).toBe('12345');
  });
  it('derives the bank name from the bank code', () => {
    expect(mkBankName(HALK)).toBe('Халк Банка АД Скопје');
    expect(mkBankName('MK07300000000042425')).toBe('Комерцијална Банка АД Скопје');
    expect(mkBankName(NLB)).toBe('НЛБ Банка АД Скопје');
    expect(mkBankName('380000000000000')).toBe('ПроКредит Банка АД Скопје');
    expect(mkBankName('100000000063095')).toBe('Народна банка на РСМ');
    expect(mkBankName('999000000000000')).toBe('');
    expect(ppBankName(HALK)).toBe('Халк Банка АД Скопје');
  });
  it('the payer bank on a new order is the bank, not the account label', () => {
    const n = ppNew('pp30', '2026-10-14', { name: 'БАЈРАМИ ГРОУП ДООЕЛ', address: 'ГОЦЕ ДЕЛ^ЕВ 1', city: '^аир', account: HALK });
    expect(n.payerBank).toBe('Халк Банка АД Скопје');
    expect(n.payer).toBe('БАЈРАМИ ГРОУП ДООЕЛ\nГОЦЕ ДЕЛЧЕВ 1, Чаир');
  });
});

describe('accounts printed in a document', () => {
  const text = [
    'ДОБАВУВАЧ ДООЕЛ Скопје, ЕДБ 4030999000111',
    'Жиро сметка: 300-0000012345-55 Комерцијална банка',
    'Купувач: Тест ДООЕЛ, сметка 270-0772995201-74',
    'Фактура бр. 15/2026  Вкупно 1.180,00  телефон 389070123456789',
  ].join('\n');
  it('finds only valid accounts, labelled first, without the own account', () => {
    const L = accountsInText(text, [HALK]);
    expect(L.map((a) => a.acc)).toEqual([KB]);
    expect(L[0]!.labelled).toBe(true);
    expect(supplierAccountIn(text, [HALK])).toBe(KB);
    expect(supplierAccountIn('IBAN: MK07 2100 0000 6789 007')).toBe(NLB);
  });
  it('free reader: the supplier account goes into the read and the draft', () => {
    const page = (rows: [number, string][][]): PdfItem[] => rows.flatMap((r, i) => r.map(([x, s]) => ({ page: 1, x, y: 800 - i * 14, w: s.length * 5, h: 9, s })));
    const L = pdfLines(page([
      [[50, 'Фактура број 15/2026']], [[50, 'Датум: 15.09.2026']], [[50, 'ЕДБ: MK4030999000111']], [[50, 'Жиро сметка: 300-0000012345-55']],
      [[50, 'ДДВ 18%'], [200, '1.000,00'], [300, '180,00']], [[50, 'Вкупно за плаќање:'], [300, '1.180,00']],
    ]));
    const r = invoiceFromPdf(L, { ownEdb: '4030000000001' })!;
    expect(r.supplierBankAccount).toBe(KB);
    const d = purchaseDraftFromScan(r, { partners: [], items: [], today: '2026-10-14', accounts: { goods: '6600', material: '3100', other: '4000' } } as never);
    expect(d.bankAcc).toBe(KB);
  });
  it('UBL: PayeeFinancialAccount is the supplier account', () => {
    const xml = `<Invoice xmlns:cbc="x" xmlns:cac="y"><cbc:ID>7</cbc:ID><cbc:IssueDate>2026-09-01</cbc:IssueDate>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Добавувач</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
      <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>MK07300000001234555</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
      <cac:LegalMonetaryTotal><cbc:PayableAmount>100</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
    expect(ublToScan(xml)?.supplierBankAccount).toBe('MK07300000001234555');
  });
});

describe('partner accounts', () => {
  it('merges the legacy column, adds / validates, keeps one default', () => {
    const L = partnerAccounts({ bankAccount: KB, bankName: null, data: {} });
    expect(L).toEqual([{ acc: KB, iban: 'MK07300000001234555', bank: 'Комерцијална Банка АД Скопје', def: true, src: 'manual' }]);
    const r = addPartnerAccount(L, '210-0000067890-07', { src: 'statement', at: '2026-10-01' });
    expect(r.added).toBe(true);
    expect(r.accounts.map((a) => [a.acc, !!a.def, a.src])).toEqual([[KB, true, 'manual'], [NLB, false, 'statement']]);
    expect(addPartnerAccount(r.accounts, NLB).added).toBe(false);
    expect(addPartnerAccount(r.accounts, '210000006789008').error).toMatch(/контролни/);
    expect(addPartnerAccount(r.accounts, '2100000067890').error).toMatch(/15 цифри/);
    const m = addPartnerAccount(r.accounts, NLB, { makeDefault: true }).accounts;
    expect(m.filter((a) => a.def).map((a) => a.acc)).toEqual([NLB]);
    expect(partnerAccountPatch({ x: 1 }, m)).toMatchObject({ bankAccount: NLB, bankName: 'НЛБ Банка АД Скопје', data: { x: 1 } });
  });
  it('learns from statement lines: per partner, valid, not own / treasury', () => {
    const M = accountsFromStatementLines([
      { partnerId: 'p1', counterAccount: 'MK07300000001234555', date: '2026-10-01' },
      { partnerId: 'p1', counterAccount: KB, date: '2026-10-05' },
      { partnerId: 'p1', counterAccount: '300000001234556', date: '2026-10-05' },
      { partnerId: 'p2', counterAccount: HALK, date: '2026-10-05' },
      { partnerId: 'p3', counterAccount: '100000000063095', date: '2026-10-05' },
      { partnerId: null, counterAccount: NLB, date: '2026-10-05' },
    ], [HALK]);
    expect([...M]).toEqual([['p1', [{ acc: KB, at: '2026-10-05' }]]]);
  });
});

describe('ПП30 autofill', () => {
  it('invoices → amount (exact), purpose, reference', () => {
    expect(ppInvoicesFill([{ refId: 'a', number: '15/2026', date: '2026-09-01', open: 1180.1 }])).toEqual({ amount: 1180.1, purpose: 'Плаќање по фактура бр. 15/2026', refCredit: '15/2026' });
    const f = ppInvoicesFill([{ refId: 'a', number: '15', date: '2026-09-01', open: 0.1 }, { refId: 'b', number: '16', date: '2026-09-02', open: 0.2 }]);
    expect(f).toEqual({ amount: 0.3, purpose: 'Плаќање по фактури бр. 15, 16', refCredit: '15, 16' });
  });
  it('recipient from a partner: name + seat, account, bank, method', () => {
    expect(ppRecipientFields({ name: 'Добавувач ДООЕЛ', address: 'ул. Ко~ани 3', city: 'Скопје', acc: KB })).toEqual({ recip: 'Добавувач ДООЕЛ\nул. Кочани 3, Скопје', recipAcc: KB, recipBank: 'Комерцијална Банка АД Скопје' });
    expect(ppNacin(HALK, KB)).toBe('2');
    expect(ppNacin('MK07300000000042425', KB)).toBe('3');
  });
  it('IBAN box converts both accounts; the order validates and prints them', () => {
    const n = ppApplyIban(ppNew('pp30', '2026-11-02', { name: 'Ф', account: HALK }, { recipAcc: KB, amount: 10 }), true);
    expect([n.payerAcc, n.recipAcc, n.iban]).toEqual(['MK07270077299520174', 'MK07300000001234555', true]);
    expect(ppWarnings(n)).toEqual([]);
    expect(ppFieldText(n, 'recipAcc', 'acc')).toBe('MK07300000001234555');
    expect(ppApplyIban(n, false).recipAcc).toBe(KB);
    expect(ppWarnings({ ...n, recipAcc: '30000000123455' })).toContain('Сметката на примачот мора да има 15 цифри.');
  });
  it('batch: one order per supplier with all its invoices, oldest first', () => {
    const party = { name: 'Добавувач', acc: KB };
    const R = ppBatchOrders([
      { refId: 'b', number: '20', date: '2026-09-10', open: 50, partnerId: 'p1', party },
      { refId: 'a', number: '10', date: '2026-09-01', open: 100.55, partnerId: 'p1', party },
      { refId: 'c', number: '7', date: '2026-09-05', open: 30, partnerId: 'p2', party: { name: 'Без сметка' } },
    ], { name: 'Ф', account: HALK }, '2026-10-14');
    expect(R.map((r) => [r.partnerId, r.refIds, r.order.amount, r.order.purpose, r.order.refCredit, r.order.recipAcc, r.missing])).toEqual([
      ['p1', ['a', 'b'], 150.55, 'Плаќање по фактури бр. 10, 20', '10, 20', KB, false],
      ['p2', ['c'], 30, 'Плаќање по фактура бр. 7', '7', '', true],
    ]);
  });
});

describe('YUSCII leftovers', () => {
  it('repairs Cyrillic words, leaves other text alone', () => {
    expect(fixYuscii('ДЕЛ^ЕВ')).toBe('ДЕЛЧЕВ');
    expect(fixYuscii('^аир')).toBe('Чаир');
    expect(fixYuscii('Ко~ани')).toBe('Кочани');
    expect(fixYuscii('[ТИП')).toBe('ШТИП');
    expect(fixYuscii('Ве}е @ИВКО')).toBe('Веќе ЖИВКО');
    expect(fixYuscii('info@firma.mk [1]')).toBe('info@firma.mk [1]');
    expect(hasYuscii('ГОЦЕ ДЕЛ^ЕВ')).toBe(true);
    expect(hasYuscii('ГОЦЕ ДЕЛЧЕВ')).toBe(false);
    expect(ppFieldText({ kind: 'pp30', date: '2026-10-14', payer: 'ул. ДЕЛ^ЕВ' }, 'payer')).toBe('ул. ДЕЛЧЕВ');
  });
});
