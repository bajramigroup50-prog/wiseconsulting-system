import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeYearLines, openYearLines, trialBalance } from '@wise/core';
import { effectiveChart, loadLedgerLines } from './ledger-queries';
import { deleteJournal, postJournal, PostingError, unpostSource, updateJournal, type PostJournalInput } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let p1 = '';
let other = '';

const post = (i: Partial<PostJournalInput> & Pick<PostJournalInput, 'lines'>) =>
  db.transaction((tx) => postJournal(tx, { firmId, date: '2026-02-10', kind: 'manual', userId: null, ...i }));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as PostingError; } throw new Error('expected an error'); };
const bal = [{ account: '4400', debit: 100 }, { account: '1000', credit: 100 }];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const r = await seedReference(db);
  expect(r).toEqual({ accounts: 2859, cities: 30, currencies: 20 });
  await seedReference(db); // idempotent
  const [f] = await db.insert(schema.firms).values({ name: 'Тест ДООЕЛ' }).returning();
  const [g] = await db.insert(schema.firms).values({ name: 'Друга' }).returning();
  firmId = f!.id;
  other = g!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Купувач', code: '1' }).returning();
  p1 = p!.id;
}, 60_000);

describe('reference seed', () => {
  it('loads the chart, cities and currencies once', async () => {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.accounts)) as [{ n: number }];
    expect(n).toBe(2859);
    const cur = await db.select().from(schema.codes).where(and(eq(schema.codes.cb, 'currency'), eq(schema.codes.code, 'EUR')));
    expect(cur).toHaveLength(1);
    expect(cur[0]!.data).toEqual({ rate: 61.5, date: '2026-09-30' });
  });
  it('effective chart applies firm overrides', async () => {
    await db.insert(schema.accounts).values([
      { firmId, code: '10001', name: 'Жиро Стопанска' },
      { firmId, code: '1000', name: 'Банка (преименувано)' },
      { firmId, code: '002', name: 'x', hidden: true },
    ]);
    const C = await effectiveChart(db, firmId);
    expect(C.find((a) => a.code === '10001')).toMatchObject({ global: false, overridden: true });
    expect(C.find((a) => a.code === '1000')!.name).toBe('Банка (преименувано)');
    expect(C.some((a) => a.code === '002')).toBe(false);
    expect((await effectiveChart(db, other)).some((a) => a.code === '002')).toBe(true);
  });
});

describe('postJournal', () => {
  it('posts a balanced manual journal with a counter number and an audit row', async () => {
    const j = await post({ lines: [...bal, { account: '4460', debit: 0, credit: 0 }], description: 'Тест' });
    expect(j).toMatchObject({ number: '1021', replaced: false });
    const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id));
    expect(lines.map((l) => [l.lineNo, l.account, l.debit, l.credit])).toEqual([[1, '4400', '100.00', '0.00'], [2, '1000', '0.00', '100.00']]);
    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, j.id));
    expect(a.map((x) => x.action)).toEqual(['postJournal']);
    expect((await post({ lines: bal })).number).toBe('1022');
  });

  it('numbers period kinds per type and period, and honours an explicit number', async () => {
    expect((await post({ kind: 'vlez', date: '2026-05-03', lines: bal })).number).toBe('2/4-6');
    expect((await post({ kind: 'vlez', date: '2026-06-30', lines: bal })).number).toBe('2/4-6');
    expect((await post({ number: '6/10-12', lines: bal })).number).toBe('6/10-12');
    expect((await post({ kind: 'open', date: '2026-01-01', lines: bal })).number).toBe('0');
    expect((await post({ date: '2027-01-05', lines: bal })).number).toBe('1021');
  });

  it('rejects unbalanced, empty, unknown accounts, foreign partners, missing partners', async () => {
    expect((await err(post({ lines: [{ account: '4400', debit: 100 }, { account: '1000', credit: 99.99 }] }))).code).toBe('unbalanced');
    expect((await err(post({ lines: [{ account: '4400', debit: 0 }] }))).code).toBe('empty');
    expect((await err(post({ lines: [{ account: '4400', debit: 1 }, { account: '99999999', credit: 1 }] }))).code).toBe('unknown_account');
    expect((await err(post({ lines: [{ account: '4400', debit: 1 }, { account: '002', credit: 1 }] }))).code).toBe('unknown_account');
    expect((await err(post({ lines: [{ account: '44x', debit: 1 }, { account: '1000', credit: 1 }] }))).code).toBe('bad_account');
    expect((await err(post({ lines: [{ account: '1200', debit: 1 }, { account: '7400', credit: 1 }] }))).code).toBe('partner_required');
    const [q] = await db.insert(schema.partners).values({ firmId: other, name: 'Туѓ' }).returning();
    expect((await err(post({ lines: [{ account: '1200', debit: 1, partnerId: q!.id }, { account: '7400', credit: 1 }] }))).code).toBe('unknown_partner');
    expect((await err(post({ date: '2026-02-30', lines: bal }))).code).toBe('bad_date');
    await post({ lines: [{ account: '1200', debit: 1, partnerId: p1 }, { account: '7400', credit: 1 }] });
    // red storno: negative amounts on the same side are allowed if the journal balances
    await post({ lines: [{ account: '1200', debit: -5, partnerId: p1 }, { account: '7400', credit: -5 }] });
  });

  it('enforces the firm lock date for new, replaced and removed journals', async () => {
    const j = await post({ date: '2026-03-15', sourceType: 'test', sourceId: 'L1', lines: bal });
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    expect((await err(post({ date: '2026-03-31', lines: bal }))).code).toBe('locked');
    expect((await err(post({ date: '2026-04-15', sourceType: 'test', sourceId: 'L1', lines: bal }))).code).toBe('locked');
    expect((await err(db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'test', sourceId: 'L1', userId: null })))).code).toBe('locked');
    expect((await err(db.transaction((tx) => deleteJournal(tx, { firmId, journalId: j.id, userId: null })))).code).toBe('locked');
    expect((await post({ date: '2026-04-01', lines: bal })).number).toMatch(/^10\d\d$/);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('re-posting a source replaces the journal in place; unpostSource removes it', async () => {
    const a = await post({ kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-1', lines: [{ account: '1200', debit: 118, partnerId: p1 }, { account: '7400', credit: 100 }, { account: '230018', credit: 18 }] });
    expect(a.number).toBe('1/1-3');
    const b = await post({ kind: 'izlez', date: '2026-04-02', sourceType: 'invoice', sourceId: 'inv-1', lines: [{ account: '1200', debit: 236, partnerId: p1 }, { account: '7400', credit: 236 }] });
    expect(b).toMatchObject({ id: a.id, number: '1/4-6', replaced: true });
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, a.id));
    expect(L).toHaveLength(2);
    expect(await db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'invoice', sourceId: 'inv-1', userId: null }))).toBe(1);
    expect(await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, a.id))).toHaveLength(0);
    const acts = await db.select({ a: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.entityId, a.id));
    expect(acts.map((x) => x.a)).toEqual(['postJournal', 'repostJournal', 'unpostJournal']);
  });

  it('updateJournal keeps the counter number; locked journals are immutable', async () => {
    const j = await post({ lines: bal });
    const u = await db.transaction((tx) => updateJournal(tx, j.id, { firmId, date: '2026-02-11', kind: 'manual', userId: null, lines: [{ account: '4460', debit: 7, note: 'провизија' }, { account: '1000', credit: 7 }] }));
    expect(u).toEqual({ id: j.id, number: j.number, replaced: true });
    const [l] = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).limit(1);
    expect(l!.note).toBe('провизија');
    await db.update(schema.journals).set({ locked: true }).where(eq(schema.journals.id, j.id));
    expect((await err(db.transaction((tx) => updateJournal(tx, j.id, { firmId, date: '2026-02-11', kind: 'manual', userId: null, lines: bal })))).code).toBe('locked');
  });

  it('refuses an imported trial balance (bbimp) in a year with turnover', async () => {
    expect((await err(post({ kind: 'bbimp', date: '2026-12-31', lines: bal }))).code).toBe('bbimp_conflict');
    expect((await post({ kind: 'bbimp', date: '2024-12-31', lines: bal })).number).toBe('1021');
  });

  it('rolls back the whole transaction (journal + audit) on error', async () => {
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(schema.journals);
    await expect(db.transaction(async (tx) => {
      await postJournal(tx, { firmId, date: '2026-02-01', kind: 'manual', userId: null, lines: bal });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(schema.journals);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe('deferred balance trigger', () => {
  it('rejects an unbalanced journal at commit, accepts lines inserted in any order', async () => {
    await expect(db.transaction(async (tx) => {
      const [j] = await tx.insert(schema.journals).values({ firmId, date: '2026-01-02', kind: 'manual', number: 'x1' }).returning();
      await tx.insert(schema.journalLines).values({ journalId: j!.id, firmId, lineNo: 1, account: '4400', debit: '10' });
    })).rejects.toThrow(/not balanced/);
    await db.transaction(async (tx) => {
      const [j] = await tx.insert(schema.journals).values({ firmId, date: '2026-01-02', kind: 'manual', number: 'x2' }).returning();
      await tx.insert(schema.journalLines).values({ journalId: j!.id, firmId, lineNo: 1, account: '4400', debit: '10' });
      await tx.insert(schema.journalLines).values({ journalId: j!.id, firmId, lineNo: 2, account: '1000', credit: '10' });
    });
  });
  it('rejects editing a single line out of balance and a line of another firm', async () => {
    const j = await post({ lines: bal });
    await expect(db.update(schema.journalLines).set({ debit: '101' }).where(and(eq(schema.journalLines.journalId, j.id), eq(schema.journalLines.lineNo, 1))))
      .rejects.toSatisfy((e: any) => /not balanced/.test(String(e?.cause?.message ?? e?.message)));
    await expect(db.insert(schema.journalLines).values([
      { journalId: j.id, firmId: other, lineNo: 9, account: '4400', debit: '1' }, { journalId: j.id, firmId: other, lineNo: 10, account: '1000', credit: '1' },
    ])).rejects.toSatisfy((e: any) => /does not match/.test(String(e?.cause?.message ?? e?.message)));
    await db.delete(schema.journals).where(eq(schema.journals.id, j.id)); // cascade delete is fine
  });
});

describe('ledger queries + core', () => {
  it('trial balance, close and open year over persisted lines', async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'Година ДОО' }).returning();
    const id = f!.id;
    const [c] = await db.insert(schema.partners).values({ firmId: id, name: 'К' }).returning();
    const P = (date: string, kind: string, lines: PostJournalInput['lines']) => db.transaction((tx) => postJournal(tx, { firmId: id, date, kind, userId: null, lines }));
    await P('2026-01-01', 'open', [{ account: '1000', debit: 1000 }, { account: '9000', credit: 1000 }]);
    await P('2026-03-01', 'izlez', [{ account: '1200', debit: 1180, partnerId: c!.id }, { account: '7400', credit: 1000 }, { account: '230018', credit: 180 }]);
    await P('2026-04-01', 'manual', [{ account: '4400', debit: 200 }, { account: '1000', credit: 200 }]);
    const L = await loadLedgerLines(db, id, '2026-01-01', '2026-12-31');
    expect(L).toHaveLength(7);
    const tb = trialBalance(L, { level: 'a', from: '2026-01-01', to: '2026-12-31' });
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.k === '1000')).toMatchObject({ od: 1000, tp: 200, s: 800 });
    const cl = closeYearLines(L);
    await P('2026-12-31', 'close', cl.lines);
    const all = await loadLedgerLines(db, id, '2026-01-01', '2026-12-31');
    const op = await P('2027-01-01', 'open', openYearLines(all));
    expect(op.number).toBe('0');
    const next = await loadLedgerLines(db, id, '2027-01-01', '2027-12-31');
    const t2 = trialBalance(next, { level: 'a', from: '2027-01-01', to: '2027-12-31' });
    expect(t2.balanced).toBe(true);
    expect(t2.rows.find((r) => r.k === '950')!.s).toBe(-720);
    expect(t2.rows.find((r) => r.k === '1200')!.od).toBe(1180);
  });
});
