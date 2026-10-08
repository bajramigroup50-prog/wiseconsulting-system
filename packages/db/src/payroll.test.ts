import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { payDraft, payrollEntries2, resolvePayParams, type HrContract } from '@wise/core';
import { postJournal } from './posting';
import {
  deleteRun, extendContract, loadPayOverrides, payrollYearEndSource, loadRun, mpinAckPostAllowed, postRun, registerHrDoc, saveContract, saveRun,
  setRunLocked, unpostRun, PayrollError,
} from './payroll';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let other = '';
const empIds: string[] = [];

const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as PayrollError; } throw new Error('expected an error'); };
const tx = <T>(f: (t: typeof db) => Promise<T>) => db.transaction((t) => f(t as unknown as typeof db));

async function draftFor(month: string) {
  const E = await db.select().from(schema.employees).where(eq(schema.employees.firmId, firmId));
  return payDraft(month, E.map((e) => ({ id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef), start: e.start ?? undefined, active: e.active })));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Плати ДООЕЛ', city: 'Скопје' }).returning();
  const [g] = await db.insert(schema.firms).values({ name: 'Друга' }).returning();
  firmId = f!.id;
  other = g!.id;
  const E = await db.insert(schema.employees).values([
    { firmId, no: '1', name: 'Ана Петрова', embg: '0101990450001', netBase: '30000', start: '2020-03-01' },
    { firmId, no: '2', name: 'Борис Илиев', embg: '0202985450002', netBase: '45000', start: '2015-06-15' },
  ]).returning();
  empIds.push(...E.map((e) => e.id));
}, 60_000);

describe('payroll runs', () => {
  let runId = '';
  it('saves a draft, then posts a balanced journal identical to payrollEntries2', async () => {
    const d = await draftFor('2026-04');
    const r = await tx((t) => saveRun(t, { firmId, month: d.month, params: d.params, emps: d.emps, userId: null }));
    runId = r.id;
    expect(r.posted).toBe(false);
    const run = (await loadRun(db, firmId, { id: runId }))!;
    expect(run.emps).toHaveLength(2);
    expect(run.emps[0]!.lines!.every((l) => l.cat)).toBe(true); // FIX(#14)
    const j = await tx((t) => postRun(t, { firmId, runId, userId: null }));
    expect(j.number).toMatch(/^12\//);
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.journalId));
    const exp = payrollEntries2({ month: '2026-04', params: run.params, emps: run.emps });
    expect(L.map((l) => [l.account, Number(l.debit), Number(l.credit)])).toEqual(exp.map((l) => [l.account, l.debit, l.credit]));
    const [jr] = await db.select().from(schema.journals).where(eq(schema.journals.id, j.journalId));
    expect(jr).toMatchObject({ kind: 'plati', sourceType: 'payroll', sourceId: runId, date: '2026-04-30' });
    const [rr] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId));
    expect(rr).toMatchObject({ status: 'posted', journalId: j.journalId });
    expect(rr!.totals.net).toBeGreaterThan(70000);
  });

  it('saving a posted run re-posts it in place', async () => {
    const run = (await loadRun(db, firmId, { id: runId }))!;
    run.emps[0]!.lines!.push({ type: 'Награда / бонус', amt: 5000, cat: 'kor' });
    const r = await tx((t) => saveRun(t, { firmId, month: run.month, params: run.params, emps: run.emps, userId: null, runId }));
    expect(r.posted).toBe(true);
    const J = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceId, runId)));
    expect(J).toHaveLength(1);
    const total = (await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, J[0]!.id))).reduce((s, l) => s + Number(l.debit), 0);
    expect(total).toBeGreaterThan(5000);
  });

  it('open pay-change notes block posting and locking', async () => {
    const [n] = await db.insert(schema.payrollNotes).values({ firmId, month: '2026-04', type: 'Боледување', empName: 'Ана Петрова' }).returning();
    expect((await err(tx((t) => postRun(t, { firmId, runId, userId: null })))).code).toBe('notes_open');
    expect((await err(tx((t) => setRunLocked(t, { firmId, runId, locked: true, userId: null })))).code).toBe('notes_open');
    await db.update(schema.payrollNotes).set({ done: true }).where(eq(schema.payrollNotes.id, n!.id));
    await tx((t) => postRun(t, { firmId, runId, userId: null }));
  });

  it('a locked month cannot be changed or deleted (FIX #18 — one write path)', async () => {
    await tx((t) => setRunLocked(t, { firmId, runId, locked: true, userId: null }));
    const run = (await loadRun(db, firmId, { id: runId }))!;
    expect((await err(tx((t) => saveRun(t, { firmId, month: run.month, params: run.params, emps: run.emps, userId: null })))).code).toBe('locked');
    expect((await err(tx((t) => deleteRun(t, { firmId, runId, userId: null })))).code).toBe('locked');
    expect((await err(tx((t) => unpostRun(t, { firmId, runId, userId: null })))).code).toBe('locked');
    await tx((t) => setRunLocked(t, { firmId, runId, locked: false, userId: null }));
    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, runId));
    expect(a.map((x) => x.action)).toEqual(expect.arrayContaining(['payNewM', 'savePay2', 'payLockM']));
  });

  it('unpost removes the journal, delete removes the run', async () => {
    await tx((t) => unpostRun(t, { firmId, runId, userId: null }));
    expect(await db.select().from(schema.journals).where(eq(schema.journals.sourceId, runId))).toHaveLength(0);
    expect((await loadRun(db, firmId, { id: runId }))!.status).toBe('draft');
    await tx((t) => postRun(t, { firmId, runId, userId: null }));
    await tx((t) => deleteRun(t, { firmId, runId, userId: null }));
    expect(await db.select().from(schema.journals).where(eq(schema.journals.sourceId, runId))).toHaveLength(0);
    expect(await loadRun(db, firmId, { id: runId })).toBeNull();
  });

  it('respects the firm period lock', async () => {
    const d = await draftFor('2026-01');
    await db.update(schema.firms).set({ lockDate: '2026-02-28' }).where(eq(schema.firms.id, firmId));
    expect((await err(tx((t) => saveRun(t, { firmId, month: d.month, params: d.params, emps: d.emps, userId: null })))).code).toBe('locked');
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('FIX #12: no double booking with the УЈП MPIN acceptance journal', async () => {
    const d = await draftFor('2026-05');
    const r = await tx((t) => saveRun(t, { firmId, month: d.month, params: d.params, emps: d.emps, userId: null }));
    await tx((t) => postJournal(t, { firmId, date: '2026-05-31', kind: 'mpin', sourceType: 'mpin-ack', sourceId: '2026-05', meta: { month: '2026-05' },
      lines: [{ account: '4210', debit: 100 }, { account: '2401', credit: 100 }], userId: null }));
    expect((await err(tx((t) => postRun(t, { firmId, runId: r.id, userId: null })))).code).toBe('mpin_double');
    expect(await mpinAckPostAllowed(db, firmId, '2026-04')).toBe(true);
  });

  it('FIX #10: parameter overrides are per firm, office-wide rows apply to all', async () => {
    await db.insert(schema.payrollParams).values([
      { firmId: null, from: '2026-08', avg: '70000' },
      { firmId, from: '2026-08', avg: '71000', exempt: '11000' },
    ]);
    const mine = resolvePayParams({}, '2026-09', await loadPayOverrides(db, firmId));
    const theirs = resolvePayParams({}, '2026-09', await loadPayOverrides(db, other));
    expect([mine.avg, mine.exempt]).toEqual([71000, 11000]);
    expect(theirs.avg).toBe(70000);
    expect(theirs.exempt).not.toBe(11000);
  });
});

describe('HR registry and contracts', () => {
  const c = (o: Partial<HrContract> = {}): HrContract => ({
    type: 'opr', no: '', signDate: '2026-03-01', place: 'Скопје', start: '2026-03-01', end: '2026-08-31', reason: 'проект', position: 'Сметководител',
    duties: '', workPlace: 'Скопје', hours: 40, probation: '', gross: 45000, net: 30000, leave: 21, notice: 1, rep: 'Управител', repRole: 'Управител', ...o,
  });
  it('numbers an unnumbered contract (FIX #16) and updates the employee card', async () => {
    const a = await tx((t) => saveContract(t, { firmId, employeeId: empIds[0]!, c: c(), userId: null }));
    expect(a.doc.no).toBe('1/2026');
    expect(a.doc.code).toMatch(/^[0-9A-F]{4}-/);
    const b = await tx((t) => saveContract(t, { firmId, employeeId: empIds[1]!, c: c({ type: 'neopr', end: '' }), userId: null }));
    expect(b.doc.no).toBe('2/2026');
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, empIds[0]!));
    expect(e).toMatchObject({ contract: 'определено', end: '2026-08-31', leaveDays: 21, position: 'Сметководител' });
    const cur = await db.select().from(schema.hrContracts).where(and(eq(schema.hrContracts.employeeId, empIds[0]!), eq(schema.hrContracts.current, true)));
    expect(cur).toHaveLength(1);
  });

  it('rejects a duplicate registry number', async () => {
    expect((await err(tx((t) => registerHrDoc(t, { firmId, employeeId: empIds[0]!, kind: 'leave', no: '1/2026', date: '2026-04-01', empName: 'x', userId: null })))).code).toBe('duplicate');
  });

  it('extends a fixed-term contract with an annex', async () => {
    const d = await tx((t) => extendContract(t, { firmId, employeeId: empIds[0]!, x: { kind: 'ext', doc: 'annex', date: '2026-08-20', end: '2027-02-28' }, userId: null }));
    expect(d).toMatchObject({ kind: 'annex', no: '3/2026', refNo: '1/2026', end: '2027-02-28' });
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, empIds[0]!));
    expect(e!.end).toBe('2027-02-28');
    const t2 = await tx((t) => extendContract(t, { firmId, employeeId: empIds[0]!, x: { kind: 'transform', doc: 'odluka', date: '2027-02-01' }, userId: null }));
    expect(t2).toMatchObject({ kind: 'odluka', transform: true, no: '1/2027' });
    const [e2] = await db.select().from(schema.employees).where(eq(schema.employees.id, empIds[0]!));
    expect(e2).toMatchObject({ end: null, contract: 'неопределено' });
  });
});

describe('year-end payroll source (Phase 8 bu214–216 / bu257)', () => {
  it('reports posted runs with head count, tax and contributions, and active employees', async () => {
    const d = await draftFor('2026-06');
    const r = await tx((t) => saveRun(t, { firmId, month: d.month, params: d.params, emps: d.emps, userId: null }));
    await tx((t) => postRun(t, { firmId, runId: r.id, userId: null }));
    const src = payrollYearEndSource(() => db as never);
    const runs = await src.runs(firmId, 2026);
    expect(runs.map((x) => [x.month, x.employees])).toEqual([['2026-06', 2]]);
    expect(runs[0]!.tax).toBeGreaterThan(0);
    expect(runs[0]!.contrib).toBeGreaterThan(runs[0]!.tax);
    expect(await src.activeEmployees(firmId, 2026)).toBe(2);
  });
});
