import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { isoNo, isoReview, type IsoKind, type IsoRow, type IsoStatus } from '@wise/core/office/iso';
import type { Tx } from './audit';
import { addIsoStarterDocs, isoEvidence, saveIsoRecord, setIsoStatus } from './iso';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
let uid = '';
beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const [u] = await db.insert(schema.users).values({ username: 'iso', name: 'Управител', role: 'admin', passwordHash: 'x' }).returning();
  uid = u!.id;
});
const tx = db as unknown as Tx;

describe('ISO registers', () => {
  it('numbers per register and year, keeps only the register fields, closes and reviews', async () => {
    const a = await saveIsoRecord(tx, { kind: 'complaint', title: 'Задоцнета пријава', data: { from: 'Клиент', satisfied: 'да', junk: 'x' } }, uid, '2026-03-01');
    const b = await saveIsoRecord(tx, { kind: 'complaint', title: 'Грешка во фактура', data: {} }, uid, '2026-03-05');
    await saveIsoRecord(tx, { kind: 'risk', title: 'Губење податоци', data: { p: '2', i: '5' } }, uid, '2026-03-05');
    const R0 = await db.select().from(schema.isoRecords);
    const ca = R0.find((r) => r.id === a)!, cb = R0.find((r) => r.id === b)!;
    expect([isoNo('complaint', ca.no, ca.year), isoNo('complaint', cb.no, cb.year)]).toEqual(['ПП-1/26', 'ПП-2/26']);
    expect(ca.data).toEqual({ from: 'Клиент', satisfied: 'да' });
    await setIsoStatus(tx, a, 'done', uid);
    const R = (await db.select().from(schema.isoRecords)).map((r): IsoRow => ({ id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(), closed: r.closedAt?.toISOString() ?? null, data: r.data }));
    const V = isoReview(R, 2026);
    expect(V.complaints).toMatchObject({ n: 2, closed: 1, satisfied: 100 });
    expect(V.risks.list[0]!.sc).toEqual({ s: 10, cls: 'mid' });
  });
  it('starting documents once, the system evidence', async () => {
    expect(await addIsoStarterDocs(tx, 'WISE CONSULTING', uid, '2026-03-01')).toBe(6);
    expect(await addIsoStarterDocs(tx, 'WISE CONSULTING', uid, '2026-03-01')).toBe(0);
    const ev = await isoEvidence(tx, new Date('2026-01-01'));
    expect(ev.users.length).toBe(1);
    expect(ev.changes).toBeGreaterThan(5);
  });
});
