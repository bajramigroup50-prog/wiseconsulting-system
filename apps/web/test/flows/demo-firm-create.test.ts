/**
 * 🎭 A demo user (a buyer in a sales presentation) creates a firm of its own: always a demo firm (flag + „ДЕМО – “),
 * at most 10 demo firms, deleted by the demo reset; a real firm with the same ЕДБ is never touched, linked or named;
 * real users never see it. Demo users change their own password (only their own); the owner resets any demo password.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { can } from '@wise/core';
import { DEMO_LIMIT_MSG, DEMO_MAX_FIRMS, isDemoFirm } from '@wise/core/demo';
import { deleteDemoData, demoFirmCount, schema, type Tx } from '@wise/db';
import { hashPassword, verifyPassword } from '@wise/db/password';
import { act, form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { getUser } = await import('@/lib/auth');
const { allowedFirms } = await import('@/lib/office');
const { saveFirm, deleteFirm } = await import('@/app/(app)/firmi/actions');
const { saveUser } = await import('@/app/(app)/korisnici/actions');
const { changeMyPassword } = await import('@/app/(app)/lozinka/actions');
const { demoActionAllowed, demoVerdict } = await import('@/lib/route-guard');

const EDB = '4030999000123';
const REAL_NAME = 'ВИСТИНСКИ КЛИЕНТ ТАЈНА ДООЕЛ';
let R = '', D1 = '', OFF = '', realOwner = '', realTok = '';
const snapReal = async () => (await pg.select().from(schema.firms).where(eq(schema.firms.id, R)))[0];
const asDemo = async (role = 'admin', username?: string) => { jar.clear(); return signIn(role, { demo: true, username }); };
const firmByName = async (name: string) => (await pg.select().from(schema.firms).where(eq(schema.firms.name, name)))[0];
const newFirmForm = (o: Record<string, string>) => form({
  name: 'Мојот Клиент ДООЕЛ', edb: EDB, embs: '7654321', address: 'ул. Пробна 1', city: 'Скопје', legalForm: 'dooel', activity: '47.11',
  vatRegistered: true, vatPeriod: 'month', ...o,
});

beforeAll(async () => {
  await setupDb();
  [R, D1, OFF] = (await pg.insert(schema.firms).values([
    { name: REAL_NAME, edb: EDB, embs: '7654321', settings: {} },
    { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } },
    { name: 'ДЕМО СМЕТКОВОДСТВО ДООЕЛ', settings: { demo: true, demoOffice: true } },
  ]).returning()).map((f) => f.id) as [string, string, string];
  realOwner = await signIn('admin', { username: 'real-owner' });
  realTok = jar.get('wc_sess')!;
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: realOwner } });
});

describe('a demo user creates a firm', () => {
  it('flagged and prefixed, opened, never linked to the real firm with the same ЕДБ', async () => {
    const before = await snapReal();
    const nUsers = (await pg.select().from(schema.users)).length;
    await asDemo('admin', 'demo');
    const r = await act(saveFirm({}, newFirmForm({})));
    expect(r).toEqual({ redirect: '/' });
    expect(JSON.stringify(r)).not.toContain(REAL_NAME);
    const f = await firmByName('ДЕМО – Мојот Клиент ДООЕЛ');
    expect(f).toBeTruthy();
    expect((f!.settings as { demo?: unknown }).demo).toBe(true);
    expect(isDemoFirm(f)).toBe(true);
    expect(f!).toMatchObject({ edb: EDB, embs: '7654321', legalForm: 'dooel', activity: '47.11', vatRegistered: true, vatPeriod: 'month', address: 'ул. Пробна 1' });
    expect(jar.get('wc_fid')).toBe(f!.id);
    // the real firm: untouched, and still invisible to the demo user
    expect(await snapReal()).toEqual(before);
    const u = (await getUser())!;
    expect(u.principal.firms).toContain(f!.id);
    expect(u.principal.firms).not.toContain(R);
    const L = await allowedFirms(u, { year: 'all' });
    expect(L.map((x) => x.id)).toContain(f!.id);
    expect(JSON.stringify(L)).not.toContain(REAL_NAME);
    // no client-portal (real) user is created for a demo firm
    expect((await pg.select().from(schema.users)).length).toBe(nUsers + 1);
    // audited
    expect((await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'newFirm'), eq(schema.auditLog.firmId, f!.id)))).length).toBe(1);
  });

  it('a name starting with „ДЕМО“ is kept; a demo colleague (accountant) may create too', async () => {
    await asDemo('acc');
    expect(await act(saveFirm({}, newFirmForm({ name: 'ДЕМО ПЕКАРА', edb: '' })))).toEqual({ redirect: '/' });
    expect(isDemoFirm(await firmByName('ДЕМО ПЕКАРА'))).toBe(true);
    await asDemo('view');
    await expect(saveFirm({}, newFirmForm({ name: 'Преглед' }))).rejects.toThrow(/дозвола/);
  });

  it('edits its demo firm (the prefix stays), never a real firm', async () => {
    await asDemo();
    const f = (await firmByName('ДЕМО – Мојот Клиент ДООЕЛ'))!;
    expect(await act(saveFirm({}, newFirmForm({ id: f.id, name: 'ДЕМО – Мојот Клиент ДООЕЛ', city: 'Тетово' })))).toEqual({ ok: 'Фирмата е зачувана.' });
    expect((await firmByName('ДЕМО – Мојот Клиент ДООЕЛ'))!.city).toBe('Тетово');
    expect((await act(saveFirm({}, newFirmForm({ id: f.id, name: 'Без префикс' })))) as { error?: string }).toMatchObject({ error: expect.stringMatching(/ДЕМО/) });
    const before = await snapReal();
    await expect(saveFirm({}, newFirmForm({ id: R, name: 'ДЕМО – ПРЕЗЕМЕНА' }))).rejects.toThrow(/дозвола/);
    expect(await snapReal()).toEqual(before);
  });

  it('real users never see it (the owner only in the „ДЕМО“ group)', async () => {
    const f = (await firmByName('ДЕМО – Мојот Клиент ДООЕЛ'))!;
    jar.clear();
    await signIn('acc', { allFirms: true });
    const L = (await allowedFirms((await getUser())!, { year: 'all' })).map((x) => x.id);
    expect(L).toContain(R);
    expect(L).not.toContain(f.id);
    jar.clear();
    jar.set('wc_sess', realTok);
    expect((await allowedFirms((await getUser())!, { year: 'all' })).map((x) => x.id)).not.toContain(f.id);
  });
});

describe('limit, delete, reset', () => {
  it(`at most ${DEMO_MAX_FIRMS} demo firms (the seeded ones included)`, async () => {
    await asDemo();
    let i = 0;
    while ((await demoFirmCount(pg as never)) < DEMO_MAX_FIRMS) {
      expect(await act(saveFirm({}, newFirmForm({ name: `Клиент ${++i}` })))).toEqual({ redirect: '/' });
    }
    expect(await saveFirm({}, newFirmForm({ name: 'Единаесетта' }))).toEqual({ error: DEMO_LIMIT_MSG });
    expect(await demoFirmCount(pg as never)).toBe(DEMO_MAX_FIRMS);
    expect(await firmByName('ДЕМО – Единаесетта')).toBeUndefined();
  });

  it('a demo admin deletes a demo firm for good (not the demo office firm, never a real firm); a colleague cannot', async () => {
    const f = (await firmByName('ДЕМО – Клиент 1'))!;
    await pg.insert(schema.partners).values({ firmId: f.id, name: 'Партнер', code: '1' });
    await asDemo('acc');
    await expect(deleteFirm({}, form({ id: f.id }))).rejects.toThrow(/дозвола/);
    await asDemo();
    useFirm(f.id);
    expect(await act(deleteFirm({}, form({ id: f.id })))).toEqual({ redirect: '/firmi' });
    expect(await firmByName('ДЕМО – Клиент 1')).toBeUndefined();
    expect(await pg.select().from(schema.partners).where(eq(schema.partners.firmId, f.id))).toHaveLength(0);
    expect(jar.get('wc_fid')).toBeUndefined();
    expect((await deleteFirm({}, form({ id: OFF }))).error).toMatch(/канцеларија/);
    const before = await snapReal();
    await expect(deleteFirm({}, form({ id: R }))).rejects.toThrow(/дозвола/);
    expect(await snapReal()).toEqual(before);
  });

  it('the demo reset deletes them; the real firm with the same ЕДБ survives', async () => {
    const before = await snapReal();
    const keep = (await pg.select().from(schema.users).where(eq(schema.users.username, 'demo')))[0]!.id;
    await pg.transaction((tx) => deleteDemoData(tx as unknown as Tx, { keepUserIds: [keep] }));
    expect(await demoFirmCount(pg as never)).toBe(0);
    expect(await firmByName('ДЕМО – Мојот Клиент ДООЕЛ')).toBeUndefined();
    expect(await pg.select().from(schema.firms).where(eq(schema.firms.edb, EDB))).toEqual([before]);
    expect(D1).toBeTruthy();
  });
});

describe('gates', () => {
  it('route + server-action gates: the firm screen and its actions, never the real-firm import / решение', () => {
    expect(demoVerdict('/firmi')).toBeNull();
    expect(demoActionAllowed('app/(app)/firmi/actions.ts')).toBe(true);
    for (const v of ['firmiImp', 'firmiResh', 'osnovanje']) {
      expect(demoVerdict(`/${v}`), v).toBe('/');
      expect(demoActionAllowed(`app/(app)/${v}/actions.ts`), v).toBe(false);
    }
    const p = { id: 'u', role: 'admin' as const, firms: ['D'], demo: true };
    expect(can(p, 'newFirm')).toBe(true);
    expect(can(p, 'ncCreateFirm')).toBe(false);
    expect(can(p, 'pickNew')).toBe(false);
    expect(can(p, 'firms')).toBe(false);
    expect(can(p, 'saveFirm', 'R')).toBe(false);
  });
});

describe('passwords', () => {
  it('a demo user changes its OWN password (current password required, audited), never anyone else’s', async () => {
    const id = await asDemo('acc', 'fejzi');
    await pg.update(schema.users).set({ passwordHash: await hashPassword('stara-lozinka-1') }).where(eq(schema.users.id, id));
    const otherHash = (await pg.select().from(schema.users).where(eq(schema.users.id, realOwner)))[0]!.passwordHash;
    expect((await changeMyPassword({}, form({ old: 'pogresna-lozinka', new: 'nova-lozinka-12', new2: 'nova-lozinka-12' }))).error).toMatch(/Сегашната/);
    expect(await changeMyPassword({}, form({ id: realOwner, userId: realOwner, old: 'stara-lozinka-1', new: 'nova-lozinka-12', new2: 'nova-lozinka-12' }))).toEqual({ ok: 'Лозинката е променета.' });
    const [me] = await pg.select().from(schema.users).where(eq(schema.users.id, id));
    expect((await verifyPassword(me!.passwordHash, 'nova-lozinka-12', null)).ok).toBe(true);
    expect((await pg.select().from(schema.users).where(eq(schema.users.id, realOwner)))[0]!.passwordHash).toBe(otherHash);
    expect((await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'uMyPass'), eq(schema.auditLog.userId, id)))).length).toBe(1);
  });

  it('the owner sets the password of a demo user (Корисници → Измени), ready to use', async () => {
    const [t] = await pg.select().from(schema.users).where(eq(schema.users.username, 'fejzi'));
    jar.clear();
    jar.set('wc_sess', realTok);
    const r = await act(saveUser({}, form({ id: t!.id, name: t!.name, username: 'fejzi', role: 'acc', pwNew: 'od-sopstvenikot-1', pwNew2: 'od-sopstvenikot-1', active: true, demo: true })));
    expect(r).toEqual({ redirect: '/korisnici?saved=1' });
    const [after] = await pg.select().from(schema.users).where(eq(schema.users.id, t!.id));
    expect(after!.demo).toBe(true);
    expect(after!.mustChangePassword).toBe(false);
    expect((await verifyPassword(after!.passwordHash, 'od-sopstvenikot-1', null)).ok).toBe(true);
  });
});
