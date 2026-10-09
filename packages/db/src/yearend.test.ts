import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { crmXml, deVals, f35Rows, lineTotals, trialBalance } from '@wise/core';
import { loadLedgerLines } from './ledger-queries';
import { postJournal, PostingError, unpostSource, type PostJournalInput } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import {
  afterImportedTbDeleted, clearCrmXml, closeYear, depreciationFor, getStatement, importCrmXml, importPostCloseTb, loadYear, lockYear,
  openNextYear, registerYearEndInputs, runDepreciation, undoClose, undoOpen, unlockYear, upsertStatement, yearEndFindingInputs, yearFindings, YE_SOURCE,
} from './yearend';

const db = drizzle(new PGlite(), { schema });
const TODAY = '2027-02-15';
let firmId = '';
let cust = '';

const P = (date: string, kind: string, lines: PostJournalInput['lines'], extra: Partial<PostJournalInput> = {}) =>
  db.transaction((tx) => postJournal(tx, { firmId, date, kind, userId: null, lines, ...extra }));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as PostingError; } throw new Error('expected an error'); };
const act = { userId: null, today: TODAY };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Година ДООЕЛ', legalForm: 'dooel', embs: '7000001', activity: '62.01' }).returning();
  firmId = f!.id;
  const [c] = await db.insert(schema.partners).values({ firmId, name: 'Купувач' }).returning();
  cust = c!.id;
  await P('2026-01-01', 'open', [{ account: '1000', debit: 50_000 }, { account: '9000', credit: 50_000 }], { sourceType: 'opening', sourceId: 'open-2026' });
  await P('2026-03-10', 'izlez', [{ account: '1200', debit: 118_000, partnerId: cust }, { account: '7400', credit: 100_000 }, { account: '230018', credit: 18_000 }]);
  await P('2026-05-02', 'manual', [{ account: '4400', debit: 60_000 }, { account: '1000', credit: 60_000 }]);
}, 60_000);

describe('fixed assets and depreciation', () => {
  it('runs depreciation per asset group (fix D1), re-posts in place and keeps the run row', async () => {
    await db.insert(schema.fixedAssets).values([
      { firmId, invNo: '0001', name: 'Компјутер', konto: '0134', rate: '25', date: '2026-01-15', cost: '48000' },
      { firmId, invNo: '0002', name: 'Возило (флота)', konto: '0136', rate: '20', date: '2025-01-01', cost: '600000', vehicleOnly: true },
    ]);
    const d = await db.transaction((tx) => depreciationFor(tx, firmId, 2026));
    expect(d.total).toBe(11_000); // 48 000 × 25 % × 11/12
    const r = await db.transaction((tx) => runDepreciation(tx, { firmId, year: 2026, userId: null }));
    expect(r.lines).toEqual([{ account: '4302', debit: 11_000, credit: 0 }, { account: '0193', debit: 0, credit: 11_000 }]);
    const again = await db.transaction((tx) => runDepreciation(tx, { firmId, year: 2026, userId: null }));
    expect(again.journal.id).toBe(r.journal.id);
    const runs = await db.select().from(schema.depreciationRuns).where(eq(schema.depreciationRuns.firmId, firmId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.rows.map((x) => x.year)).toEqual([11_000]);
  });
});

describe('phase gate, close, open, lock', () => {
  it('the gate blocks the close while a finding is open; acknowledging it clears the gate', async () => {
    // a customer paid more than was invoiced → blocking finding
    await P('2026-06-01', 'manual', [{ account: '1000', debit: 200_000 }, { account: '1200', credit: 200_000, partnerId: cust }], { sourceType: 'test', sourceId: 'overpay' });
    const L = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    const F = await db.transaction((tx) => yearFindings(tx, L, TODAY));
    expect(F.open.map((x) => x.key)).toEqual([`p12|${cust}`]);
    expect((await err(db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act })))).message).toMatch(/неразрешени наоди/);
    await db.transaction((tx) => upsertStatement(tx, firmId, 2026, { ack: { [`p12|${cust}`]: { note: 'аванс', by: 'test' } } }, null));
    const L2 = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    expect((await db.transaction((tx) => yearFindings(tx, L2, TODAY))).open).toEqual([]);
    await db.transaction((tx) => upsertStatement(tx, firmId, 2026, { ack: {} }, null));
    await db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'test', sourceId: 'overpay', userId: null }));
  });

  it('closes with the ДБ tax, statements before and after the close agree', async () => {
    const before = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    expect(before.ent).toBe('co');
    expect(before.Y.co.db.tax).toBe(2_900); // (100 000 − 60 000 − 11 000) × 10 %
    const r = await db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act }));
    expect([r.plan.profit, r.plan.tax, r.plan.net, r.plan.taxSource]).toEqual([29_000, 2_900, 26_100, 'db']);
    expect(r.journal.number).toBe('999');
    const after = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    expect(after.Y.closed).toBe(true);
    expect(after.Y.co.zs.V.bu252).toBe(2_900);
    expect(after.Y.co.zs.V.bs077).toBe(before.Y.co.zs.V.bs077);
    expect(after.closing).toMatchObject({ status: 'closed', tax: '2900.00', entity: 'co', imported: false });
    expect((after.closing!.db as { taxSource: string }).taxSource).toBe('db');
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'closeYear')));
    expect(audit).toHaveLength(1);
  });

  it('re-computing the close replaces the journal; ДБ non-deductibles change the tax', async () => {
    await db.transaction((tx) => upsertStatement(tx, firmId, 2026, { dbAdj: { '03': 1_000 } }, null));
    const r = await db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act }));
    expect(r.plan.tax).toBe(3_000);
    expect(r.journal.replaced).toBe(true);
  });

  it('opens 2027 (951 → 950, customer per partner); undo close is refused while the opening exists', async () => {
    const o = await db.transaction((tx) => openNextYear(tx, { firmId, year: 2026, ...act }));
    expect(o.journal.number).toBe('0');
    const L = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    const tb = trialBalance(L, { level: 'a', from: '2027-01-01', to: '2027-12-31' });
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((x) => x.k === '950')!.s).toBe(-26_000);
    expect(L.find((l) => l.account === '1200')!.partnerId).toBe(cust);
    expect((await err(db.transaction((tx) => undoClose(tx, { firmId, year: 2026, userId: null })))).message).toMatch(/прво поништете/);
    expect((await err(db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act })))).message).toMatch(/пренесена/);
  });

  it('locks the year with an audit row; the close cannot be undone in a locked year; admin unlock', async () => {
    await db.transaction((tx) => lockYear(tx, { firmId, year: 2026, ...act }));
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    expect(f!.lockDate).toBe('2026-12-31');
    const a = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'lockYear')));
    expect(a).toHaveLength(1);
    await db.transaction((tx) => undoOpen(tx, { firmId, year: 2026, userId: null }));
    expect((await err(db.transaction((tx) => undoClose(tx, { firmId, year: 2026, userId: null })))).code).toBe('locked');
    await db.transaction((tx) => unlockYear(tx, { firmId, year: 2026, userId: null }));
    await db.transaction((tx) => undoClose(tx, { firmId, year: 2026, userId: null }));
    const L = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    expect(L.closeJournal).toBeNull();
    expect(L.closing!.status).toBe('open');
    expect((await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'undoClose'))))).toHaveLength(1);
  });

  it('payroll totals come from the registered payroll module', async () => {
    registerYearEndInputs({ payroll: { runs: async () => [{ month: '2026-01', employees: 2, tax: 1_000, contrib: 3_000 }], activeEmployees: async () => 2 } });
    const L = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    expect(L.Y.co.zs.V.bu257).toBe(2);
    registerYearEndInputs({ payroll: undefined });
  });
});

describe('findings gate inputs from the module tables', () => {
  it('reads pending client documents, invoices without partner and negative stock', async () => {
    const [g] = await db.insert(schema.firms).values({ name: 'Гејт ДОО' }).returning();
    const id = g!.id;
    const [it] = await db.insert(schema.items).values({ firmId: id, name: 'Стока', code: '1', type: 'goods', vatRate: 18 }).returning();
    await db.insert(schema.stockMoves).values({ firmId: id, itemId: it!.id, date: '2026-06-01', qty: '-3', value: '0', kind: 'sale', direction: 'out', sourceType: 'test', sourceId: 'x' });
    await db.insert(schema.clientEntries).values({ firmId: id, kind: 'purchase', data: { date: '2026-11-03', total: 100 } });
    const X = await db.transaction((tx) => yearEndFindingInputs(tx, id, 2026));
    expect(X.pendingDocs).toEqual([{ date: '2026-11-03', pend: true }]);
    expect(X.moves).toMatchObject([{ item: it!.id, qty: -3, wh: 'main' }]);
    expect(X.items![it!.id]).toMatchObject({ name: 'Стока', type: 'goods' });
    const L = await db.transaction((tx) => loadYear(tx, id, 2026));
    const F = await db.transaction((tx) => yearFindings(tx, L, TODAY));
    expect(F.all.length).toBeGreaterThan(0);
    expect(JSON.stringify(F.all)).toMatch(/Стока|одобрување|чека/);
  });
});

describe('trial balance imported after the close (obRebuild)', () => {
  it('saves bbimp + an imported close; deleting the bbimp removes the close', async () => {
    const [g] = await db.insert(schema.firms).values({ name: 'Увоз ДОО' }).returning();
    const id = g!.id;
    const rows = [
      { account: '1000', debit: 90_000, credit: 0, turnoverDebit: 150_000, turnoverCredit: 60_000 },
      { account: '7400', debit: 0, credit: 0, turnoverDebit: 100_000, turnoverCredit: 100_000 },
      { account: '4400', debit: 0, credit: 0, turnoverDebit: 60_000, turnoverCredit: 60_000 },
      { account: '8100', debit: 0, credit: 0, turnoverDebit: 4_000, turnoverCredit: 4_000 },
      { account: '2330', debit: 0, credit: 4_000, turnoverDebit: 0, turnoverCredit: 4_000 },
      { account: '9000', debit: 0, credit: 50_000, turnoverDebit: 0, turnoverCredit: 50_000 },
      { account: '951', debit: 0, credit: 36_000, turnoverDebit: 0, turnoverCredit: 36_000 },
    ];
    const r = await db.transaction((tx) => importPostCloseTb(tx, { firmId: id, year: 2025, userId: null, rows }));
    expect(r).toMatchObject({ profit: 40_000, tax: 4_000, net: 36_000 });
    const L = await db.transaction((tx) => loadYear(tx, id, 2025));
    expect(L.closing).toMatchObject({ imported: true, status: 'closed' });
    expect(L.Y.co.zs.V.bu202).toBe(100_000);
    expect(L.Y.co.zs.V.bu252).toBe(4_000);
    expect(L.Y.co.zs.V.bs063).toBe(L.Y.co.zs.V.bs111);
    expect((await err(db.transaction((tx) => closeYear(tx, { firmId: id, year: 2025, ...act })))).message).toMatch(/увезен бруто биланс/);
    await db.transaction(async (tx) => {
      await unpostSource(tx, { firmId: id, sourceType: YE_SOURCE.bbimp.type, sourceId: YE_SOURCE.bbimp.id(2025), userId: null });
      expect(await afterImportedTbDeleted(tx, { firmId: id, year: 2025, userId: null })).toBe(true);
    });
    expect((await db.transaction((tx) => loadYear(tx, id, 2025))).closeJournal).toBeNull();
  });
});

describe('ЦРСМ XML export → import → undo', () => {
  it('round-trips the AOPs into manual amounts and restores hand-typed ones (fix C1)', async () => {
    const L = await db.transaction((tx) => loadYear(tx, firmId, 2026));
    const xml = crmXml({ year: 2026, current: L.Y.co.zs, rules: L.rules, de38: deVals(null, {}), f35: f35Rows(L.Y.co.balances.pre, { nkd: '62.01' }), embs: '7000001' });
    expect(xml).toContain('<Form ID="36"');
    await db.transaction((tx) => upsertStatement(tx, firmId, 2026, { zsMan: { bs001: 5 } }, null));
    const r = await db.transaction((tx) => importCrmXml(tx, { firmId, userId: null, xml, year: 2026 }));
    expect(r.year).toBe(2026);
    const st = await db.transaction((tx) => getStatement(tx, firmId, 2026));
    expect(st!.status).toBe('accepted');
    expect(st!.zsMan.bu202).toBe(100_000);
    expect(lineTotals([{ debit: st!.zsMan.bs063 ?? 0, credit: st!.zsMan.bs111 ?? 0 }]).balanced).toBe(true);
    await db.transaction((tx) => clearCrmXml(tx, { firmId, userId: null, year: 2026 }));
    expect((await db.transaction((tx) => getStatement(tx, firmId, 2026)))!.zsMan).toEqual({ bs001: 5 });
  });
});
