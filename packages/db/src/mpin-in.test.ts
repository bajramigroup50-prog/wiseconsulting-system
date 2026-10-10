import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpinNorm } from '@wise/core/law';
import { deleteMpinAck, distributeMpin, MpinError, mpinPlanFor } from './mpin-in';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const tx = <T>(f: (t: typeof db) => Promise<T>) => db.transaction((t) => f(t as unknown as typeof db));
let firmId = '', lockedFirm = '', userId = '';

const M = (o: Record<string, unknown> = {}) => mpinNorm({
  edb: '4030999123456', name: 'МПИН ДООЕЛ', period: '09/2026', status: 'ПРИФАТЕНА', subNo: '111', subDate: '08.10.2026',
  gross: '100,000.00', pio: '18,800.00', zdr: '7,500.00', dop: '500.00', vrab: '1,200.00', tax: '7,200.00', ...o,
});

async function row(m = M(), firm = firmId): Promise<string> {
  const [f] = await db.insert(schema.files).values({ firmId: null, bucketKey: 'k/' + Math.random(), name: 'mpin.pdf', mime: 'application/pdf', size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [r] = await db.insert(schema.mpinInbox).values({ fileId: f!.id, name: 'mpin.pdf', status: 'ok', result: m as unknown as Record<string, unknown>, firmId: firm, createdBy: userId }).returning();
  return r!.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'МПИН ДООЕЛ', edb: '4030999123456' }).returning();
  const [g] = await db.insert(schema.firms).values({ name: 'Заклучена', lockDate: '2026-12-31' }).returning();
  const [u] = await db.insert(schema.users).values({ username: 'ana', name: 'Ана', role: 'admin', passwordHash: 'x' }).returning();
  firmId = f!.id; lockedFirm = g!.id; userId = u!.id;
}, 60_000);

describe('МПИН од УЈП distribution', () => {
  it('no payroll run: dossier + mpin journal + ack; the file moves to the firm', async () => {
    const id = await row();
    const r = await tx((t) => distributeMpin(t, { rowId: id, userId, byName: 'Ана', book: true, today: '2026-10-10' }));
    expect(r.res).toBe('Досие ✓ · налог отворен');
    const [j] = await db.select().from(schema.journals).where(eq(schema.journals.id, r.journalId!));
    expect([j!.kind, j!.sourceType, j!.sourceId, j!.date]).toEqual(['mpin', 'mpin-ack', '2026-09', '2026-09-30']);
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
    expect(L.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2);
    const [ack] = await db.select().from(schema.mpinAcks).where(eq(schema.mpinAcks.id, r.ackId));
    expect([ack!.month, ack!.no, Number(ack!.gross), ack!.corr]).toEqual(['2026-09', '111', 100000, false]);
    const [d] = await db.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.id, ack!.dossierId!));
    expect([d!.category, d!.title]).toEqual(['Плати и персонал', 'МПИН – Декларација за прием 09/2026']);
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, ack!.fileId!));
    expect(file!.firmId).toBe(firmId);
    const [inbox] = await db.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, id));
    expect(inbox!.status).toBe('done');
    expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'mpinAck'))).length).toBe(1);
  });

  it('correction replaces the previous acceptance and re-posts the journal', async () => {
    const plan = await mpinPlanFor(db, firmId, '2026-09', true);
    expect(plan.old?.no).toBe('111');
    expect(plan.journal).toBe(true);
    const rid = await row(M({ subNo: '222', gross: '101,000.00' }));
    const r = await tx((t) => distributeMpin(t, { rowId: rid, userId, book: true, today: '2026-10-10' }));
    expect(r.corr).toBe(true);
    const A = await db.select().from(schema.mpinAcks).where(and(eq(schema.mpinAcks.firmId, firmId), eq(schema.mpinAcks.month, '2026-09')));
    expect(A.map((a) => [a.no, a.replaced]).sort()).toEqual([['111', true], ['222', false]]);
    const J = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'mpin-ack')));
    expect(J).toHaveLength(1);
    const D = await db.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.firmId, firmId));
    expect(D.map((d) => d.title).sort()).toEqual(['МПИН – Декларација за прием 09/2026', 'МПИН – Декларација за прием 09/2026 (заменет)']);
  });

  it('payroll run of the month: only marked, and the old mpin journal is removed (FIX #3)', async () => {
    const [run] = await db.insert(schema.payrollRuns).values({ firmId, month: '2026-09', date: '2026-09-30', params: {}, totals: { gross: 101000, dopl: 0 } }).returning();
    const plan = await mpinPlanFor(db, firmId, '2026-09', true);
    expect(plan.run).toEqual({ gross: 101000 });
    const rid = await row(M({ subNo: '333', gross: '101,000.00' }));
    const r = await tx((t) => distributeMpin(t, { rowId: rid, userId, book: true, today: '2026-10-10' }));
    expect(r.res).toBe('Досие ✓ · месецот означен „МПИН прифатен“ · стариот налог од МПИН е избришан');
    expect(r.journalId).toBeNull();
    const [ack] = await db.select().from(schema.mpinAcks).where(eq(schema.mpinAcks.id, r.ackId));
    expect(ack!.runId).toBe(run!.id);
    expect(await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'mpin-ack')))).toHaveLength(0);
  });

  it('locked period: no journal, still stored', async () => {
    const rid = await row(M(), lockedFirm);
    const r = await tx((t) => distributeMpin(t, { rowId: rid, userId, book: true, today: '2026-10-10' }));
    expect(r.res).toBe('Досие ✓ · налогот НЕ е отворен (периодот е заклучен)');
    await expect(tx((t) => deleteMpinAck(t, { firmId: lockedFirm, month: '2026-09', userId }))).resolves.toEqual({ journal: false });
  });

  it('refuses rows without a firm, and deletes an acceptance with its journal', async () => {
    const id = await row(M({ period: '08/2026' }), firmId);
    await db.update(schema.mpinInbox).set({ firmId: null }).where(eq(schema.mpinInbox.id, id));
    await expect(tx((t) => distributeMpin(t, { rowId: id, userId, book: true, today: '2026-10-10' }))).rejects.toBeInstanceOf(MpinError);
    await db.update(schema.mpinInbox).set({ firmId }).where(eq(schema.mpinInbox.id, id));
    const r = await tx((t) => distributeMpin(t, { rowId: id, userId, book: true, today: '2026-10-10' }));
    expect(r.journalId).not.toBeNull();
    expect(await tx((t) => deleteMpinAck(t, { firmId, month: '2026-08', userId }))).toEqual({ journal: true });
    expect(await db.select().from(schema.journals).where(eq(schema.journals.id, r.journalId!))).toHaveLength(0);
    expect(await db.select().from(schema.mpinAcks).where(and(eq(schema.mpinAcks.firmId, firmId), eq(schema.mpinAcks.month, '2026-08')))).toHaveLength(0);
  });
});
