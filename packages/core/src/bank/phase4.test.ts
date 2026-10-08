import { describe, expect, it } from 'vitest';
import { ledgerOpenItems, ledgerDocRef, parseLedgerItemId } from './open-items';
import { splitStatementByDate, statementAccount, statementOwnerMismatch } from './statements';
import { ppAccountOk, ppErrors, ppNew, ppTaxNew, ppWarnings, ppBankName, ppFieldText } from './pp';
import { cashDefaultRate, cashVoucherDuplicate, cashVoucherNextNo, defaultCashRegisters } from './cash';
import { autoMatch, linkPayment, openDocsFor, fxRate, type MatchContext } from '../bank-match';
import type { Statement } from '../bank-parsers';

/** Valid 15-digit MK account for a 13-digit prefix (NBRM MOD 97-10). */
const mkAcc = (p13: string) => {
  let r = 0;
  for (const c of p13 + '00') r = (r * 10 + +c) % 97;
  return p13 + String(98 - r).padStart(2, '0');
};

describe('ledgerOpenItems', () => {
  const L = [
    { account: '1200', debit: 1000, credit: 0, date: '2026-01-10', partnerId: 'P1', doc: '1/2026' },
    { account: '1200', debit: 500, credit: 0, date: '2026-01-05', partnerId: 'P1', doc: '2/2026' },
    { account: '1200', debit: 0, credit: 300, date: '2026-02-01', partnerId: 'P1', doc: '1/2026' },
    // bank journal — excluded
    { account: '1200', debit: 0, credit: 700, date: '2026-02-02', partnerId: 'P1', doc: '1/2026', sourceType: 'bank_statement' },
    // payment without reference → FIFO to oldest (2/2026 dated 05.01)
    { account: '1200', debit: 0, credit: 200, date: '2026-02-03', partnerId: 'P1' },
    { account: '2210', debit: 0, credit: 800, date: '2026-01-20', partnerId: 'S1', note: 'Ф-ра бр. 77' },
    { account: '4000', debit: 800, credit: 0, date: '2026-01-20' },
    { account: '1200', debit: 50, credit: 0, date: '2026-01-01', partnerId: 'P2' },
  ];
  const X = ledgerOpenItems(L, { exclude: (l) => l.sourceType === 'bank_statement' });
  it('groups receivables by partner and document, applies unreferenced payments FIFO', () => {
    const inv = Object.fromEntries(X.invoices.map((d) => [d.number, d]));
    expect(inv['1/2026']).toMatchObject({ total: 100000, paidOther: 30000, partner: 'P1', konto: '1200' });
    expect(inv['2/2026']).toMatchObject({ total: 50000, paidOther: 20000 });
    expect(X.invoices.find((d) => d.partner === 'P2')).toMatchObject({ number: '', total: 5000 });
  });
  it('reads payables with the document number from the note and keeps the konto', () => {
    expect(X.purchases).toEqual([expect.objectContaining({ number: '77', total: 80000, paidOther: 0, konto: '2210', partner: 'S1' })]);
    expect(parseLedgerItemId(X.purchases[0]!.id)).toEqual({ konto: '2210', partnerId: 'S1', ref: '77' });
  });
  it('doc ref falls back to a single invoice number in the note', () => {
    expect(ledgerDocRef({ doc: '', note: 'фактура 12/26 и 13/26' })).toBe('');
    expect(ledgerDocRef({ doc: ' 5 ', note: '' })).toBe('5');
  });
  it('feeds matching: payment linked on the document konto (2210), allocation capped', () => {
    const ctx: MatchContext = {
      rows: [{ id: 'b1', date: '2026-03-01', amount: -90000, desc: 'Плаќање фактура бр. 77', partner: 'S1' }],
      accounts: [{ id: 'a', konto: '1000' }], invoices: X.invoices, purchases: X.purchases, partners: [{ id: 'S1', name: 'Добавувач' }],
    };
    const r = autoMatch(ctx);
    expect(r.changes[0]).toMatchObject({ how: 'num', excess: 10000 });
    expect(r.changes[0]!.row).toMatchObject({ konto: '2210', partner: 'S1' });
    const o = openDocsFor(ctx.rows[0]!, ctx);
    const l = linkPayment(ctx.rows[0]!, o.O, o.type);
    expect(l!.row.konto).toBe('2210');
    expect(l!.refs).toEqual([{ type: 'purchase', id: X.purchases[0]!.id, label: '77', amt: 80000 }]);
  });
});

describe('statements', () => {
  const st: Statement = {
    format: 'mt940', account: '300000000123456', no: '15', date: '2026-03-03', currency: 'MKD', opening: 10000, closing: 13000, debit: null, credit: null,
    lines: [
      { date: '2026-03-02', amount: 5000, counterparty: '', ref: '', purpose: '', desc: 'a' },
      { date: '2026-03-03', amount: -2000, counterparty: '', ref: '', purpose: '', desc: 'b' },
    ],
  };
  it('splits per date with running balances and the file number on the last day', () => {
    expect(splitStatementByDate(st).map((d) => [d.date, d.no, d.opening, d.closing, d.lines.length])).toEqual([
      ['2026-03-02', '', 10000, 15000, 1], ['2026-03-03', '15', 15000, 13000, 1],
    ]);
    const back = splitStatementByDate({ ...st, opening: null });
    expect(back[0]!.opening).toBe(10000);
  });
  it('finds the bank account by number and checks the owner', () => {
    const A = [{ id: 'x', account: '210000000000001', cur: 'MKD' }, { id: 'y', account: '300-0000001234-56', cur: 'MKD' }];
    expect(statementAccount(st, A)?.id).toBe('y');
    expect(statementAccount({ ...st, account: '', iban: '' }, A)).toBeNull();
    expect(statementOwnerMismatch('АЛФА ДООЕЛ Скопје', 'Алфа ДООЕЛ')).toBe(false);
    expect(statementOwnerMismatch('Бета ДОО', 'Алфа ДООЕЛ')).toBe(true);
    expect(statementOwnerMismatch('', 'Алфа')).toBe(false);
  });
});

describe('payment orders', () => {
  const good = mkAcc('3000000001234');
  it('validates MK accounts with control digits and IBANs', () => {
    expect(ppAccountOk(good)).toBe(true);
    expect(ppAccountOk(good.slice(0, 14) + ((+good[14]! + 1) % 10))).toBe(false);
    expect(ppAccountOk('MK08' + good)).toBe(false); // wrong IBAN check digits
    expect(ppAccountOk('MK07' + good)).toBe(true);
    expect(ppBankName(good)).toBe('Комерцијална Банка АД Скопје');
  });
  it('new orders: firm as payer, ПП50 to the budget, warnings and errors', () => {
    const n = ppNew('pp30', '2026-10-08', { name: 'Алфа', city: 'Скопје', account: good }, { recipAcc: '123', amount: 0 });
    expect(n).toMatchObject({ payer: 'Алфа\nСкопје', payerAcc: good, code: '930', nacin: '2' });
    expect(ppWarnings(n)).toEqual(['Сметката на примачот мора да има 15 цифри.', 'Внесете износ.']);
    expect(ppErrors({ ...n, recipAcc: good.slice(0, 14) + ((+good[14]! + 1) % 10) })).toEqual(['Сметката на примачот не е валидна.']);
    const t = ppTaxNew('dda', '2026-10-08', { name: 'Алфа' }, { muni: '182', akont: 1500 });
    expect(t).toMatchObject({ kind: 'pp50', recipAcc: '100000000063095', uplSm: '840-182-01076', refDebit: '01092026-30092026', amount: 1500 });
    expect(ppFieldText({ ...n, amount: 1234.5 }, 'amount', 'amt')).toBe('1.234,50');
    expect(ppFieldText(n, 'payerAcc', 'acc')).toBe(good.slice(0, 3) + '-' + good.slice(3, 13) + '-' + good.slice(13));
  });
});

describe('cash register helpers', () => {
  it('numbers, defaults, duplicates', () => {
    expect(cashVoucherNextNo('out', ['И-009', 'И-010', null])).toBe('И-011');
    expect(cashVoucherNextNo('in', [])).toBe('У-001');
    expect(cashDefaultRate('fuel', 'MK')).toBe(10);
    expect(cashDefaultRate('food', 'DE')).toBe(0);
    expect(defaultCashRegisters((k) => k === '1051').map((r) => r.konto)).toEqual(['1020', '1051']);
    expect(cashVoucherDuplicate({ docNo: '12', date: '2026-01-01', amt: 100 }, [{ id: 'a', docNo: ' 12', date: '2026-01-01', amt: '100' }])?.id).toBe('a');
  });
  it('FIX #4: rates come from fxRate (firm → office → default), not a hard-coded 61.5', () => {
    expect(fxRate('EUR', '2026-10-01', { office: [{ cur: 'EUR', rate: 61.6950, date: '2026-09-15' }, { cur: 'EUR', rate: 61.7, date: '2026-10-05' }] })).toBe(61.695);
    expect(fxRate('EUR', '2026-10-01', { firm: [{ cur: 'EUR', rate: 61.4 }], office: [{ cur: 'EUR', rate: 61.7 }] })).toBe(61.4);
    expect(fxRate('MKD', '2026-10-01')).toBe(1);
  });
});
