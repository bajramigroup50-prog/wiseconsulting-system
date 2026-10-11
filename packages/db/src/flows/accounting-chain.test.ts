/**
 * Workflows 1, 2, 3 and 5 on one firm, in the order an accountant works a month (March 2026):
 *  1. new firm (monthly VAT) → partner → item → advance + sales invoice (18 % + 5 %) → journal → print HTML → credit note
 *     (red storno) → VAT books;
 *  2. purchase (VAT groups, stock lines, landed costs) → calculation → item card / average cost → transfer to a store →
 *     levelling → POS sale with a loyalty card → Z report → МЕТГ;
 *  3. bank statement for a firm without a bank account (account opens) → auto-match → open items closed → cash voucher →
 *     compensation → ПП30;
 *  5. ДДВ-04 of the month → close → posting into the closed period refused → reopen.
 * Every step asserts amounts, not just "no error".
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { firmSettingsFrom } from '@wise/core/firms/firmform';
import { invoicePrintHtml } from '@wise/core/sales';
import { itemCard, metgCard, parseStatementFile, stockAt, vatBookIn, vatBookOut, vatBookSum } from '@wise/core';
import * as schema from '../schema/index';
import { harness, r2 } from './harness';
import { saveInvoice, type InvoiceInput } from '../sales/invoices';
import { savePurchase } from '../sales/purchases';
import { loadInvoicePrintData } from '../sales/invoice-print';
import type { DocActor } from '../sales/context';
import { loadStockContext } from '../stock-service';
import { saveLevelling, saveSalesDay, saveTransfer, type Actor } from '../stock-docs';
import { stockDocResolver } from '../stock-reports';
import { saveLoyaltyCard } from '../retail';
import { posSaleWithLoyalty } from '../parity-retail';
import {
  applyMatches, createDefaultRegisters, documentPayments, kompOpenItems, loadRegisters, orderSuggestions, proposeMatches, saveCompensation,
  saveImport, savePaymentOrder, saveVoucher,
} from '../bank/index';
import { closeVatPeriod, computeVatPeriod, reopenVatPeriod } from '../vat-service';
import { defaultVatSource } from '../vat-source';
import { loadVatPostingContext } from '../vat-context';

const H = harness();
const { db, tx, err, journal, sumPrefix } = H;
const office: DocActor = { userId: null, role: 'acc' };
let firm: schema.Firm;
let firmId = '', cust = '', sup = '', svc = '', goods = '', store = '';
let A: Actor;
const ids: Record<string, string> = {};

const reload = async () => { [firm] = (await db.select().from(schema.firms).where(eq(schema.firms.id, firmId))) as [schema.Firm]; return firm; };

beforeAll(async () => {
  await H.setup();
  // the firm form (saveFirm): settings through the same merge the editor uses
  const sr = firmSettingsFrom({ text: { bank: '300000000012355', invNote: '' }, checked: new Set(), settings: {}, vatIn: {}, vatOut: {}, withFee: false });
  if (!sr.ok) throw new Error(sr.error);
  const [f] = await db.insert(schema.firms).values({
    name: 'ТЕК ТОК ДООЕЛ Скопје', edb: '4030026000011', embs: '7000011', city: 'Скопје', address: 'ул. Прва 1',
    vatRegistered: true, vatPeriod: 'month', settings: sr.settings,
  }).returning();
  firm = f!; firmId = f!.id; A = { firmId, userId: null };
}, 120_000);

describe('flow 1 — sales', () => {
  it('partner and items', async () => {
    const P = await db.insert(schema.partners).values([
      { firmId, name: 'Купувач ДООЕЛ', code: '1', edb: '4030026000999', vatRegistered: true, city: 'Битола' },
      { firmId, name: 'Добавувач ДОО', code: '2', edb: '4030026000888', vatRegistered: true, bankAccount: '210000000000074' },
    ]).returning();
    cust = P[0]!.id; sup = P[1]!.id;
    const I = await db.insert(schema.items).values([
      { firmId, name: 'Консултантска услуга', code: '10', type: 'service', vatRate: 18, price: '1000' },
      { firmId, name: 'Кафе 250г', code: '20', type: 'goods', vatRate: 18, unit: 'ком', price: '177' },
    ]).returning();
    svc = I[0]!.id; goods = I[1]!.id;
  });

  it('advance invoice: 1 000 + 18 % on 2220', async () => {
    const a = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-03-02', partnerId: cust, advance: true, lines: [{ name: 'Аванс', qty: 1, price: 1000, rate: 18 }] }, office));
    ids.adv = a.id;
    expect(a.number).toBe('001/2026');
    const J = (await journal('invoice', a.id))!;
    expect(J.by['1200']).toBe(1180);
    expect(J.by['2220']).toBe(-1000);
    expect(sumPrefix(J.by, '2300')).toBe(-180);
  });

  it('sales invoice 18 % + 5 % with the advance deducted posts the right journal', async () => {
    const input: InvoiceInput = {
      kind: 'invoice', date: '2026-03-10', partnerId: cust, due: '2026-03-25',
      lines: [
        { itemId: svc, name: 'Консултантска услуга', qty: 2, price: 1000, rate: 18 },
        { name: 'Учебници', qty: 4, price: 125, rate: 5, unit: 'ком' },
      ],
      advances: [{ advanceId: ids.adv!, amount: 1000 }],
    };
    const r = await tx((t) => saveInvoice(t, firmId, input, office));
    ids.inv = r.id;
    expect(r).toMatchObject({ number: '002/2026', status: 'posted' });
    const J = (await journal('invoice', r.id))!;
    expect(J.j.kind).toBe('izlez');
    // 2 000 + 360 + 500 + 25 = 2 885; advance 1 000 + 180 deducted → customer owes 1 705
    expect(J.by['1200']).toBe(1705);
    expect(J.by['2220']).toBe(1000);
    expect(J.by['230018']).toBe(-360 + 180);
    expect(J.by['23005']).toBe(-25); // legacy konto: '2300' + rate
    expect(sumPrefix(J.by, '7')).toBe(-2500);
    // the money lines balance; the 99x VAT-base lines balance on their own
    const money = J.L.filter((l) => !l.account.startsWith('99'));
    expect(r2(money.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0))).toBe(0);
    const [d] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    expect(Number(d!.total)).toBe(2885);
  });

  it('renders the print HTML with number, partner, both rates and the amount due', async () => {
    const d = (await loadInvoicePrintData(db, ids.inv!))!;
    expect(d.partner?.name).toBe('Купувач ДООЕЛ');
    expect(d.input.advances).toHaveLength(1);
    const html = invoicePrintHtml({ ...d.input, img: () => '' });
    expect(html).toContain('002/2026');
    expect(html).toContain('Купувач ДООЕЛ');
    expect(html).toContain('Учебници');
    expect(html).toMatch(/1[.\s]?705,00/);
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it('credit note (price reduction) is booked as red storno on the original sides', async () => {
    const c = await tx((t) => saveInvoice(t, firmId, {
      kind: 'credit', date: '2026-03-15', partnerId: cust, refInvoiceId: ids.inv!, creditKind: 'price',
      lines: [{ itemId: svc, name: 'Консултантска услуга', qty: 1, price: 200, rate: 18 }],
    }, office));
    ids.cr = c.id;
    const J = (await journal('invoice', c.id))!;
    expect(J.j.kind).toBe('odobr');
    expect(J.by['1200']).toBe(-236);
    expect(J.by['230018']).toBe(36);
    // red storno: minus amounts on the original side (debit of 1200, credit of revenue / VAT)
    const cl = J.L.find((l) => l.account === '1200')!;
    expect([Number(cl.debit), Number(cl.credit)]).toEqual([-236, 0]);
    const vl = J.L.find((l) => l.account === '230018')!;
    expect([Number(vl.debit), Number(vl.credit)]).toEqual([0, -36]);
  });

  it('VAT books of March: output book has the advance, invoice and credit note; totals match ДДВ-04', async () => {
    const f = await reload();
    const ctx = await loadVatPostingContext(db, f);
    const data = await defaultVatSource.load(db, f, '2026-03-01', '2026-03-31', ctx);
    const rows = vatBookOut(data.docs, '2026-03-01', '2026-03-31', ctx, { partners: data.partners });
    expect(rows).toHaveLength(3);
    const s = vatBookSum(rows, 'out');
    // 18 %: advance 1 000 + invoice (2 000 − 1 000 advance) − credit 200 = 1 800 → VAT 324; 5 %: 500 → 25
    expect([s.b18, s.v18, s.b5, s.v5]).toEqual([1800, 324, 500, 25]);
  });
});

describe('flow 2 — purchases, stock and retail', () => {
  it('purchase with two VAT groups, stock lines and landed costs → calculation, stock at landed cost', async () => {
    const r = await tx((t) => savePurchase(t, firmId, {
      number: '501/2026', date: '2026-03-03', partnerId: sup, ptype: 'stock',
      groups: [{ account: '6600', rate: 18, base: 10000, vat: 1800 }, { account: '4100', rate: 5, base: 200, vat: 10 }],
      stock: [{ itemId: goods, qty: 100, price: 100 }],
      costs: { trans: { amount: 500, partnerId: sup, lines: [{ base: 500, rate: 18, vat: 90 }] } },
    }, office));
    ids.pur = r.id;
    expect(r.status).toBe('posted');
    const J = (await journal('purchase', r.id))!;
    expect(J.by['6600']).toBe(10500);
    expect(J.by['4100']).toBe(200);
    expect(J.by['130018']).toBe(1890);
    expect(J.by['13005']).toBe(10);
    // the supplier invoice is 11 800 + 210; the transport (500 + 90) is booked on the same supplier as a separate cost
    expect(J.by['2200']).toBe(-(11800 + 210 + 590));
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, r.id));
    expect(p!.calcNo).toBeTruthy();
    const L = await loadStockContext(db, firmId);
    const s = stockAt(L.ctx, { item: goods, wh: 'main', date: '2026-03-03' });
    expect([s.qty, r2(s.value)]).toEqual([100, 10500]);
  });

  it('a second receipt at a higher price moves the average cost; the item card shows both', async () => {
    const r = await tx((t) => savePurchase(t, firmId, {
      number: '502/2026', date: '2026-03-04', partnerId: sup, ptype: 'stock',
      groups: [{ account: '6600', rate: 18, base: 11500, vat: 2070 }], stock: [{ itemId: goods, qty: 100, price: 115 }], costs: {},
    }, office));
    ids.pur2 = r.id;
    const L = await loadStockContext(db, firmId);
    const s = stockAt(L.ctx, { item: goods, wh: 'main', date: '2026-03-04' });
    expect([s.qty, r2(s.value), r2(s.value / s.qty)]).toEqual([200, 22000, 110]);
    const item = L.ctx.items!.find((i) => i.id === goods)!;
    const card = itemCard(L.ctx, { item, wh: 'main', from: '2026-03-01', to: '2026-03-31' });
    expect(card.totals).toMatchObject({ in: 200, out: 0, q: 200 });
    expect(r2(card.totals.v)).toBe(22000);
  });

  it('transfer 50 to the store at average cost, store retail price 177', async () => {
    // the store is kept at retail value (legacy „малопродажба по продажни цени“)
    await db.update(schema.firms).set({ settings: { ...(firm.settings as object), sch: { retailMethod: true } } }).where(eq(schema.firms.id, firmId));
    const [st] = await db.insert(schema.codes).values({ firmId, cb: 'store', code: '01', name: 'Продавница Центар' }).returning();
    store = st!.id;
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-03-05', from: 'main', to: store, lines: [{ itemId: goods, qty: 50, sp: 177 }] }));
    ids.tr = r.id;
    const L = await loadStockContext(db, firmId);
    expect(stockAt(L.ctx, { item: goods, wh: 'main', date: '2026-03-05' }).qty).toBe(150);
    expect(stockAt(L.ctx, { item: goods, wh: store, date: '2026-03-05' }).qty).toBe(50);
    const J = (await journal('stock:transfer', r.id))!;
    // cost 50 × 110 out of the warehouse; the store holds retail value 50 × 177 = 8 850 incl. VAT (VAT 1 350, margin 2 000)
    expect(J.by).toEqual({ '6630': 8850, '6600': -5500, '6694': -2000, '6640': -1350 });
  });

  it('levelling the store price to 165.20 books the difference on the 50 pieces', async () => {
    const r = await tx((t) => saveLevelling(t, A, { date: '2026-03-06', wh: store, prices: { [goods]: 165.2 }, today: '2026-03-06' }));
    ids.niv = r.id;
    const [d] = await db.select().from(schema.levellingDocs).where(eq(schema.levellingDocs.id, r.id));
    expect(d!.lines).toMatchObject([{ itemId: goods, qty: 50, old: 177, new: 165.2 }]);
    // 50 × (165.20 − 177) = −590 incl. VAT: C 6630 590 / D 6694 500 / D 6640 90
    expect((await journal('levelling', r.id))!.by).toEqual({ '6630': -590, '6694': 500, '6640': 90 });
  });

  it('POS sale in the store with a 10 % loyalty card', async () => {
    await tx((t) => saveLoyaltyCard(t, A, { number: '2800000077', name: 'Петар', phone: '070 777 777', discount: 10, points: 0 }));
    const r = await tx((t) => posSaleWithLoyalty(t, A, { date: '2026-03-07', wh: store, cart: [{ itemId: goods, qty: 5, price: 165.2, rate: 18 }], cardNo: '2800000077' }));
    ids.pos = r.id;
    expect(r.total).toBe(826);
    expect(r.disc).toBe(82.6);
    expect(r.pay).toBe(743.4);
    const L = await loadStockContext(db, firmId);
    expect(stockAt(L.ctx, { item: goods, wh: store, date: '2026-03-07' }).qty).toBe(45);
    const J = (await journal('sales_daily', r.id))!;
    const money = J.L.filter((l) => !l.account.startsWith('99'));
    expect(r2(money.reduce((s, l) => s + Number(l.debit), 0))).toBe(743.4);
    expect(r2(money.reduce((s, l) => s + Number(l.credit), 0))).toBe(743.4);
    expect(J.by['230018']).toBe(-113.4); // 743.40 × 18/118
  });

  it('Z report of the store posts the fiscal turnover and issues the goods', async () => {
    const r = await tx((t) => saveSalesDay(t, A, {
      kind: 'fisk', date: '2026-03-08', wh: store, number: '21', gross: { 18: 1652 }, card: 652, fisk: { sc: 'trg' }, issue: true,
      lines: [{ itemId: goods, qty: 10, price: 165.2 }],
    }));
    ids.z = r.id;
    expect(r.total).toBe(1652);
    const J = (await journal('sales_daily', r.id))!;
    expect(J.by['230018']).toBe(-252);
    const money = J.L.filter((l) => !l.account.startsWith('99'));
    expect(r2(money.reduce((s, l) => s + Number(l.debit), 0))).toBe(1652);
    const L = await loadStockContext(db, firmId);
    expect(stockAt(L.ctx, { item: goods, wh: store, date: '2026-03-08' }).qty).toBe(35);
  });

  it('МЕТГ of the item over all warehouses and of the store', async () => {
    const L = await loadStockContext(db, firmId);
    const docOf = await stockDocResolver(db, L);
    const all = metgCard(L.ctx, { item: goods, from: '2026-03-01', to: '2026-03-31', docOf });
    // warehouses only: 200 in, 50 transferred out
    expect(all.totals).toEqual({ in: 200, out: 50, bal: 150 });
    const st = metgCard(L.ctx, { item: goods, wh: store, from: '2026-03-01', to: '2026-03-31', docOf });
    expect(st.totals).toEqual({ in: 50, out: 15, bal: 35 });
  });
});

describe('flow 3 — bank, cash, compensation, payment orders', () => {
  const camt = (amtIn: string, amtOut: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>1</MsgId><CreDtTm>2026-03-20T10:00:00</CreDtTm></GrpHdr>
<Stmt><Id>S1</Id><ElctrncSeqNb>7</ElctrncSeqNb><CreDtTm>2026-03-20T10:00:00</CreDtTm>
<Acct><Id><Othr><Id>300000000012355</Id></Othr></Id><Ccy>MKD</Ccy><Ownr><Nm>ТЕК ТОК ДООЕЛ Скопје</Nm></Ownr></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="MKD">0.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-03-20</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="MKD">${(Number(amtIn) - Number(amtOut)).toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-03-20</Dt></Dt></Bal>
<Ntry><Amt Ccy="MKD">${amtIn}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-20</Dt></BookgDt><ValDt><Dt>2026-03-20</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Купувач ДООЕЛ</Nm></Dbtr><DbtrAcct><Id><Othr><Id>200000000000089</Id></Othr></Id></DbtrAcct></RltdPties>
<RmtInf><Ustrd>Плаќање по фактура 002/2026</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="MKD">${amtOut}</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-20</Dt></BookgDt><ValDt><Dt>2026-03-20</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Добавувач ДОО</Nm></Cdtr><CdtrAcct><Id><Othr><Id>210000000000074</Id></Othr></Id></CdtrAcct></RltdPties>
<RmtInf><Ustrd>Плаќање фактура 501/2026</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  it('statement of a firm without a bank account: the account opens on konto 1000 and the lines are imported', async () => {
    expect(await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.firmId, firmId))).toHaveLength(0);
    // the credit note left 1 705 − 236 = 1 469 open on the invoice; supplier invoice 501/2026 is 12 010
    const S = parseStatementFile(new TextEncoder().encode(camt('1469.00', '12010.00')), 'izvod.xml');
    expect(S?.length).toBe(1);
    const r = await tx((t) => saveImport(t, { firmId, userId: null, statements: S!, fileName: 'izvod.xml', format: 'camt' }));
    expect(r.statements).toBe(1);
    expect(r.lines).toBe(2);
    const B = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.firmId, firmId));
    expect(B.map((b) => [b.account, b.konto, b.cur])).toEqual([['300000000012355', '1000', 'MKD']]);
  });

  it('auto-match closes the invoice and the purchase', async () => {
    const P = await tx((t) => proposeMatches(t, firmId, 2026));
    expect(P.length).toBe(2);
    await tx((t) => applyMatches(t, { firmId, userId: null, year: 2026, accept: P.map((p) => p.lineId) }));
    const pay = await tx((t) => documentPayments(t, firmId, { invoiceIds: [ids.inv!], purchaseIds: [ids.pur!, ids.pur2!] }));
    expect(pay.get(ids.inv!)).toMatchObject({ total: 1705, remaining: 0 });
    expect(pay.get(ids.pur!)).toMatchObject({ total: 12010, remaining: 0 });
    expect(pay.get(ids.pur2!)).toMatchObject({ remaining: 13570 });
    // the statement journal: D 1000 1 469, C 1000 12 010
    const T = await H.trial(firmId);
    expect(T.by['1000']).toBe(r2(1469 - 12010));
  });

  it('cash voucher: receipt from the customer for a new invoice', async () => {
    await tx((t) => createDefaultRegisters(t, { firmId, userId: null }));
    const R = await tx((t) => loadRegisters(t, firmId));
    const main = R.find((r) => r.cur === 'MKD')!;
    const i3 = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-03-21', partnerId: cust, lines: [{ itemId: svc, name: 'Консултантска услуга', qty: 1, price: 500, rate: 18 }] }, office));
    ids.inv3 = i3.id;
    const v = await tx((t) => saveVoucher(t, { firmId, userId: null, input: { registerId: main.id, kind: 'in', date: '2026-03-21', amt: 590, konto: '1200', partnerId: cust, docNo: i3.number, note: 'Наплата' } as never }));
    const J = (await journal('cash_voucher', v.id))!;
    expect(J.by[main.konto ?? '1020']).toBe(590);
    expect(J.by['1200']).toBe(-590);
    // the customer's card (1200) is settled; like legacy `paidFor`, a voucher closes a document only with a document ref
    const T = await H.trial(firmId);
    const [c1200] = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, '1200'), eq(schema.journalLines.partnerId, cust), eq(schema.journalLines.doc, i3.number)));
    expect(c1200).toBeTruthy();
    expect(T.by['1020']).toBe(r2(590 + 743.4)); // + the POS cash of 7 March
  });

  it('compensation: our invoice to the supplier against its second purchase', async () => {
    const i4 = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-03-22', partnerId: sup, lines: [{ itemId: svc, name: 'Консултантска услуга', qty: 1, price: 1000, rate: 18 }] }, office));
    ids.inv4 = i4.id;
    const O = await tx((t) => kompOpenItems(t, firmId, 2026, [sup]));
    const recv = O.find((o) => o.refId === i4.id), pay = O.find((o) => o.refId === ids.pur2);
    expect(recv && pay).toBeTruthy();
    const k = await tx((t) => saveCompensation(t, { firmId, userId: null, input: { kind: 'bi', date: '2026-03-25', year: 2026, partnerIds: [sup], amounts: { [i4.id]: 1180, [ids.pur2!]: 1180 } } }));
    expect(k.number).toBeTruthy();
    const P = await tx((t) => documentPayments(t, firmId, { invoiceIds: [i4.id], purchaseIds: [ids.pur2!] }));
    expect(P.get(i4.id)?.remaining).toBe(0);
    expect(P.get(ids.pur2!)?.remaining).toBe(13570 - 1180);
  });

  it('ПП30 for the rest of the supplier debt', async () => {
    const S = await tx((t) => orderSuggestions(t, firmId, 2026));
    const s = S.find((x) => x.amount === 12390);
    expect(s, JSON.stringify(S)).toBeTruthy();
    const id = await tx((t) => savePaymentOrder(t, { firmId, userId: null, order: { kind: 'pp30', date: '2026-03-26', payerAcc: '300000000012355', recipAcc: '210000000000074', recip: 'Добавувач ДОО', amount: 12390, purpose: 'Плаќање фактура 502/2026' } }));
    const [o] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, id));
    expect(o).toMatchObject({ kind: 'pp30', amount: '12390.00' });
  });
});

describe('flow 5 — ДДВ-04, close, lock, reopen', () => {
  it('ДДВ-04 of March from the documents', async () => {
    const f = await reload();
    const C = await tx((t) => computeVatPeriod(t, f, '2026-03'));
    // output: invoices 18 % 1 800 + 500 (inv3) + 1 000 (inv4) = 3 300 → 594; POS + Z: (743.40 + 1 652) / 1.18 = 2 030 → 365.40;
    // 5 %: 500 → 25. Input: 18 % 10 000 + 500 + 11 500 = 22 000 → 3 960; 5 % 200 → 10.
    console.log('DDV', JSON.stringify(C.fields));
    expect(C.fields['01']).toBe(Math.round(3300 + 2030));
    expect(C.fields['02']).toBe(Math.round(594 + 365.4));
    const ctx = await loadVatPostingContext(db, f);
    const data = await defaultVatSource.load(db, f, '2026-03-01', '2026-03-31', ctx);
    const inS = vatBookSum(vatBookIn(data.docs, '2026-03-01', '2026-03-31', ctx, { partners: data.partners }), 'in');
    expect([inS.b18, inS.v18, inS.b5, inS.v5]).toEqual([22000, 3960, 200, 10]);
    expect(C.close.diff).toBe(r2(594 + 365.4 + 25 - 3960 - 10));
  });

  it('closing posts the VAT-close journal; a document in the closed month is refused; reopening allows it again', async () => {
    const r = await tx((t) => closeVatPeriod(t, { firmId, period: '2026-03', userId: null }));
    expect(r.row.status).toBe('closed');
    expect(r.journal).not.toBeNull();
    const T = await H.trial(firmId, '2026-03-01', '2026-03-31');
    expect(sumPrefix(T.by, '2300')).toBe(0);
    expect(sumPrefix(T.by, '1300')).toBe(0);
    const late: InvoiceInput = { kind: 'invoice', date: '2026-03-30', partnerId: cust, lines: [{ itemId: svc, name: 'Консултантска услуга', qty: 1, price: 100, rate: 18 }] };
    const e = await err(tx((t) => saveInvoice(t, firmId, late, office)));
    expect(e.message).toMatch(/ДДВ|затворен/);
    await tx((t) => reopenVatPeriod(t, { firmId, period: '2026-03', userId: null }));
    const ok = await tx((t) => saveInvoice(t, firmId, late, office));
    expect(ok.status).toBe('posted');
    const [row] = await db.select().from(schema.vatPeriods).where(and(eq(schema.vatPeriods.firmId, firmId), eq(schema.vatPeriods.period, '2026-03')));
    expect(row!.status).not.toBe('closed');
  });

  it('every step wrote the audit log', async () => {
    const A0 = await db.select({ a: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId));
    expect(A0.length).toBeGreaterThan(10);
  });
});
