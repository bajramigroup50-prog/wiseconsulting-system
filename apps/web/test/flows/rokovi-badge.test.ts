/**
 * „📅 Рокови“ top-bar counter: split into this week / ⚠ overdue, per colleague („мои фирми“ = assigned or responsible,
 * none → all), the owner's remembered toggle „Само мои фирми / Сите фирми“, the badge links filtering the list, and
 * the owner / administrator clean-up „Означи ги минатите како направени“ with its undo. 🎭 demo users count demo
 * firms only; a demo admin's clean-up never touches a real row.
 */
import { createElement } from 'react';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, todaySkopje } from '@wise/core/office';
import { ROK_CLEAN_NOTE } from '@wise/core/office/rokovi';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ enqueue: async () => 'job', renderPdf: async () => 'x' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { getUser } = await import('@/lib/auth');
const { topStatus } = await import('@/lib/top-status');
const RK = await import('@/app/(app)/rokovi/actions');
const Rokovi = (await import('@/app/(app)/rokovi/page')).default;
const { TopBar } = await import('@/components/top-bar');

const S: Record<string, string> = {};
const ID: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); jar.delete('wc_fid'); };
const TD = todaySkopje();
const badge = async () => (await topStatus((await getUser())!)).rok;
const page = async (o: Record<string, string>) => renderToStaticMarkup(await Rokovi({ searchParams: Promise.resolve(o) }));
const rok = async (key: string) => (await pg.select().from(schema.rokovi).where(eq(schema.rokovi.key, key)))[0]!;

beforeAll(async () => {
  await setupDb();
  for (const [k, role, o] of [
    ['OWNER', 'admin', {}], ['COL1', 'acc', {}], ['COL2', 'acc', { allFirms: true }], ['COL3', 'acc', { allFirms: true }], ['DEMOADMIN', 'admin', { demo: true }],
  ] as const) {
    ID[k] = await signIn(role, { username: k, ...o });
    S[k] = jar.get('wc_sess')!;
  }
  await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, ID.OWNER!));
  const F = await pg.insert(schema.firms).values([
    { name: 'ФИРМА А', edb: '4030000000201' },
    { name: 'ФИРМА Б', edb: '4030000000202', ownerId: ID.OWNER },
    { name: 'ФИРМА В', edb: '4030000000203', ownerId: ID.COL2 },
    { name: 'ДЕМО ФИРМА', edb: '4099000000201', settings: { demo: true } },
  ]).returning();
  [ID.A, ID.B, ID.C, ID.D] = F.map((f) => f.id) as [string, string, string, string];
  await pg.insert(schema.userFirms).values([{ userId: ID.COL1!, firmId: ID.A! }, { userId: ID.COL1!, firmId: ID.B! }]);
  const r = (firmId: string, key: string, d: number, o: object = {}) => ({ firmId, key, type: 'akont', title: key, period: '2026-01', due: addDays(TD, d), legalDue: addDays(TD, d), link: 'ddv', ...o });
  await pg.insert(schema.rokovi).values([
    r(ID.A!, 'A-LATE', -10), r(ID.A!, 'A-WEEK', 2), r(ID.A!, 'A-LATER', 20), r(ID.A!, 'A-DONE', -5, { done: true }),
    r(ID.B!, 'B-LATE', -400),
    r(ID.C!, 'C-LATE', -100), r(ID.C!, 'C-WEEK', 1),
    r(ID.D!, 'D-LATE', -3), r(ID.D!, 'D-WEEK', 0),
  ]);
}, 180_000);

describe('📅 split counter, per colleague', () => {
  it('the owner sees all firms by default; colleagues their assigned / responsible firms; none → all; demo → demo firms', async () => {
    as('OWNER');
    expect(await badge()).toEqual({ week: 2, late: 3, mine: false });
    as('COL1'); // assigned А, Б
    expect(await badge()).toEqual({ week: 1, late: 2, mine: true });
    as('COL2'); // all firms, responsible for В
    expect(await badge()).toEqual({ week: 1, late: 1, mine: true });
    as('COL3'); // all firms, none assigned / responsible → all
    expect(await badge()).toEqual({ week: 2, late: 3, mine: true });
    as('DEMOADMIN');
    expect(await badge()).toEqual({ week: 1, late: 1, mine: false });
  });

  it('the owner\'s toggle is remembered and drives the counter and the list', async () => {
    as('OWNER');
    expect(await RK.setRokScopeAction(true)).toHaveProperty('ok');
    expect(await badge()).toEqual({ week: 0, late: 1, mine: true }); // responsible for Б
    let h = await page({ r: 'pominati' });
    expect(h).toContain('B-LATE');
    expect(h).not.toContain('A-LATE');
    expect(h).toContain('id="rokRange"');
    await RK.setRokScopeAction(false);
    expect(await badge()).toMatchObject({ mine: false, late: 3 });
    // the badge links: this week / overdue, open only
    h = await page({ r: 'nedela' });
    expect(h).toContain('A-WEEK');
    expect(h).toContain('C-WEEK');
    expect(h).not.toContain('A-LATER');
    expect(h).not.toContain('A-LATE<');
    expect(h).not.toContain('D-WEEK');
    h = await page({ r: 'pominati' });
    for (const k of ['A-LATE', 'B-LATE', 'C-LATE']) expect(h).toContain(k);
    for (const k of ['A-DONE', 'A-WEEK', 'D-LATE']) expect(h).not.toContain(k);
    expect(h).toContain('id="rokClean"');
    // a colleague: its own choice, independent of the owner's
    as('COL1');
    expect(await RK.setRokScopeAction(false)).toHaveProperty('ok');
    expect(await badge()).toEqual({ week: 1, late: 2, mine: false }); // still only the firms it may open
    await RK.setRokScopeAction(true);
    as('OWNER');
    expect(await badge()).toMatchObject({ mine: false });
  });

  it('the top bar: a part only when > 0, ⚠ red, both linked to the filtered list; nothing for book-only', () => {
    const bar = (rok: { week: number; late: number; mine: boolean } | null, book = false) => renderToStaticMarkup(createElement(TopBar, {
      groups: [], user: { name: 'x', role: 'acc' }, year: 2026, firm: null, canFirms: true, book, status: { bell: null, ainb: 0, law: null, rok },
    }));
    const both = bar({ week: 12, late: 35, mine: true });
    expect(both).toContain('href="/rokovi?v=lista&amp;r=nedela"');
    expect(both).toContain('href="/rokovi?v=lista&amp;r=pominati"');
    expect(both).toMatch(/📅 (<!-- -->)?12/);
    expect(both).toMatch(/⚠ (<!-- -->)?35/);
    expect(both).toContain('#b42318');
    expect(both).toContain('наредните 7 дена');
    const week = bar({ week: 12, late: 0, mine: false });
    expect(week).toContain('rokTopWeek');
    expect(week).not.toContain('rokTopLate');
    expect(bar({ week: 0, late: 4, mine: false })).not.toContain('rokTopWeek');
    expect(bar({ week: 0, late: 0, mine: false })).not.toContain('rokTop');
    expect(bar({ week: 12, late: 35, mine: true }, true)).not.toContain('rokTop');
  });
});

describe('🧹 clean-up (owner / administrator)', () => {
  it('a colleague may not; the owner marks every open row before the date in scope, with the note; undo reopens them', async () => {
    as('COL1');
    expect(await RK.rokCleanupAction(TD)).toHaveProperty('error');
    expect((await RK.rokCleanupPreview(TD)).error).toBeTruthy();
    as('OWNER');
    expect(await RK.rokCleanupPreview(TD)).toEqual({ n: 3 });
    expect(await RK.rokCleanupPreview(addDays(TD, -50))).toEqual({ n: 2 });
    expect(await RK.rokCleanupAction(addDays(TD, 1))).toHaveProperty('error'); // never a future date
    expect(await RK.rokCleanupAction(TD)).toHaveProperty('ok');
    for (const k of ['A-LATE', 'B-LATE', 'C-LATE']) expect(await rok(k)).toMatchObject({ done: true, auto: false, doneBy: ID.OWNER, note: ROK_CLEAN_NOTE });
    expect(await rok('A-WEEK')).toMatchObject({ done: false });
    expect(await rok('D-LATE')).toMatchObject({ done: false });
    expect(await badge()).toEqual({ week: 2, late: 0, mine: false });
    const [log] = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'rokCleanup'));
    expect(log).toMatchObject({ userId: ID.OWNER, data: expect.objectContaining({ n: 3 }) });
    expect(await page({ v: 'lista' })).toContain('↺ Врати го последното чистење');
    expect(await RK.rokCleanupUndoAction()).toEqual({ ok: 'Вратени како отворени: 3 рокови.' });
    expect(await rok('B-LATE')).toMatchObject({ done: false, note: null, doneBy: null });
    expect(await badge()).toEqual({ week: 2, late: 3, mine: false });
    expect(await RK.rokCleanupUndoAction()).toHaveProperty('error');
  });

  it('🎭 a demo admin cleans the demo firms only', async () => {
    as('DEMOADMIN');
    expect(await RK.rokCleanupAction(TD)).toHaveProperty('ok');
    expect(await rok('D-LATE')).toMatchObject({ done: true, note: ROK_CLEAN_NOTE });
    for (const k of ['A-LATE', 'B-LATE', 'C-LATE']) expect(await rok(k)).toMatchObject({ done: false });
    as('OWNER');
    expect(await RK.rokCleanupUndoAction()).toHaveProperty('error'); // the demo clean-up is not the owner's to undo
    expect(await rok('D-LATE')).toMatchObject({ done: true });
  });
});
