import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement } from '@wise/core';
import { saveImport, setLineKonto } from './bank/index';
import { postJournal } from './posting';
import { reclassApply, reclassBatches, reclassLines, reclassUndo } from './reclass';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let sup = '';
let cust = '';

const DDL = sql`create table if not exists journal_overrides (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms(id) on delete cascade,
  source_type text not null, source_id text not null, data jsonb not null default '{"edits":[],"adds":[]}',
  base jsonb not null default '[]', updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
const DDL2 = sql`create unique index if not exists journal_overrides_source_uq on journal_overrides(firm_id, source_type, source_id)`;

const lines = async (journalId: string) => (await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, journalId)).orderBy(asc(schema.journalLines.lineNo)))
  .map((l) => [l.account, l.debit, l.credit, l.partnerId]);
const idsOf = async (journalId: string, account: string) => (await db.select().from(schema.journalLines)
  .where(and(eq(schema.journalLines.journalId, journalId), eq(schema.journalLines.account, account)))).map((l) => l.id);

const manual = (date: string, amt: number, number?: string) => db.transaction((tx) => postJournal(tx, {
  firmId, date, kind: 'manual', userId: null, description: 'Струја ' + date, number,
  lines: [{ account: '4030', debit: amt, note: 'ЕВН' }, { account: '2200', credit: amt, partnerId: sup }],
}));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  await db.execute(DDL);
  await db.execute(DDL2);
  const [f] = await db.insert(schema.firms).values({ name: 'Рекнижење ДООЕЛ' }).returning();
  firmId = f!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'ЕВН', code: '1' }).returning();
  sup = p!.id;
  const [c] = await db.insert(schema.partners).values({ firmId, name: 'Купувач', code: '2' }).returning();
  cust = c!.id;
}, 60_000);

describe('🔁 Рекнижење во маса', () => {
  it('changes the konto of manual nalog lines as one batch, keeps every nalog balanced, and undoes the batch', async () => {
    const j1 = await manual('2026-03-10', 1000, 'R-1');
    const j2 = await manual('2026-04-10', 2500, 'R-2');
    const ids = [...await idsOf(j1.id, '4030'), ...await idsOf(j2.id, '4030')];

    // preview (dry run) changes nothing
    const pre = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { account: '4460' }, dryRun: true }));
    expect(pre.items).toHaveLength(2);
    expect(pre.batchId).toBeNull();
    expect((await lines(j1.id))[0]![0]).toBe('4030');

    const r = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { account: '4460' } }));
    expect(r.items).toHaveLength(2);
    expect(r.blocked).toHaveLength(0);
    expect(r.batchId).toBeTruthy();
    expect(await lines(j1.id)).toEqual([['4460', '1000.00', '0.00', null], ['2200', '0.00', '1000.00', sup]]);
    expect(await lines(j2.id)).toEqual([['4460', '2500.00', '0.00', null], ['2200', '0.00', '2500.00', sup]]);
    // same nalog (id, number), one audit row for the batch
    const [jj] = await db.select().from(schema.journals).where(eq(schema.journals.id, j1.id));
    expect(jj!.number).toBe('R-1');
    const B = await db.transaction((tx) => reclassBatches(tx, firmId));
    expect(B).toHaveLength(1);
    expect(B[0]!.items.map((i) => [i.old.account, i.new.account])).toEqual([['4030', '4460'], ['4030', '4460']]);
    expect(B[0]!.undone).toBeNull();

    const u = await db.transaction((tx) => reclassUndo(tx, { firmId, userId: null, batchId: r.batchId! }));
    expect(u.restored).toHaveLength(2);
    expect(await lines(j1.id)).toEqual([['4030', '1000.00', '0.00', null], ['2200', '0.00', '1000.00', sup]]);
    expect(await lines(j2.id)).toEqual([['4030', '2500.00', '0.00', null], ['2200', '0.00', '2500.00', sup]]);
    expect((await db.transaction((tx) => reclassBatches(tx, firmId)))[0]!.undone?.restored).toBe(2);
    // a batch is undone only once
    await expect(db.transaction((tx) => reclassUndo(tx, { firmId, userId: null, batchId: r.batchId! }))).rejects.toThrow(/веќе вратено/);
  });

  it('changes the partner (and both), refuses a partner konto without partner', async () => {
    const j = await manual('2026-05-05', 300, 'R-3');
    const ids = await idsOf(j.id, '2200');
    const r = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { partnerId: cust } }));
    expect(r.items).toHaveLength(1);
    expect((await lines(j.id))[1]).toEqual(['2200', '0.00', '300.00', cust]);
    // a re-posted nalog gets new line ids: the old ids are reported, the new ones work
    const stale = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { partnerId: null } }));
    expect(stale.blocked[0]!.reason).toMatch(/не постои/);
    const ids2 = await idsOf(j.id, '2200');
    const no = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids2, change: { partnerId: null } }));
    expect(no.items).toHaveLength(0);
    expect(no.blocked[0]!.reason).toMatch(/бара комитент/);
    const both = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids2, change: { account: '2210', partnerId: sup } }));
    expect(both.items).toHaveLength(1);
    expect((await lines(j.id))[1]).toEqual(['2210', '0.00', '300.00', sup]);
  });

  it('never changes a line in a locked period (the others in the batch go through)', async () => {
    const jOld = await manual('2026-01-20', 100, 'R-4');
    const jNew = await manual('2026-06-20', 200, 'R-5');
    const ids = [...await idsOf(jOld.id, '4030'), ...await idsOf(jNew.id, '4030')];
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    const r = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { account: '4460' } }));
    expect(r.items.map((i) => i.number)).toEqual(['R-5']);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]!.reason).toMatch(/Заклучен период/);
    expect((await lines(jOld.id))[0]![0]).toBe('4030');
    expect((await lines(jNew.id))[0]![0]).toBe('4460');
    // the undo also respects the lock: lock after the batch → nothing to restore
    await db.update(schema.firms).set({ lockDate: '2026-06-30' }).where(eq(schema.firms.id, firmId));
    await expect(db.transaction((tx) => reclassUndo(tx, { firmId, userId: null, batchId: r.batchId! }))).rejects.toThrow(/Заклучен период/);
    expect((await lines(jNew.id))[0]![0]).toBe('4460');
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('re-posts a document nalog through its correction; the partner of a document line is refused', async () => {
    const inv = await db.transaction((tx) => postJournal(tx, {
      firmId, date: '2026-07-10', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-rc', userId: null, description: 'Фактура 7',
      lines: [{ account: '1200', debit: 1180, partnerId: cust }, { account: '7600', credit: 1000 }, { account: '2300', credit: 180 }],
    }));
    const ids = await idsOf(inv.id, '7600');
    const r = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: ids, change: { account: '7610' } }));
    expect(r.items[0]!.path).toBe('doc');
    expect((await lines(inv.id))[1]![0]).toBe('7610');
    // the invoice is posted again → the correction stays
    await db.transaction((tx) => postJournal(tx, {
      firmId, date: '2026-07-10', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-rc', userId: null, description: 'Фактура 7',
      lines: [{ account: '1200', debit: 1180, partnerId: cust }, { account: '7600', credit: 1000 }, { account: '2300', credit: 180 }],
    }));
    expect((await lines(inv.id))[1]![0]).toBe('7610');
    const recv = await idsOf(inv.id, '1200');
    const p = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: recv, change: { partnerId: sup } }));
    expect(p.items).toHaveLength(0);
    expect(p.blocked[0]!.reason).toMatch(/во самиот документ/);
    // undo of the document batch
    await db.transaction((tx) => reclassUndo(tx, { firmId, userId: null, batchId: r.batchId! }));
    expect((await lines(inv.id))[1]![0]).toBe('7600');
  });

  it('a statement nalog: the statement line gets the new konto and the statement is re-posted; a linked line is refused', async () => {
    const st: Statement = {
      format: 'halk-xml', account: '210000000000999', no: '9', date: '2026-08-05', currency: 'MKD', opening: null, closing: null, debit: null, credit: null, lines: [
        { date: '2026-08-05', amount: -4_000_00, counterparty: 'ЕВН Македонија', ref: '', purpose: 'струја 07-2026', desc: 'ЕВН – струја' },
        { date: '2026-08-05', amount: -500_00, counterparty: 'Телеком', ref: '', purpose: 'телефон', desc: 'Телеком – телефон' },
      ],
    };
    await db.transaction((tx) => saveImport(tx as never, { firmId, userId: null, statements: [st] }));
    const [s0] = await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, firmId), eq(schema.bankStatements.number, '9')));
    const BL = await db.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, s0!.id)).orderBy(asc(schema.bankLines.lineNo));
    for (const b of BL) await db.transaction((tx) => setLineKonto(tx as never, { firmId, userId: null, lineId: b.id, konto: '4030', learn: false }));
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'bank_statement'), eq(schema.journals.sourceId, s0!.id)));
    const evn = (await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.journalId, j!.id), eq(schema.journalLines.account, '4030'), eq(schema.journalLines.debit, '4000.00'))));
    const r = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: evn.map((l) => l.id), change: { account: '4460' } }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.path).toBe('bank');
    const after = await db.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, s0!.id)).orderBy(asc(schema.bankLines.lineNo));
    expect(after.map((b) => b.konto)).toEqual(['4460', '4030']);
    expect((await lines(j!.id)).some((l) => l[0] === '4460' && l[1] === '4000.00')).toBe(true);
    await db.transaction((tx) => reclassUndo(tx, { firmId, userId: null, batchId: r.batchId! }));
    expect((await db.select().from(schema.bankLines).where(eq(schema.bankLines.id, BL[0]!.id)))[0]!.konto).toBe('4030');

    // a line closed against an invoice is refused (unlink it in Банка first)
    await db.update(schema.bankLines).set({ refType: 'purchase', refId: '00000000-0000-0000-0000-000000000001', refLabel: 'ВФ 12' }).where(eq(schema.bankLines.id, BL[1]!.id));
    const tel = (await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.journalId, j!.id), eq(schema.journalLines.debit, '500.00'))));
    const x = await db.transaction((tx) => reclassApply(tx, { firmId, userId: null, lineIds: tel.map((l) => l.id), change: { account: '4460' } }));
    expect(x.items).toHaveLength(0);
    expect(x.blocked[0]!.reason).toMatch(/раскинете ја врската/);
  });

  it('finds lines by konto range, text and amount', async () => {
    const L = await db.transaction((tx) => reclassLines(tx, firmId, { kontoFrom: '22' }));
    expect(L.every((l) => l.account.startsWith('22'))).toBe(true);
    expect(L.length).toBeGreaterThan(0);
  });
});
