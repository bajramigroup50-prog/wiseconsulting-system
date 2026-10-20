import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ISOS_DL } from '@wise/core/office/ifac-isos';
import type { Tx } from './audit';
import { ifacReadinessFor, isosOfficeRun, isosState, saveIsosIns, saveIsosList, saveIsosQ, saveStaff, syncIsosDeadlines } from './ifac';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
const tx = db as unknown as Tx;
let A = '', B = '', off = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const U = await db.insert(schema.users).values([
    { username: 'a', name: 'Ана', role: 'admin', passwordHash: 'x' },
    { username: 'b', name: 'Бесник', role: 'acc', passwordHash: 'x' },
  ]).returning();
  A = U[0]!.id; B = U[1]!.id;
  const [f] = await db.insert(schema.firms).values({ name: 'WISE CONSULTING ДООЕЛ', edb: '4030000000000', settings: { officeFirm: true } } as never).returning();
  off = f!.id;
});

const titles = async () => (await db.select().from(schema.firmDeadlines).where(eq(schema.firmDeadlines.firmId, off))).map((d) => [d.title, d.due, d.done]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));

describe('obligations towards ИСОС', () => {
  it('policy, list, questionnaire → the office firm deadlines, done when met; one policy per start year', async () => {
    await saveStaff(tx, A, 2026, { isos: 'ovl', licence: 'ОС-123', cpd: [{ date: '2026-03-01', topic: 'МСС', provider: 'ИСОС', hours: 40 }], assessedBy: B, assessedOn: '2026-10-01' }, B);
    const p = await saveIsosIns(tx, null, { insurer: 'Сава', policyNo: 'П-1', amountEur: 20000, validFrom: '2026-01-01', validTo: '2026-12-31' }, A);
    await expect(saveIsosIns(tx, null, { insurer: 'Сава', policyNo: 'П-9', amountEur: 20000, validFrom: '2026-06-01', validTo: '2027-05-31' }, A)).rejects.toThrow(/веќе има/);
    await syncIsosDeadlines(tx, off, '2026-10-20', { userId: A });
    expect(await titles()).toEqual([
      [ISOS_DL.list(2026), '2026-01-31', false], [ISOS_DL.q(2025), '2026-03-31', false],
      [ISOS_DL.ins({ policyNo: 'П-1' }), '2026-12-31', false], [ISOS_DL.kpu, '2026-12-31', false],
      [ISOS_DL.list(2027), '2027-01-31', false], [ISOS_DL.q(2026), '2027-03-31', false],
    ]);
    const s = await isosState(tx, '2026-10-20');
    expect(s.kpu).toEqual([{ name: 'Ана', three: 40, need: 120 }]);

    await saveIsosList(tx, 2026, { submittedOn: '2026-01-25', how: 'е-пошта' }, [{ name: 'Ана', title: 'Овластен сметководител', reg: 'ОС-123' }], A);
    await saveIsosQ(tx, 2025, { receivedOn: '2025-12-18', submittedOn: '2026-03-20' }, A);
    await expect(saveIsosQ(tx, 2026, { receivedOn: '2026-12-18', submittedOn: '2026-12-01' }, A)).rejects.toThrow(/пред/);
    // the policy is renewed with a new number → the old one's deadline done; an edit keeps the same row
    await saveIsosIns(tx, null, { insurer: 'Сава', policyNo: 'П-2', amountEur: 20000, validFrom: '2027-01-01', validTo: '2027-12-31' }, A);
    expect(await saveIsosIns(tx, p, { insurer: 'Сава', policyNo: 'П-1', amountEur: 25000, validFrom: '2026-01-01', validTo: '2026-12-31' }, A)).toBe(p);
    await syncIsosDeadlines(tx, off, '2026-10-20');
    const T = await titles();
    expect(T.filter((t) => t[2]).map((t) => t[0])).toEqual([ISOS_DL.list(2026), ISOS_DL.q(2025), ISOS_DL.ins({ policyNo: 'П-1' })]);
    expect(T.some((t) => t[0] === ISOS_DL.ins({ policyNo: 'П-2' }))).toBe(true);

    const V = await ifacReadinessFor(tx, 2026, { firms: [], today: '2026-10-20' });
    const S = V.sections.find((x) => x.k === 'isos')!;
    expect(S.items.map((i) => i.ok)).toEqual([true, false, true, true, true, false]);
  });

  it('the daily run: deadlines and the autopilot findings of the office firm (resolved when met)', async () => {
    expect(await isosOfficeRun(tx, '2026-10-20')).toBe(1); // КПУ only
    let F = await db.select().from(schema.autopilotFindings).where(eq(schema.autopilotFindings.firmId, off));
    expect(F.map((f) => [f.key, f.lvl, !!f.resolvedAt])).toEqual([['isos|kpu2026', 'warn', false]]);
    await saveStaff(tx, A, 2026, { isos: 'ovl', licence: 'ОС-123', cpd: [{ date: '2026-03-01', topic: 'МСС', provider: 'ИСОС', hours: 130 }], assessedBy: B, assessedOn: '2026-10-01' }, B);
    expect(await isosOfficeRun(tx, '2026-10-20')).toBe(0);
    F = await db.select().from(schema.autopilotFindings).where(eq(schema.autopilotFindings.firmId, off));
    expect(F.every((f) => f.resolvedAt)).toBe(true);
    expect(await isosOfficeRun(tx, '2026-10-20', { firmIds: ['00000000-0000-0000-0000-000000000001'] })).toBeNull();
  });
});
