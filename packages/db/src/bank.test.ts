/**
 * Phase 4 DB flows on PGlite: import → match → post → unpost, FX statements, conversions, cash vouchers,
 * payment orders, period locks.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseMT940, type Statement } from '@wise/core';
import {
  addManualLine, applyMatches, cashBook, closeTransit, deleteStatement, deleteVoucher, lineOpenDocs, linkLine, loadRegisters,
  createDefaultRegisters, proposeMatches, saveBankAccount, saveFxList, saveImport, savePaymentOrder, saveVoucher, setLineKonto,
  statementGapsFor, undoImport, updateStatement, planImport, removeBankAccount, transitResidues, numberStatements, deleteLine,
  kompOpenItems, saveCompensation, deleteCompensation, ledgerOpenItemsSource, setOpenItemsSource,
} from './bank/index';
import { postJournal, PostingError } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let mkd = '';
let eur = '';
let alfa = '';
let beta = '';

const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const stLines = (id: string) => db.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, id)).orderBy(asc(schema.bankLines.lineNo));
const journalOf = async (sourceType: string, sourceId: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(asc(schema.journalLines.lineNo));
  return { ...j, lines: L.map((l) => [l.account, l.debit, l.credit, l.partnerId ? 'P' : '', l.currency ?? '', l.amountCur ?? '']) };
};

const MT1 = [
  ':20:STMT1', ':25:300000000123420', ':28C:00012', ':60F:C260105MKD100000,00',
  ':61:2601050105C11800,00NTRFNONREF//123', ':86:?32Алфа ДОО?20Плаќање фактура 15/2026',
  ':61:2601050105D150,00NCHGNONREF', ':86:?32Банка?20Провизија за платен промет',
  ':61:2601050105D6000,00NTRFNONREF', ':86:?32Бета ДООЕЛ?20Плаќање по фактура 77',
  ':62F:C260105MKD105650,00',
].join('\n');

beforeAll(async () => {
  // These flows use ledger stand-ins for documents; the document source is tested in bank-documents.test.ts.
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Тест ДООЕЛ' }).returning();
  firmId = f!.id;
  alfa = (await db.insert(schema.partners).values({ firmId, name: 'Алфа ДОО', code: '1' }).returning())[0]!.id;
  beta = (await db.insert(schema.partners).values({ firmId, name: 'Бета ДООЕЛ', code: '2', bankAccount: '300000000123420' }).returning())[0]!.id;
  // Phase 3 stand-ins: an issued invoice and a supplier invoice booked in the ledger with document numbers.
  await T((tx) => postJournal(tx, { firmId, date: '2026-01-02', kind: 'izlez', userId: null, sourceType: 'test', sourceId: 'inv15',
    lines: [{ account: '1200', debit: 11800, partnerId: alfa, doc: '15/2026' }, { account: '7400', credit: 11800 }] }));
  await T((tx) => postJournal(tx, { firmId, date: '2026-01-03', kind: 'vlez', userId: null, sourceType: 'test', sourceId: 'pur77',
    lines: [{ account: '4000', debit: 5000 }, { account: '2200', credit: 5000, partnerId: beta, doc: '77' }] }));
}, 60_000);

describe('bank accounts', () => {
  it('saves accounts and mirrors them into firms.settings.banks for nalog numbering', async () => {
    mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Комерцијална', account: '300000000123420', cur: 'MKD', konto: '1000' } }));
    eur = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Комерцијална EUR', account: 'MK07300000000999999', cur: 'EUR', konto: '1030' } }));
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    expect((f!.settings as { banks: unknown[] }).banks).toEqual([{ id: mkd, name: 'Комерцијална', cur: 'MKD' }, { id: eur, name: 'Комерцијална EUR', cur: 'EUR' }]);
  });
});

describe('statement import → match → post', () => {
  let stId = '';
  it('previews: account found by number, per-day statement with the file number, nothing duplicated', async () => {
    const plan = await T((tx) => planImport(tx, { firmId, userId: null, statements: parseMT940(MT1) }));
    expect(plan.errors).toEqual([]);
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0]).toMatchObject({ accountId: mkd, date: '2026-01-05', no: '12', opening: 10000000, closing: 10565000, allDup: false });
    expect(plan.days[0]!.lines.map((l) => [l.amount, l.dup])).toEqual([[1180000, false], [-15000, false], [-600000, false]]);
  });

  it('saves a draft statement (unbooked lines, no journal)', async () => {
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: parseMT940(MT1), fileName: 'a.sta', format: 'mt940' }));
    expect(r).toMatchObject({ statements: 1, lines: 3, skipped: 0, posted: 0, drafts: 1 });
    const [st] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, firmId));
    stId = st!.id;
    expect(st).toMatchObject({ number: '12', status: 'draft', opening: '100000.00', closing: '105650.00' });
    expect(await journalOf('bank_statement', stId)).toBeNull();
  });

  it('detects the same file imported again', async () => {
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: parseMT940(MT1) }));
    expect(r).toMatchObject({ statements: 0, lines: 0, skipped: 3 });
    expect(r.plan.warnings.some((w) => w.includes('веќе е увезен'))).toBe(true);
  });

  it('proposes matches from ledger open items (invoice number, fee, supplier invoice) and posts on accept', async () => {
    const P = await T((tx) => proposeMatches(tx, firmId, 2026, { fx: false }));
    const by = Object.fromEntries(P.map((p) => [p.amount, p]));
    expect(by['11800']).toMatchObject({ how: 'num', konto: '1200', partnerId: alfa, refLabel: '15/2026' });
    expect(by['-150']).toMatchObject({ how: 'fee', konto: '4460' });
    expect(by['-6000']).toMatchObject({ how: 'num', konto: '2200', partnerId: beta, refLabel: '77', excess: 1000 });
    const r = await T((tx) => applyMatches(tx, { firmId, userId: null, year: 2026, accept: P.map((p) => p.lineId) }));
    expect(r).toMatchObject({ applied: 3, posted: 1, drafts: 0 });
    const j = await journalOf('bank_statement', stId);
    expect(j!.kind).toBe('bank');
    expect(j!.number).toBe('6/1-3');
    expect(j!.lines).toEqual([
      ['1000', '11800.00', '0.00', '', '', ''], ['1200', '0.00', '11800.00', 'P', '', ''],
      ['4460', '150.00', '0.00', '', '', ''], ['1000', '0.00', '150.00', '', '', ''],
      ['2200', '6000.00', '0.00', 'P', '', ''], ['1000', '0.00', '6000.00', '', '', ''],
    ]);
    const L = await stLines(stId);
    expect(L[2]!.refs).toEqual([{ type: 'purchase', id: expect.stringMatching(/^L\|2200\|/), label: '77', amt: 5000 }]);
  });

  it('the invoice is now closed for further matching; re-linking manually is capped', async () => {
    const L = await stLines(stId);
    const D = await T((tx) => lineOpenDocs(tx, firmId, 2026, L[0]!.id));
    expect(D.docs.map((d) => [d.doc.number, d.open])).toEqual([['15/2026', 1180000]]); // own link not counted while re-linking
    const r = await T((tx) => linkLine(tx, { firmId, userId: null, year: 2026, lineId: L[0]!.id, docIds: D.fifo }));
    expect(r.excess).toBe(0);
  });

  it('booking on a konto learns a rule; a second statement is proposed by that rule', async () => {
    const id = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-01-06', amount: -2500, desc: 'ЕВН Македонија, сметка за струја' }));
    await T((tx) => setLineKonto(tx, { firmId, userId: null, lineId: id, konto: '4020' }));
    const R = await db.select().from(schema.bankRules).where(eq(schema.bankRules.firmId, firmId));
    expect(R.map((r) => [r.kind, r.match, r.konto, r.learned])).toEqual([['desc', 'евн македонија', '4020', true]]);
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-01-07', amount: -1800, desc: 'ЕВН Македонија – декември' }));
    const P = await T((tx) => proposeMatches(tx, firmId, 2026));
    expect(P.map((p) => [p.how, p.konto])).toEqual([['rule', '4020']]);
    const [st] = await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, firmId), eq(schema.bankStatements.date, '2026-01-06')));
    expect(st).toMatchObject({ number: '13', status: 'posted', format: 'manual' });
  });

  it('respects the period lock', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    const L = await stLines(stId);
    const e = await err(T((tx) => setLineKonto(tx, { firmId, userId: null, lineId: L[1]!.id, konto: '4400' })));
    expect((e as PostingError).code).toBe('locked');
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('statement gaps and numbering', async () => {
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: stId, closing: 105650 }));
    const [s2] = await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, firmId), eq(schema.bankStatements.date, '2026-01-06')));
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: s2!.id, opening: 105000, closing: 102500 }));
    const G = await T((tx) => statementGapsFor(tx, firmId, 2026));
    expect(G).toEqual([expect.objectContaining({ accountId: mkd, diff: -650 })]);
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: s2!.id, number: null }));
    expect(await T((tx) => numberStatements(tx, { firmId, userId: null, year: 2026 }))).toBe(1);
  });

  it('deleting a statement removes its journal; undo import removes a batch', async () => {
    const [s3] = await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, firmId), eq(schema.bankStatements.date, '2026-01-07')));
    await T((tx) => deleteStatement(tx, { firmId, userId: null, statementId: s3!.id }));
    expect(await journalOf('bank_statement', s3!.id)).toBeNull();
    const st: Statement = { format: 'table', account: '', no: '', date: '2026-01-08', currency: '', opening: null, closing: null, debit: null, credit: null,
      lines: [{ date: '2026-01-08', amount: 500, counterparty: '', ref: '', purpose: '', desc: 'Камата' }] };
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st], defaultAccountId: mkd }));
    expect(r.lines).toBe(1);
    expect(await T((tx) => undoImport(tx, { firmId, userId: null, batch: r.batch }))).toBe(1);
    expect(await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.date, '2026-01-08'))).toEqual([]);
    expect((await err(T((tx) => removeBankAccount(tx, { firmId, userId: null, id: mkd })))).message).toMatch(/изводи/);
  });
});

describe('FX statements, conversions, transit', () => {
  it('uses the office rate list (no hard-coded 61.5), posts FX differences and keeps currency amounts', async () => {
    await T((tx) => saveFxList(tx, { userId: null, date: '2026-02-01', rows: [{ cur: 'EUR', rate: 61.6 }] }));
    // supplier invoice in EUR booked at 61.5 (via the ledger stand-in)
    await T((tx) => postJournal(tx, { firmId, date: '2026-02-02', kind: 'vlezDev', userId: null, sourceType: 'test', sourceId: 'pur-eur',
      lines: [{ account: '4000', debit: 6150 }, { account: '2210', credit: 6150, partnerId: beta, doc: 'INV-9' }] }));
    const st: Statement = { format: 'camt.053', account: '', iban: 'MK07300000000999999', no: '3', date: '2026-02-05', currency: 'EUR', opening: 1000000, closing: 990000, debit: null, credit: null,
      lines: [{ date: '2026-02-05', amount: -10000, counterparty: 'Бета ДООЕЛ', ref: 'E2E', purpose: 'Invoice INV-9', desc: 'Бета ДООЕЛ – Invoice INV-9' }] };
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st] }));
    expect(r.plan.days[0]).toMatchObject({ accountId: eur, rate: 61.6 });
    const [s] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.bankAccountId, eur));
    const [l] = await stLines(s!.id);
    expect(l).toMatchObject({ amount: '-6160.00', amountCur: '-100.00', cur: 'EUR' });
    const D = await T((tx) => lineOpenDocs(tx, firmId, 2026, l!.id));
    await T((tx) => linkLine(tx, { firmId, userId: null, year: 2026, lineId: l!.id, docIds: D.fifo }));
    // the payment settles 6150; 10 denars is an FX loss on 4810
    const L1 = await stLines(s!.id);
    expect(L1[0]).toMatchObject({ konto: '2210', refLabel: 'INV-9' });
    const j = await journalOf('bank_statement', s!.id);
    expect(j!.number).toBe('7/1-3');
    // rate correction recomputes the denar amount and the FX difference
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: s!.id, rate: 61.7 }));
    const j2 = await journalOf('bank_statement', s!.id);
    expect(j2!.lines).toEqual([['2210', '6150.00', '0.00', 'P', '', ''], ['1030', '0.00', '6170.00', '', 'EUR', '100.00'], ['4810', '20.00', '0.00', '', '', '']].map((x) => x));
  });

  it('currency purchase: MKD side to the FX bank konto, FX side neutral; transit residue closes to 4810/7810', async () => {
    const mkSt: Statement = { format: 'table', account: '300000000123420', no: '', date: '2026-02-10', currency: 'MKD', opening: null, closing: null, debit: null, credit: null,
      lines: [{ date: '2026-02-10', amount: -615000, counterparty: '', ref: '', purpose: '', desc: 'Откуп на девизи EUR' }] };
    const fxSt: Statement = { format: 'table', account: 'MK07300000000999999', no: '', date: '2026-02-10', currency: 'EUR', opening: null, closing: null, debit: null, credit: null,
      lines: [{ date: '2026-02-10', amount: 10000, counterparty: 'Тест ДООЕЛ', ref: '', purpose: '', desc: 'Тест ДООЕЛ пренос' }] };
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [mkSt] }));
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [fxSt] }));
    const L = await db.select().from(schema.bankLines).where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.date, '2026-02-10')));
    const m = L.find((x) => x.bankAccountId === mkd)!;
    const f = L.find((x) => x.bankAccountId === eur)!;
    expect(m).toMatchObject({ konto: '1030', conv: true });
    expect(f).toMatchObject({ konto: '1030', conv: true, own: true }); // paired by pairConversions
    const jm = await journalOf('bank_statement', m.statementId);
    expect(jm!.lines).toEqual([['1030', '6150.00', '0.00', '', '', ''], ['1000', '0.00', '6150.00', '', '', '']]);
    const [sf] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.id, f.statementId));
    expect(sf!.status).toBe('posted'); // FX side books nothing
    expect(await journalOf('bank_statement', f.statementId)).toBeNull();
    // own transfer through the FX transit konto with a small residue
    await T((tx) => postJournal(tx, { firmId, date: '2026-02-11', kind: 'manual', userId: null, lines: [{ account: '1039', debit: 6150 }, { account: '1000', credit: 6150 }] }));
    await T((tx) => postJournal(tx, { firmId, date: '2026-02-11', kind: 'manual', userId: null, lines: [{ account: '1030', debit: 6140 }, { account: '1039', credit: 6140 }] }));
    expect(await T((tx) => transitResidues(tx, firmId, 2026))).toEqual([{ konto: '1039', date: '2026-02-11', residue: 10 }]);
    await T((tx) => closeTransit(tx, { firmId, userId: null, konto: '1039', date: '2026-02-11' }));
    expect(await T((tx) => transitResidues(tx, firmId, 2026))).toEqual([]);
  });
});

describe('cash register', () => {
  it('creates default registers, posts vouchers (VAT, FX at the rate list), cash book, delete unposts', async () => {
    expect(await T((tx) => createDefaultRegisters(tx, { firmId, userId: null }))).toBe(3);
    const R = await T((tx) => loadRegisters(tx, firmId));
    const main = R.find((r) => r.konto === '1020')!;
    const eurR = R.find((r) => r.konto === '1051')!;
    await db.update(schema.firms).set({ vatRegistered: true }).where(eq(schema.firms.id, firmId));
    const inV = await T((tx) => saveVoucher(tx, { firmId, userId: null, input: { registerId: main.id, kind: 'in', date: '2026-03-01', amt: 20000, konto: '1000', note: 'Подигање од банка' } }));
    expect(inV).toMatchObject({ number: 'У-001', nalog: '1020/1-3' });
    const out = await T((tx) => saveVoucher(tx, { firmId, userId: null, input: { registerId: main.id, kind: 'out', date: '2026-03-02', amt: 3540, vatRate: 10, cat: 'fuel', merchant: 'Макпетрол', docNo: 'Ф-1' } }));
    expect(out.number).toBe('И-001');
    const jo = await journalOf('cash_voucher', out.id);
    expect(jo!.lines.map((l) => l.slice(0, 3))).toEqual([['4033', '3218.18', '0.00'], ['130010', '321.82', '0.00'], ['1020', '0.00', '3540.00']]);
    // FIX #14: cent precision for a foreign receipt; rate from the office list (61.6), not 61.5
    const fx = await T((tx) => saveVoucher(tx, { firmId, userId: null, input: { registerId: eurR.id, kind: 'out', date: '2026-03-03', cur: 'EUR', country: 'AT', amt: 15.05, cat: 'transport', merchant: 'Taxi' } }));
    const jf = await journalOf('cash_voucher', fx.id);
    expect(jf!.number).toBe('1051/1-3');
    expect(jf!.lines).toEqual([['44021', '927.08', '0.00', '', 'EUR', '15.05'], ['1051', '0.00', '927.08', '', 'EUR', '15.05']]);
    const dup = await T((tx) => saveVoucher(tx, { firmId, userId: null, input: { registerId: main.id, kind: 'out', date: '2026-03-02', amt: 3540, vatRate: 10, cat: 'fuel', docNo: 'Ф-1' } }));
    expect(dup.duplicate).toBe('И-001');
    const B = await T((tx) => cashBook(tx, firmId, main, '2026-03-01', '2026-03-31'));
    expect(B.rows.map((r) => [r.voucher?.number, r.debit, r.credit, r.balance])).toEqual([['У-001', 20000, 0, 20000], ['И-001', 0, 3540, 16460], ['И-002', 0, 3540, 12920]]);
    const BE = await T((tx) => cashBook(tx, firmId, eurR, '2026-03-01', '2026-03-31'));
    expect(BE.closingCur).toBe(-15.05);
    await T((tx) => deleteVoucher(tx, { firmId, userId: null, id: dup.id }));
    expect(await journalOf('cash_voucher', dup.id)).toBeNull();
  });
});

describe('payment orders', () => {
  it('rejects wrong control digits, saves a valid order', async () => {
    const base = { kind: 'pp30' as const, date: '2026-10-08', payerAcc: '300000000123420', recipAcc: '300000000123421', amount: 100 };
    expect((await err(T((tx) => savePaymentOrder(tx, { firmId, userId: null, order: base })))).message).toMatch(/примачот/);
    const id = await T((tx) => savePaymentOrder(tx, { firmId, userId: null, order: { ...base, recipAcc: '300000000123420', recip: 'Бета ДООЕЛ\nСкопје' } }));
    const [o] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, id));
    expect(o).toMatchObject({ kind: 'pp30', amount: '100.00', recipient: 'Бета ДООЕЛ' });
  });

  it('audits every mutation', async () => {
    const A = await db.select({ a: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId));
    const S = new Set(A.map((x) => x.a));
    for (const a of ['addBankAcct', 'importBank', 'autoMatch', 'bkPickSave', 'bankKonto', 'mbSave', 'delStatement', 'undoImp', 'postStatement', 'blgNew', 'blgDel', 'ppSave', 'izvSave', 'numIzv', 'trClose'])
      expect(S.has(a), a).toBe(true);
    void deleteLine;
  });
});

describe('compensations', () => {
  it('sets off receivables against payables from the ledger, posts kind komp, closes the items, unposts on delete', async () => {
    const g = (await db.insert(schema.partners).values({ firmId, name: 'Гама ДОО', code: '9' }).returning())[0]!.id;
    await T((tx) => postJournal(tx, { firmId, date: '2026-04-01', kind: 'izlez', userId: null, sourceType: 'test', sourceId: 'g-inv',
      lines: [{ account: '1200', debit: 1000, partnerId: g, doc: 'G-1' }, { account: '7400', credit: 1000 }] }));
    await T((tx) => postJournal(tx, { firmId, date: '2026-04-02', kind: 'vlez', userId: null, sourceType: 'test', sourceId: 'g-pur',
      lines: [{ account: '4000', debit: 600 }, { account: '2200', credit: 600, partnerId: g, doc: 'S-5' }] }));
    const O = await T((tx) => kompOpenItems(tx, firmId, 2026, [g]));
    expect(O.map((o) => [o.side, o.docNo, o.open])).toEqual([['rec', 'G-1', 100000], ['pay', 'S-5', 60000]]);
    const amounts = { [O[0]!.refId]: 600, [O[1]!.refId]: 600 };
    expect((await err(T((tx) => saveCompensation(tx, { firmId, userId: null, input: { kind: 'bi', date: '2026-04-10', year: 2026, partnerIds: [g], amounts: { ...amounts, [O[0]!.refId]: 500 } } })))).message).toMatch(/еднакви/);
    const r = await T((tx) => saveCompensation(tx, { firmId, userId: null, input: { kind: 'bi', date: '2026-04-10', year: 2026, partnerIds: [g], amounts } }));
    expect(r).toMatchObject({ number: 'К-001/2026', nalog: '16/4-6' });
    const O2 = await T((tx) => kompOpenItems(tx, firmId, 2026, [g]));
    expect(O2.map((o) => [o.docNo, o.open])).toEqual([['G-1', 40000]]);
    // editing sees its own amounts as open again
    expect((await T((tx) => kompOpenItems(tx, firmId, 2026, [g], r.id))).length).toBe(2);
    await T((tx) => deleteCompensation(tx, { firmId, userId: null, id: r.id }));
    expect(await journalOf('compensation', r.id)).toBeNull();
  });
});
