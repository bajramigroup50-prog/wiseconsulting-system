/** Fiscal device log on PGlite: pending → ok only with the device's number, failures, storno, reports, audit. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { toFiscalReceipt } from '@wise/core/retail/fiscal';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { createFiscalPending, createFiscalStorno, listFiscalLog, recordFiscalReport, recordFiscalResult } from './fiscal-receipts';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
let A: { firmId: string; userId: string | null };
const receipt = toFiscalReceipt([{ name: 'Кафе', qty: 2, price: 59, rate: 18 }, { name: 'Леб', qty: 1, price: 35, rate: 5 }], { card: 50 });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Маркет ДООЕЛ', vatRegistered: true }).returning();
  A = { firmId: f!.id, userId: null };
});

describe('fiscal receipts log', () => {
  it('a sale is fiscalised only after the device confirmed it with a number', async () => {
    const id = await tx((t) => createFiscalPending(t, A, { kind: 'sale', date: '2026-10-12', receipt }));
    let [r] = await db.select().from(schema.firmDocs).where(eq(schema.firmDocs.id, id));
    expect([r!.status, r!.number, (r!.data as { total: number }).total]).toEqual(['pending', null, 153]);

    // paper out → failed, still no number
    expect(await tx((t) => recordFiscalResult(t, A, id, { ok: false, code: 'PAPER_OUT', error: 'Нема хартија' }))).toEqual({ status: 'failed', number: null });
    // "ok" without a number is not a confirmation
    expect((await tx((t) => recordFiscalResult(t, A, id, { ok: true }))).status).toBe('failed');
    [r] = await db.select().from(schema.firmDocs).where(eq(schema.firmDocs.id, id));
    expect([r!.status, (r!.data as { code: string; attempts: number }).code, (r!.data as { attempts: number }).attempts]).toEqual(['failed', 'DEVICE_ERROR', 2]);

    // printed again → ok with the device number, time and device
    const ok = await tx((t) => recordFiscalResult(t, A, id, { ok: true, number: '42', time: '2026-10-12T13:45:07', total: 153, device: { vendor: 'accent', model: 'PF550', driver: 'serial' } }));
    expect(ok).toEqual({ status: 'ok', number: '42' });
    [r] = await db.select().from(schema.firmDocs).where(eq(schema.firmDocs.id, id));
    expect([r!.status, r!.number, (r!.data as { deviceTime: string }).deviceTime]).toEqual(['ok', '42', '2026-10-12T13:45:07']);
    // final: the same answer again is idempotent, another number / an error never changes it
    expect(await tx((t) => recordFiscalResult(t, A, id, { ok: true, number: '42' }))).toEqual({ status: 'ok', number: '42' });
    expect((await err(tx((t) => recordFiscalResult(t, A, id, { ok: true, number: '43' })))).message).toMatch(/веќе фискализирана/);
    expect((await err(tx((t) => recordFiscalResult(t, A, id, { ok: false, code: 'PAPER_OUT' })))).message).toMatch(/веќе фискализирана/);
    const log = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id)));
    expect(log.map((l) => l.action).sort()).toEqual(['fiskrFail', 'fiskrFail', 'fiskrNew', 'fiskrOk']);
  });

  it('storno of a fiscalised sale carries the original number, only once', async () => {
    const pend = await tx((t) => createFiscalPending(t, A, { kind: 'sale', date: '2026-10-12', receipt }));
    expect((await err(tx((t) => createFiscalStorno(t, A, pend, '2026-10-12')))).message).toMatch(/не е фискализирана/);
    await tx((t) => recordFiscalResult(t, A, pend, { ok: true, number: '50' }));
    const s = await tx((t) => createFiscalStorno(t, A, pend, '2026-10-12'));
    expect(s.receipt.ref).toBe('50');
    expect(s.receipt.items).toEqual(receipt.items);
    // still pending → the same storno row is handed back (print again), not a second one
    expect((await tx((t) => createFiscalStorno(t, A, pend, '2026-10-12'))).id).toBe(s.id);
    await tx((t) => recordFiscalResult(t, A, s.id, { ok: true, number: '51' }));
    expect((await err(tx((t) => createFiscalStorno(t, A, pend, '2026-10-12')))).message).toMatch(/веќе сторнирана/);
    expect((await err(tx((t) => createFiscalStorno(t, A, s.id, '2026-10-12')))).message).toMatch(/само за фискална сметка од продажба/);
  });

  it('Z / X / cash are recorded only when the device confirmed them', async () => {
    expect((await err(tx((t) => recordFiscalReport(t, A, { kind: 'z', date: '2026-10-12', result: { ok: false, code: 'NOT_CONNECTED' } })))).message).toMatch(/не го потврди/);
    expect((await err(tx((t) => recordFiscalReport(t, A, { kind: 'z', date: '2026-10-12', result: { ok: true } })))).message).toMatch(/број/);
    await tx((t) => recordFiscalReport(t, A, { kind: 'z', date: '2026-10-12', result: { ok: true, number: '8', total: 123.45 } }));
    await tx((t) => recordFiscalReport(t, A, { kind: 'cashIn', date: '2026-10-12', result: { ok: true, cashSum: 1000 }, amount: 1000 }));
    const L = await listFiscalLog(db as never, A.firmId, '2026-10-12', '2026-10-12');
    expect(L.filter((x) => x.data.kind === 'z').map((x) => [x.status, x.number, x.data.total])).toEqual([['ok', '8', 123.45]]);
    expect(L.find((x) => x.data.kind === 'cashIn')!.data.total).toBe(1000);
    expect((await listFiscalLog(db as never, A.firmId, '2026-10-13', '2026-10-13')).length).toBe(0);
  });
});
