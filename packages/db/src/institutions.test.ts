import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyInstReads, matchInstPayments, saveInstItem, setInstStatus, startInstReads } from './institutions';
import { routeIncoming } from './incoming';
import { buildFirmSnapshot } from './office';
import { syncRokovi } from './rokovi';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { alCompute } from '@wise/core/office';

const db = drizzle(new PGlite(), { schema });
let a = '', userId = '', fileId = '';
const W = { from: '2026-11-01', to: '2026-12-31' };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [fa] = await db.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000012', vatRegistered: false }).returning();
  a = fa!.id;
  const [u] = await db.insert(schema.users).values({ username: 'kol', name: 'Колега', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
  const [f] = await db.insert(schema.files).values({ firmId: a, bucketKey: 'firms/a/2026/x.pdf', name: 'Решение УЈП 13-4567.pdf', mime: 'application/pdf', size: 10, sha256: 'x', status: 'ready' }).returning();
  fileId = f!.id;
  const [acc] = await db.insert(schema.bankAccounts).values({ firmId: a, name: 'Жиро', account: '300000000000017', konto: '1000' }).returning();
  const [st] = await db.insert(schema.bankStatements).values({ firmId: a, bankAccountId: acc!.id, date: '2026-11-18', number: '45' }).returning();
  await db.insert(schema.bankLines).values([
    { firmId: a, statementId: st!.id, bankAccountId: acc!.id, lineNo: 1, date: '2026-11-18', amount: '-12345.60', dupKey: '45:1', counterAccount: '100000000063095', purpose: 'ДДВ повик 0511202612345' },
    { firmId: a, statementId: st!.id, bankAccountId: acc!.id, lineNo: 2, date: '2026-11-18', amount: '-12345.60', dupKey: '45:2', counterAccount: '100000000063095', purpose: 'друг данок' },
  ]);
}, 120_000);

const item = async (id: string) => (await db.select().from(schema.instItems).where(eq(schema.instItems.id, id)))[0]!;
const rok = async (id: string) => (await db.select().from(schema.rokovi).where(and(eq(schema.rokovi.firmId, a), eq(schema.rokovi.key, `inst:${id}`))))[0];

describe('🏛 institutions', () => {
  it('saves an item, puts its deadline in the calendar and the autopilot, and follows its status', async () => {
    const id = await db.transaction((tx) => saveInstItem(tx, a, { inst: 'dit', type: 'baranje_dok', refNo: '08-12', received: '2026-11-10', due: '2026-11-25', subject: 'Договори за вработување' }, userId));
    await expect(db.transaction((tx) => saveInstItem(tx, a, { inst: 'xx', type: 'baranje' }, userId))).rejects.toThrow('Изберете институција.');
    await syncRokovi(db, W);
    expect(await rok(id)).toMatchObject({ type: 'inst', due: '2026-11-25', done: false, link: 'institucii', title: 'ДИТ · Барање за документи / податоци бр. 08-12 – Договори за вработување' });
    const S = await buildFirmSnapshot(db, a, { today: '2026-11-20' });
    expect(alCompute(S!).filter((f) => f.cat === 'Институции').map((f) => f.lvl)).toEqual(['warn']);
    await db.transaction((tx) => setInstStatus(tx, { firmId: a, id, status: 'answered', userId }));
    await syncRokovi(db, W);
    expect((await rok(id))!.done).toBe(true);
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, 'inst_item'), eq(schema.auditLog.entityId, id)));
    expect(audit.map((x) => x.action).sort()).toEqual(['instSave', 'instStatus']);
  });

  it('marks paid from the bank statement only with the same amount AND the reference; one line pays one item', async () => {
    const p1 = await db.transaction((tx) => saveInstItem(tx, a, { inst: 'ujp', type: 'opomena', received: '2026-11-15', amount: 12345.6, payRef: '0511202612345', payUplSm: '840-019-02687' }, userId));
    const p2 = await db.transaction((tx) => saveInstItem(tx, a, { inst: 'ujp', type: 'opomena', received: '2026-11-15', amount: 12345.6, payRef: '0511202612345' }, userId));
    const p3 = await db.transaction((tx) => saveInstItem(tx, a, { inst: 'ujp', type: 'reshenie', received: '2026-11-15', amount: 12345.6, payUplSm: '840-019-02687' }, userId));
    const r = await matchInstPayments(db, { firmIds: [a], today: '2026-11-20' });
    expect(r).toEqual({ checked: 3, paid: 1 });
    expect(await item(p1)).toMatchObject({ status: 'paid', paidOn: '2026-11-18', paidNote: '✓ платено (извод бр. 45 од 18.11.2026, 12.345,60 ден.)' });
    expect((await item(p2)).paidOn).toBeNull();
    expect((await item(p3)).paidOn).toBeNull(); // treasury account without a reference: never guessed
    expect((await matchInstPayments(db, { firmIds: [a] })).paid).toBe(0);
  });

  it('a read fills only the blank fields; an inbox file routed to „Институција“ becomes an item that is read', async () => {
    const id = await db.transaction((tx) => saveInstItem(tx, a, { inst: 'other', type: 'drugo', received: '2026-11-19', subject: 'мој опис' }, userId));
    const [rid] = await db.transaction((tx) => startInstReads(tx, { firmId: a, userId, id, fileIds: [fileId] }));
    await db.update(schema.aiDocuments).set({ status: 'done', result: { institution: 'Државен пазарен инспекторат', type: 'zapisnik', refNo: '11-7', dueDays: 8, subject: 'друг опис', amount: 5000 } }).where(eq(schema.aiDocuments.id, rid!));
    expect(await applyInstReads(db, { firmIds: [a] })).toBe(1);
    expect(await item(id)).toMatchObject({ inst: 'dpi', type: 'zapisnik', refNo: '11-7', due: '2026-11-27', subject: 'мој опис', amount: '5000.00' });
    expect(await applyInstReads(db, { firmIds: [a] })).toBe(0);

    const [f2] = await db.insert(schema.files).values({ firmId: a, bucketKey: 'firms/a/2026/y.pdf', name: 'Опомена ФЗО.pdf', mime: 'application/pdf', size: 10, sha256: 'y', status: 'ready' }).returning();
    const [row] = await db.insert(schema.incomingDocs).values({ firmId: a, fileId: f2!.id, status: 'read' }).returning();
    const out = await db.transaction((tx) => routeIncoming(tx, { id: row!.id, firmId: a, route: 'inst', userId }));
    expect(out.go).toBe('/institucii');
    expect(out.aiDocIds).toHaveLength(1);
    const made = await item(out.ref!.split(':')[1]!);
    expect(made).toMatchObject({ inst: 'fzo', type: 'drugo', source: 'incoming', incomingId: row!.id, received: expect.any(String) });
    const links = await db.select().from(schema.fileLinks).where(and(eq(schema.fileLinks.entityType, schema.INST_FILE_ENTITY), eq(schema.fileLinks.entityId, made.id)));
    expect(links).toHaveLength(1);
  });
});
