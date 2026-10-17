/**
 * „📅 Рокови“: the split top-bar counter (this week / overdue), the „мои фирми“ scope, the one-time clean-up
 * „Означи ги минатите како направени“ with its undo, and the daily sync leaving the cleaned rows alone.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROK_CLEAN_NOTE, rokBadgeRange, rokBadgeView, rokCleanDefault, rokWeekRange } from '@wise/core/office/rokovi';
import { classifyAction } from '@wise/core/office/productivity';
import {
  rokCleanup, rokCleanupCount, rokCleanupLast, rokCleanupUndo, rokCounts, rokMyFirmIds, rokScopeGet, rokScopeSet, syncRokovi,
} from './rokovi';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const TD = '2026-10-16';
let a = '', b = '', c = '', u1 = '', u2 = '', u3 = '', fd = '';

const row = (firmId: string, key: string, due: string, o: Partial<typeof schema.rokovi.$inferInsert> = {}) =>
  ({ firmId, key, type: 'akont', title: key, period: '2026-01', due, legalDue: due, link: 'ddv', ...o });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const U = await db.insert(schema.users).values([
    { username: 'sop', name: 'Сопственик', role: 'admin', passwordHash: 'x', allFirms: true },
    { username: 'kol', name: 'Колега', role: 'acc', passwordHash: 'x' },
    { username: 'nov', name: 'Нов', role: 'acc', passwordHash: 'x', allFirms: true },
  ]).returning();
  [u1, u2, u3] = U.map((x) => x.id) as [string, string, string];
  const F = await db.insert(schema.firms).values([
    { name: 'Алфа', edb: '4030000000101', ownerId: u1 },
    { name: 'Бета', edb: '4030000000102' },
    { name: 'Гама', edb: '4030000000103' },
  ]).returning();
  [a, b, c] = F.map((x) => x.id) as [string, string, string];
  await db.insert(schema.userFirms).values([{ userId: u2, firmId: b }]);
  const [d] = await db.insert(schema.firmDeadlines).values({ firmId: c, title: 'Лиценца', due: '2026-03-01' }).returning();
  fd = d!.id;
  await db.insert(schema.rokovi).values([
    row(a, 'a-old', '2025-05-15'), row(a, 'a-late', '2026-10-10'), row(a, 'a-today', TD), row(a, 'a-week', '2026-10-22'), row(a, 'a-later', '2026-10-23'),
    row(a, 'a-done', '2026-10-01', { done: true }), row(a, 'a-gone', '2026-10-01', { gone: true }), row(a, 'a-kdog', '2026-10-02', { type: 'kdog' }),
    row(b, 'b-late', '2026-09-15'), row(b, 'b-week', '2026-10-20'), row(b, 'b-sep', '2026-10-01'),
    row(c, `firm:${fd}`, '2026-03-01', { type: 'firm', link: 'dosie' }),
  ]);
}, 120_000);

const get = async (firmId: string, key: string) => (await db.select().from(schema.rokovi).where(and(eq(schema.rokovi.firmId, firmId), eq(schema.rokovi.key, key))))[0]!;

describe('📅 split counter', () => {
  it('this week (today + 6 days) and overdue (before today, however old), open and not gone; kdog only for the owner', async () => {
    expect(rokWeekRange(TD)).toEqual({ from: TD, to: '2026-10-22' });
    expect(await rokCounts(db, { firmIds: [a], today: TD, kdog: false })).toEqual({ week: 2, late: 2 });
    expect(await rokCounts(db, { firmIds: [a], today: TD, kdog: true })).toEqual({ week: 2, late: 3 });
    expect(await rokCounts(db, { firmIds: [a, b, c], today: TD, kdog: false })).toEqual({ week: 3, late: 5 });
    expect(await rokCounts(db, { firmIds: [], today: TD, kdog: true })).toEqual({ week: 0, late: 0 });
  });
  it('badge view: a part only when > 0, a tooltip explaining both; list ranges of the two links', () => {
    expect(rokBadgeView({ week: 0, late: 0, mine: true })).toBeNull();
    expect(rokBadgeView({ week: 12, late: 0, mine: false })).toMatchObject({ week: 12, late: null });
    const v = rokBadgeView({ week: 0, late: 35, mine: true })!;
    expect(v).toMatchObject({ week: null, late: 35 });
    expect(v.tip).toContain('наредните 7 дена');
    expect(v.tip).toContain('поминати');
    expect(v.tip).toContain('мои');
    expect(rokBadgeRange(TD, 'nedela')).toEqual({ from: TD, to: '2026-10-22', kind: 'nedela' });
    expect(rokBadgeRange(TD, 'pominati')).toMatchObject({ to: '2026-10-15', kind: 'pominati' });
    expect(rokBadgeRange(TD, 'x')).toBeNull();
    expect(rokCleanDefault(TD)).toBe('2026-10-01');
  });
});

describe('„мои фирми“ scope', () => {
  it('assigned (user_firms) or responsible (owner_id); none → all firms; the colleague filter without the fallback', async () => {
    expect(await rokMyFirmIds(db, u1, [a, b, c])).toEqual([a]);
    expect(await rokMyFirmIds(db, u2, [a, b, c])).toEqual([b]);
    expect((await rokMyFirmIds(db, u3, [a, b, c])).sort()).toEqual([a, b, c].sort());
    expect(await rokMyFirmIds(db, u3, [a, b, c], { fallback: false })).toEqual([]);
    // only among the firms the user may open
    expect(await rokMyFirmIds(db, u2, [a, c])).toEqual([a, c]);
    // the colleague's counter counts only their firms
    expect(await rokCounts(db, { firmIds: await rokMyFirmIds(db, u2, [a, b, c]), today: TD, kdog: false })).toEqual({ week: 1, late: 2 });
  });
  it('the toggle is remembered per user', async () => {
    expect(await rokScopeGet(db, u1)).toBeNull();
    await rokScopeSet(db, u1, true);
    await rokScopeSet(db, u2, false);
    expect(await rokScopeGet(db, u1)).toBe(true);
    expect(await rokScopeGet(db, u2)).toBe(false);
    await rokScopeSet(db, u1, false);
    expect(await rokScopeGet(db, u1)).toBe(false);
  });
});

describe('🧹 one-time clean-up', () => {
  it('marks only open rows before the date, in scope, by hand with the note; audited; undo reopens them', async () => {
    expect(await rokCleanupCount(db, { firmIds: [a, c], before: '2026-10-01', kdog: false })).toBe(2);
    const r = await db.transaction((tx) => rokCleanup(tx, { firmIds: [a, c], before: '2026-10-01', kdog: false, userId: u1 }));
    expect(r.n).toBe(2);
    expect(await get(a, 'a-old')).toMatchObject({ done: true, auto: false, doneBy: u1, note: ROK_CLEAN_NOTE });
    expect(await get(c, `firm:${fd}`)).toMatchObject({ done: true, note: ROK_CLEAN_NOTE });
    expect((await db.select().from(schema.firmDeadlines).where(eq(schema.firmDeadlines.id, fd)))[0]!.done).toBe(true);
    // on or after the date, out of scope, gone, kdog without the owner: untouched
    expect(await get(a, 'a-late')).toMatchObject({ done: false, note: null });
    expect(await get(b, 'b-late')).toMatchObject({ done: false });
    expect(await get(a, 'a-kdog')).toMatchObject({ done: false });
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'rokCleanup'));
    expect(log!.data).toMatchObject({ before: '2026-10-01', n: 2 });
    expect(classifyAction('rokCleanup')).not.toBeNull();
    expect(classifyAction('rokCleanupUndo')).not.toBeNull();

    // a second clean-up; the undo reopens only the last one
    const r2 = await db.transaction((tx) => rokCleanup(tx, { firmIds: [a], before: '2026-10-16', kdog: true, userId: u1, now: new Date(Date.now() + 5000) }));
    expect(r2.n).toBe(2); // a-late, a-kdog
    expect((await rokCleanupLast(db, [a, b, c]))!.getTime()).toBe(r2.at.getTime());
    const u = await db.transaction((tx) => rokCleanupUndo(tx, { firmIds: [a, b, c], userId: u1 }));
    expect(u.n).toBe(2);
    expect(await get(a, 'a-late')).toMatchObject({ done: false, doneBy: null, note: null });
    expect(await get(a, 'a-old')).toMatchObject({ done: true, note: ROK_CLEAN_NOTE });
    // undo again → the first clean-up (incl. the dossier deadline)
    expect((await db.transaction((tx) => rokCleanupUndo(tx, { firmIds: [a, b, c], userId: u1 }))).n).toBe(2);
    expect(await get(a, 'a-old')).toMatchObject({ done: false, note: null });
    expect((await db.select().from(schema.firmDeadlines).where(eq(schema.firmDeadlines.id, fd)))[0]!.done).toBe(false);
    expect((await db.transaction((tx) => rokCleanupUndo(tx, { firmIds: [a, b, c], userId: u1 }))).n).toBe(0);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'rokCleanupUndo'))).toHaveLength(2);
  });

  it('the daily sync never reopens the cleaned rows (and keeps their note); the automatic done keeps working', async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'Делта ДООЕЛ', edb: '4030000000104', vatPeriod: 'month' }).returning();
    const d = f!.id;
    await syncRokovi(db, { from: '2026-09-01', to: '2026-10-31', firmIds: [d] });
    const before = await get(d, 'ddv:2026-08');
    expect(before).toMatchObject({ done: false, due: '2026-09-25' });
    expect((await db.transaction((tx) => rokCleanup(tx, { firmIds: [d], before: '2026-10-01', kdog: false, userId: u1 }))).n).toBeGreaterThanOrEqual(1);
    // the period closes, then is reopened: an automatic undo must not touch the hand-marked row
    await db.insert(schema.vatPeriods).values({ firmId: d, period: '2026-08', periodKind: 'month', dateFrom: '2026-08-01', dateTo: '2026-08-31', status: 'open' });
    await syncRokovi(db, { from: '2026-09-01', to: '2026-10-31', firmIds: [d] });
    expect(await get(d, 'ddv:2026-08')).toMatchObject({ done: true, auto: false, note: ROK_CLEAN_NOTE });
    // after the date: still automatic
    expect(await get(d, 'ddv:2026-09')).toMatchObject({ done: false });
    await db.insert(schema.vatPeriods).values({ firmId: d, period: '2026-09', periodKind: 'month', dateFrom: '2026-09-01', dateTo: '2026-09-30', status: 'closed' });
    await syncRokovi(db, { from: '2026-09-01', to: '2026-10-31', firmIds: [d] });
    expect(await get(d, 'ddv:2026-09')).toMatchObject({ done: true, auto: true });
    expect(await get(d, 'ddv:2026-08')).toMatchObject({ done: true, auto: false, note: ROK_CLEAN_NOTE });
  });
});
