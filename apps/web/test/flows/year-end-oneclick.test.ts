/**
 * „⚡ Заврши сè за оваа фирма“ (Завршна сметка): one click for the selected firm only – depreciation when it is missing,
 * ДБ saved without adjustments, close 4/7 → 8 → 9 with the carry-over, notes, XML; blocking findings stop it; a second
 * click repeats nothing; another firm is never touched.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getStatement, postJournal, schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { finishYearAction } = await import('@/app/(app)/zsProc/actions');
let firmId = '', other = '';

const P = (fid: string, date: string, kind: string, lines: Parameters<typeof postJournal>[1]['lines'], extra = {}) =>
  pg.transaction((tx) => postJournal(tx as never, { firmId: fid, date, kind, userId: null, lines, ...extra }));

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ЕДЕН КЛИК ДООЕЛ Скопје', legalForm: 'dooel', embs: '7001299', edb: '4030025009999', activity: '62.01' }).returning();
  const [g] = await pg.insert(schema.firms).values({ name: 'ДРУГА ДООЕЛ', legalForm: 'dooel' }).returning();
  firmId = f!.id; other = g!.id;
  await P(firmId, '2025-01-01', 'open', [{ account: '1000', debit: 100_000 }, { account: '9000', credit: 100_000 }], { sourceType: 'opening', sourceId: 'open-2025' });
  await P(firmId, '2025-03-10', 'manual', [{ account: '1000', debit: 200_000 }, { account: '7400', credit: 200_000 }]);
  await P(firmId, '2025-04-02', 'manual', [{ account: '4400', debit: 80_000 }, { account: '1000', credit: 80_000 }]);
  await P(firmId, '2025-01-20', 'manual', [{ account: '0134', debit: 48_000 }, { account: '1000', credit: 48_000 }]);
  await pg.insert(schema.fixedAssets).values({ firmId, invNo: '0001', name: 'Лаптоп', konto: '0134', rate: '25', cost: '48000', date: '2025-01-20' } as never);
  await P(other, '2025-03-10', 'manual', [{ account: '1000', debit: 5_000 }, { account: '7400', credit: 5_000 }]);
  await signIn('admin');
  useFirm(firmId);
  useYear(2025);
}, 120_000);

describe('⚡ Заврши сè за оваа фирма', () => {
  it('runs depreciation, saves ДБ and notes, closes 4/7 → 8 → 9 and carries over – only this firm', async () => {
    const r = await finishYearAction();
    expect(r.error, r.error).toBeUndefined();
    expect(r.ok).toMatch(/Амортизација/);
    expect(r.ok).toMatch(/Затворање 4\/7 → 8 → 9 \(налог/);
    expect(r.ok).toMatch(/Пренос во 2026/);
    expect(r.ok).toMatch(/белешки – зачувани/);
    const st = await pg.transaction((tx) => getStatement(tx as never, firmId, 2025));
    expect(Object.keys(st!.dbAdj).length).toBeGreaterThan(0);
    expect(Object.keys(st!.notes).length).toBeGreaterThan(0);
    const close = await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.kind, 'close')));
    expect(close).toHaveLength(1);
    expect(await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, other), eq(schema.journals.kind, 'close')))).toHaveLength(0);
  });

  it('a second click repeats nothing', async () => {
    const r = await finishYearAction();
    expect(r.error, r.error).toBeUndefined();
    expect(r.ok).toMatch(/веќе затворена/);
    expect(r.ok).toMatch(/белешки – веќе зачувани/);
    expect(await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.kind, 'close')))).toHaveLength(1);
  });

  it('blocking findings stop it before the close', async () => {
    useFirm(other);
    // a supplier konto without a partner is a blocking finding
    await P(other, '2025-05-05', 'manual', [{ account: '4400', debit: 1_000 }, { account: '2200', credit: 1_000 }], { requirePartner: false });
    const r = await finishYearAction();
    expect(r.error).toMatch(/Контролата не е чиста/);
    expect(await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, other), eq(schema.journals.kind, 'close')))).toHaveLength(0);
    useFirm(firmId);
  });
});
