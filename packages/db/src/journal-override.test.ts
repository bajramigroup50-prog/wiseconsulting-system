import { PGlite } from '@electric-sql/pglite';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { journalOverrideState, resetJournalOverride, saveJournalOverride } from './journal-override-save';
import { postJournal, type PostJournalInput } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let p1 = '';

/** Until the coordinator's migration exists, the test creates the table like the schema file does. */
const DDL = sql`create table if not exists journal_overrides (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms(id) on delete cascade,
  source_type text not null, source_id text not null, data jsonb not null default '{"edits":[],"adds":[]}',
  base jsonb not null default '[]', updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
const DDL2 = sql`create unique index if not exists journal_overrides_source_uq on journal_overrides(firm_id, source_type, source_id)`;

const inv = (amount: number): PostJournalInput => ({
  firmId, date: '2026-03-10', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-1', userId: null, description: 'Фактура 1',
  lines: [{ account: '1200', debit: amount * 1.18, partnerId: p1 }, { account: '7600', credit: amount }, { account: '2300', credit: amount * 0.18 }],
});
const lines = async (journalId: string) => (await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, journalId)).orderBy(asc(schema.journalLines.lineNo)))
  .map((l) => [l.account, l.debit, l.credit]);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  await db.execute(DDL);
  await db.execute(DDL2);
  const [f] = await db.insert(schema.firms).values({ name: 'Корекции ДООЕЛ' }).returning();
  firmId = f!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Купувач', code: '1' }).returning();
  p1 = p!.id;
}, 60_000);

describe('document journal corrections (legacy ed / edAdd)', () => {
  it('corrects a document journal, survives re-posting, drops on document change, resets', async () => {
    const j = await db.transaction((tx) => postJournal(tx, inv(1000)));
    const st = await db.transaction((tx) => journalOverrideState(tx, firmId, j.id));
    expect(st.rows).toHaveLength(3);
    const rows = st.rows!.map((r) => (r.account === '7600' ? { ...r, account: '7610' } : r));
    await db.transaction((tx) => saveJournalOverride(tx, { firmId, journalId: j.id, rows, userId: null }));
    expect(await lines(j.id)).toEqual([['1200', '1180.00', '0.00'], ['7610', '0.00', '1000.00'], ['2300', '0.00', '180.00']]);
    const [jj] = await db.select().from(schema.journals).where(eq(schema.journals.id, j.id));
    expect((jj!.meta as { override?: { applied: number } }).override?.applied).toBe(1);
    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, j.id));
    expect(a.map((x) => x.action)).toContain('nalOverride');

    // the document is re-posted unchanged → the correction stays
    await db.transaction((tx) => postJournal(tx, inv(1000)));
    expect((await lines(j.id))[1]).toEqual(['7610', '0.00', '1000.00']);

    // the document line changed → the correction of that line is dropped
    await db.transaction((tx) => postJournal(tx, inv(2000)));
    expect((await lines(j.id))[1]).toEqual(['7600', '0.00', '2000.00']);

    // correct again, then reset to the document
    const st2 = await db.transaction((tx) => journalOverrideState(tx, firmId, j.id));
    await db.transaction((tx) => saveJournalOverride(tx, { firmId, journalId: j.id, rows: [...st2.rows!, { i: null, account: '4460', debit: 10, credit: 0, partnerId: null, note: '', doc: '', del: false }, { i: null, account: '1000', debit: 0, credit: 10, partnerId: null, note: '', doc: '', del: false }], userId: null }));
    expect(await lines(j.id)).toHaveLength(5);
    await db.transaction((tx) => resetJournalOverride(tx, { firmId, journalId: j.id, userId: null }));
    expect(await lines(j.id)).toHaveLength(3);
    expect(await db.select().from(schema.journalOverrides)).toHaveLength(0);
  });

  it('rejects an unbalanced correction', async () => {
    const j = await db.transaction((tx) => postJournal(tx, { ...inv(500), sourceId: 'inv-2' }));
    const st = await db.transaction((tx) => journalOverrideState(tx, firmId, j.id));
    const rows = st.rows!.map((r, i) => (i === 1 ? { ...r, credit: 400 } : r));
    await expect(db.transaction((tx) => saveJournalOverride(tx, { firmId, journalId: j.id, rows, userId: null }))).rejects.toThrow(/не е изедначен/);
  });
});
