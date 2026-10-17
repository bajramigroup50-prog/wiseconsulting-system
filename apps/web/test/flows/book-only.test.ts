/**
 * 🔒 „Колегите гледаат само сметководство“ (office setting, ON by default): an office colleague (acc / senior / an admin
 * who is not the owner) opens only the bookkeeping allow-list — route guard (pages → „/“, API → 403), server actions by
 * source file, the menu, the top bar and the dashboard. The owner sees everything; „Целосен пристап“ restores the old
 * behaviour for one user; „Прилагодено“ adds views; with the setting off everybody is as before; demo, client and
 * field users keep their own rules; without a configured owner no admin is restricted (nobody locked out).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }), usePathname: () => '/' }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
// the server-reference manifest of a build: action id → source file
const VIEWS_WITH_ACTIONS = ['izlez', 'vlez', 'banka', 'nalozi', 'plati', 'ddv', 'korisnici', 'sistem', 'kdogovori', 'produktivnost', 'firmIzv', 'aiTrosok',
  'robot', 'lawAi', 'kanc', 'rokovi', 'zakoni', 'konto'];
const ACTIONS: Record<string, string> = {
  ...Object.fromEntries(VIEWS_WITH_ACTIONS.map((v) => [`a_${v}`, `apps/web/app/(app)/${v}/actions.ts`])),
  a_root: 'apps/web/app/(app)/actions.ts', a_top: 'apps/web/app/(app)/top-actions.ts', a_fx: 'apps/web/app/(app)/_fx/actions.ts',
  a_lozinka: 'apps/web/app/(app)/lozinka/actions.ts', a_mpin: 'apps/web/app/(app)/plati/mpin-actions.ts',
};
vi.mock('@/lib/action-manifest', () => ({ actionFile: async (id: string) => ACTIONS[id] ?? null }));

const { proxy } = await import('@/proxy');
const RG = await import('@/lib/route-guard');
const { viewsOf } = await import('@/lib/view-access');
const { saveUser, setBookOnlyAction } = await import('@/app/(app)/korisnici/actions');
const { saveInvoiceAction } = await import('@/app/(app)/izlez/actions');
const { NAV, OWNER_VIEWS, navFlat, navFor, onlyViews, withoutViews } = await import('@/lib/nav');
const { filterNavByModules } = await import('@/lib/nav-industry');
const { newMenu } = await import('@/lib/nav-new');
const { searchIndex } = await import('@/lib/nav-search');
const { grantableViews } = await import('@/lib/nav-access');
const { BookHome } = await import('@/app/(app)/book-home');
const Home = (await import('@/app/(app)/page')).default;
const { TopBar } = await import('@/components/top-bar');
const { myViews } = await import('@/lib/can-see');

const ALLOWED = ['/banka', '/devizni', '/nalozi', '/izlez', '/vlez', '/plati', '/ddv', '/ddvKnigi', '/kartici', '/bilanc', '/print/dnevnik', '/print/doc/x', '/lozinka', '/izlezF'];
const REFUSED = ['/korisnici', '/sistem', '/kdogovori', '/produktivnost', '/firmIzv', '/aiTrosok', '/robot', '/lawAi', '/kanc', '/rokovi',
  '/dosie', '/firmi', '/analizi', '/klDash', '/analitika', '/poobjekti', '/kontroli', '/zakoni', '/firmiResh', '/osnovanje', '/klDogovori', '/zsProc', '/mpinIn',
  '/print/firmIzv', '/print/produktivnost', '/print/fin/analitika', '/print/analizi'];
const REFUSED_ACTIONS = ['korisnici', 'sistem', 'kdogovori', 'produktivnost', 'firmIzv', 'aiTrosok', 'robot', 'lawAi', 'kanc', 'rokovi'].map((v) => `a_${v}`);

const S: Record<string, string> = {};
const ID: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
const req = (p: string, o: { method?: string; action?: string } = {}) => new NextRequest(`https://wise.test${p}`, {
  method: o.method ?? (o.action ? 'POST' : 'GET'),
  headers: { cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '), ...(o.action ? { 'next-action': o.action } : {}) },
});
const loc = async (p: string) => (await proxy(req(p))).headers.get('location');
const goes = async (p: string) => { const l = await loc(p); return l == null ? null : new URL(l).pathname; };
const status = async (p: string, action: string) => (await proxy(req(p, { action }))).status;
let F1 = '';

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'КНИГОВОДСТВО ТЕСТ ДООЕЛ', edb: '4030000000099' }).returning();
  F1 = f!.id;
  for (const [k, role] of [['owner', 'admin'], ['admin2', 'admin'], ['acc', 'acc'], ['senior', 'senior'], ['full', 'acc'], ['custom', 'acc'], ['kl', 'klient'], ['ter', 'teren']] as const) {
    ID[k] = await signIn(role, { username: `bo_${k}`, firms: role === 'admin' ? [] : [F1], allFirms: role === 'admin' });
    if (k === 'owner') await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, ID[k]));
    S[k] = jar.get('wc_sess')!;
  }
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: ID.owner } });
  useFirm(F1);
}, 120_000);

describe('the allow-list (pure)', () => {
  it('one exported constant; the hidden office views are not in it', () => {
    for (const v of ['banka', 'devizni', 'banke', 'blagajna', 'nalozi', 'kartici', 'kkart', 'recFree', 'recon', 'kompenzacii', 'ppNal', 'pocetna', 'bilanc', 'bbPart',
      'pozajmici', 'kamati', 'izlez', 'vlez', 'profakturi', 'ispratnici', 'kalkG', 'povratDob', 'plati', 'vraboteni', 'payPredlog', 'payGod',
      'payM4', 'ddv', 'ddvKnigi', 'ddvTab', 'pdd', 'os', 'partneri', 'artikli', 'uslugiS', 'konto', 'tarifi', 'konvertor', 'aiCitanje', 'lozinka', 'pomos', 'izlezF']) {
      expect(RG.BOOK_ONLY_VIEWS, v).toContain(v);
    }
    for (const v of ['sistem', 'uredi', 'greski', 'korisnici', 'kanc', 'klInbox', 'klPortal', 'klDogovori', 'kdogovori', 'kdfakturi', 'produktivnost', 'aktivnost', 'firmIzv',
      'aiTrosok', 'robot', 'lawAi', 'zakoni', 'ujpZakoni', 'zakon', 'lawrep', 'kontroli', 'aml', 'zzlp', 'rokovi', 'mesIzv', 'firmi', 'firmiImp', 'firmiResh', 'osnovanje',
      'zatvoranje', 'zsProc', 'efPrep', 'mpinIn', 'izvestuvanja', 'uvozStara', 'kursna', 'dosie', 'analizi', 'klDash', 'analitika', 'poobjekti', 'mailhist', 'semi',
      // Дејности (industry modules) are hidden from colleagues too — the owner's rule
      'hotel', 'servis', 'rent', 'gradba', 'tura', 'frTuri', 'termini', 'kartoni', 'periodicni', 'porachki', 'nabavki', 'pnalozi', 'restoran']) {
      expect(RG.BOOK_ONLY_VIEWS, v).not.toContain(v);
    }
  });
  it('restrictedViews: owner / unknown owner / modes / roles', () => {
    const on = { on: true, owner: 'no' as const, access: null };
    expect(RG.restrictedViews({ role: 'acc' }, on)!.has('banka')).toBe(true);
    expect(RG.restrictedViews({ role: 'acc' }, on)!.has('sistem')).toBe(false);
    expect(RG.restrictedViews({ role: 'admin' }, { ...on, owner: 'yes' })).toBeNull();
    // the owner cannot be determined: no admin is restricted (nobody locked out); other colleagues still are
    expect(RG.restrictedViews({ role: 'admin' }, { ...on, owner: 'unknown' })).toBeNull();
    expect(RG.restrictedViews({ role: 'acc' }, { ...on, owner: 'unknown' })).not.toBeNull();
    expect(RG.restrictedViews({ role: 'acc' }, { ...on, on: false })).toBeNull();
    expect(RG.restrictedViews({ role: 'acc' }, { ...on, access: { mode: 'full' } })).toBeNull();
    expect([...RG.restrictedViews({ role: 'acc' }, { ...on, access: { mode: 'custom', views: ['kanc'] } })!].sort()).toEqual(['izlezF', 'kanc', 'lozinka', 'pomos']);
    for (const r of ['klient', 'teren']) expect(RG.restrictedViews({ role: r }, on)).toBeNull();
    expect(RG.restrictedViews({ role: 'acc', demo: true }, on)).toBeNull();
  });
  it('book verdicts: pages, prints, APIs; actions by file; the chart is read-only', () => {
    const V = RG.restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null })!;
    for (const p of ALLOWED) expect(RG.bookVerdict(p, V), p).toBeNull();
    for (const p of REFUSED) expect(RG.bookVerdict(p, V), p).toBe('/');
    expect(RG.bookVerdict('/', V)).toBeNull();
    expect(RG.bookVerdict('/api/firms', V)).toBeNull();
    expect(RG.bookVerdict('/api/rokovi/ics', V)).toBe('403');
    expect(RG.bookVerdict('/api/office/tpl/own', V)).toBe('403');
    expect(RG.bookVerdict('/print/fin/kartici', V)).toBeNull();
    expect(RG.bookActionAllowed('app/(app)/izlez/actions.ts', V)).toBe(true);
    expect(RG.bookActionAllowed('app/(app)/_fx/actions.ts', V)).toBe(true);
    expect(RG.bookActionAllowed('app/(app)/lozinka/actions.ts', V)).toBe(true);
    expect(RG.bookActionAllowed('app/(app)/top-actions.ts', V)).toBe(false);
    expect(RG.bookActionAllowed('app/(app)/sistem/actions.ts', V)).toBe(false);
    expect(RG.bookActionAllowed('app/(app)/konto/actions.ts', V)).toBe(false);
    expect(RG.readOnlyIn(V, 'konto')).toBe(true);
    expect(RG.bookActionAllowed(null, V)).toBe(false);
    // the demo gate is the same mechanism, unchanged
    expect(RG.demoActionAllowed('app/(app)/top-actions.ts')).toBe(true);
    expect(RG.demoVerdict('/konvertor')).toBe('/');
  });
});

describe('a colleague (acc / senior / admin who is not the owner)', () => {
  it('opens the bookkeeping screens and is refused everything else — route and server action', async () => {
    for (const who of ['acc', 'senior', 'admin2']) {
      as(who);
      for (const p of ALLOWED) expect(await goes(p), `${who} ${p}`).toBeNull();
      for (const p of REFUSED) expect(await goes(p), `${who} ${p}`).toBe('/');
      expect((await proxy(req('/api/rokovi/ics'))).status).toBe(403);
      for (const a of REFUSED_ACTIONS) expect(await status('/izlez', a), `${who} ${a}`).toBe(403);
      expect(await status('/izlez', 'a_top')).toBe(403);
      expect(await status('/izlez', 'unknown-id')).toBe(403);
      for (const a of ['a_izlez', 'a_vlez', 'a_banka', 'a_nalozi', 'a_plati', 'a_ddv', 'a_root', 'a_fx', 'a_lozinka', 'a_mpin']) expect(await status('/izlez', a), `${who} ${a}`).not.toBe(403);
    }
  });
  it('saves an invoice through its action', async () => {
    as('acc');
    useFirm(F1);
    expect(await status('/izlez', 'a_izlez')).not.toBe(403);
    const [cust] = await pg.insert(schema.partners).values({ firmId: F1, name: 'КУПУВАЧ ДОО' }).returning();
    const today = new Date().toISOString().slice(0, 10);
    const payload = { id: null, kind: 'invoice', number: '', date: today, pdate: '', due: '', partnerId: cust!.id, warehouseId: '', art32: false, advance: false, export: false, svc: true,
      currency: 'MKD', fx: '1', refInvoiceId: '', creditKind: 'price', creditGross: '', fromDocId: '', note: '', data: {}, advances: [],
      lines: [{ itemId: '', code: '', name: 'Сметководствена услуга', unit: 'час', qty: '1', price: '1000', disc: '0', rate: '18', account: '' }] };
    const r = await act(saveInvoiceAction({}, form({ payload: JSON.stringify(payload) })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/(izlez|uslugi)\?saved=/) });
    expect((await pg.select().from(schema.invoices).where(eq(schema.invoices.firmId, F1))).length).toBe(1);
  });
  it('the menu: only bookkeeping (nav ids snapshot), none of the hidden items', async () => {
    as('acc');
    const V = (await myViews())!;
    expect(V).not.toBeNull();
    const ids = onlyViews(withoutViews(filterNavByModules(navFor('acc'), null, false), OWNER_VIEWS), V).flatMap(([g, L]) => navFlat(L).map(([id]) => `${g}:${id}`));
    for (const h of ['korisnici', 'sistem', 'kanc', 'kdogovori', 'dosie', 'firmi', 'robot', 'zakoni', 'kontroli', 'analizi', 'klDash', 'analitika', 'poobjekti', 'rokovi', 'aktivnost', 'arhiva', 'mojzad']) {
      expect(ids.map((x) => x.split(':')[1]), h).not.toContain(h);
    }
    expect(ids).toMatchSnapshot();
  });
  // UX Phase 1 (P40): the snapshot above is the „класично“ menu and stays as it was (deliberately unchanged). The
  // „ново“ menu of the same colleague is the same set of views, only re-arranged (one Фирми item, no duplicates,
  // no Излез group) — its own snapshot, and never a view the classic menu does not have.
  it('the „ново“ menu: the same bookkeeping views only (snapshot), and Ctrl+K finds nothing else', async () => {
    as('acc');
    const V = (await myViews())!;
    const classic = onlyViews(withoutViews(filterNavByModules(navFor('acc'), null, false), OWNER_VIEWS), V);
    const fresh = newMenu(classic);
    const ids = fresh.flatMap(([g, L]) => navFlat(L).map(([id]) => `${g}:${id}`));
    const C = new Set(classic.flatMap(([, L]) => navFlat(L).map(([id]) => id)));
    for (const x of ids) expect(C.has(x.split(':')[1]!), x).toBe(true);
    for (const e of searchIndex(classic, fresh, [['lozinka', 'Мојот профил']])) expect(V.has(e.id) || e.id === 'home', e.id).toBe(true); // home = / (always open)
    expect(ids).toMatchSnapshot();
  });
  it('the dashboard: bookkeeping shortcuts only; the top bar hides the office widgets', async () => {
    as('acc');
    useFirm(F1);
    useYear(new Date().getFullYear());
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.id, F1));
    const V = (await myViews())!;
    const el = await Home({ searchParams: Promise.resolve({}) });
    expect((el as React.ReactElement).type).toBe(BookHome);
    const html = renderToStaticMarkup(await BookHome({ role: 'acc', f: f!, year: new Date().getFullYear(), see: (v) => V.has(v) }));
    expect(html).toContain('bookHome');
    for (const v of RG.BOOK_ONLY_VIEWS.length ? ['korisnici', 'sistem', 'kanc', 'kdogovori', 'dosie', 'firmi', 'robot', 'zakoni', 'kontroli', 'analizi', 'klDash', 'analitika',
      'rokovi', 'autop', 'klInbox', 'periodicni', 'zsProc', 'aiTrosok', 'produktivnost', 'mojzad'] : []) {
      expect(html, v).not.toMatch(new RegExp(`href="/${v}[?/"]`));
    }
    expect(html).not.toMatch(/Приходи|Резултат|Рокови|Автопилот/);
    const st = { bell: { bad: 1, warn: 1, firstFirm: F1 }, ainb: 2, law: 3, locks: 1, ai: { level: 100 as const, pct: 100, msg: 'x' }, rok: { week: 2, late: 1, mine: true } };
    const bar = (book: boolean) => renderToStaticMarkup(createElement(TopBar, { groups: NAV, user: { name: 'x', role: 'acc' }, year: 2026, firm: null, status: st, canFirms: true, book }));
    for (const id of ['lawTop', 'lockTop', 'aiBudgetTop', 'rokTop', 'alTop']) {
      expect(bar(true), id).not.toContain(`id="${id}"`);
      expect(bar(false), id).toContain(`id="${id}"`);
    }
  });
});

describe('the owner, per-user overrides, the setting', () => {
  it('the owner opens everything', async () => {
    as('owner');
    for (const p of [...ALLOWED, ...REFUSED]) expect(await goes(p), p).toBeNull();
    for (const a of REFUSED_ACTIONS) expect(await status('/izlez', a), a).not.toBe(403);
    expect(await myViews()).toBeNull();
  });
  it('„Целосен пристап“ for one user restores the old behaviour; audited', async () => {
    as('owner');
    const r = await act(saveUser({}, form({ id: ID.full, name: 'bo_full', username: 'bo_full', role: 'acc', active: true, firms: [F1], viewMode: 'full' })));
    expect(r).toMatchObject({ redirect: '/korisnici?saved=1' });
    const [u] = await pg.select().from(schema.users).where(eq(schema.users.id, ID.full!));
    expect(u!.viewAccess).toEqual({ mode: 'full', views: [] });
    const L = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'userViewsSet'));
    expect(L.some((x) => x.entityId === ID.full)).toBe(true);
    as('full');
    for (const p of REFUSED) expect(await goes(p), p).toBeNull();
    for (const a of REFUSED_ACTIONS) expect(await status('/izlez', a), a).not.toBe(403);
    // the others are untouched
    as('acc');
    expect(await goes('/sistem')).toBe('/');
  });
  it('„Прилагодено“ with an extra view works (only grantable views are stored)', async () => {
    as('owner');
    const views = [...RG.BOOK_ONLY_VIEWS, 'kanc', 'not-a-view'];
    await act(saveUser({}, form({ id: ID.custom, name: 'bo_custom', username: 'bo_custom', role: 'acc', active: true, firms: [F1], viewMode: 'custom', views })));
    const [u] = await pg.select().from(schema.users).where(eq(schema.users.id, ID.custom!));
    expect((u!.viewAccess as { views: string[] }).views).toContain('kanc');
    expect((u!.viewAccess as { views: string[] }).views).not.toContain('not-a-view');
    expect(grantableViews().has('kanc')).toBe(true);
    for (const o of OWNER_VIEWS) expect(grantableViews().has(o)).toBe(false);
    as('custom');
    expect(await goes('/kanc')).toBeNull();
    expect(await status('/kanc', 'a_kanc')).not.toBe(403);
    expect(await goes('/banka')).toBeNull();
    expect(await goes('/korisnici')).toBe('/');
    expect(await status('/kanc', 'a_sistem')).toBe(403);
  });
  it('only the owner sets access and the setting', async () => {
    as('admin2');
    expect(await setBookOnlyAction({}, form({}))).toEqual({ error: 'Само за сопственикот на канцеларијата.' });
    // a non-owner admin's save leaves the access as it was
    await act(saveUser({}, form({ id: ID.acc, name: 'bo_acc', username: 'bo_acc', role: 'acc', active: true, firms: [F1], viewMode: 'full' })));
    const [u] = await pg.select().from(schema.users).where(eq(schema.users.id, ID.acc!));
    expect(u!.viewAccess).toBeNull();
  });
  it('with the setting off everybody is as before; audited; back on', async () => {
    as('owner');
    expect((await setBookOnlyAction({}, form({}))).ok).toBeTruthy();
    expect((await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'bookOnlySet'))).length).toBe(1);
    for (const who of ['acc', 'senior', 'admin2']) {
      as(who);
      for (const p of REFUSED) expect(await goes(p), `${who} ${p}`).toBeNull();
      for (const a of REFUSED_ACTIONS) expect(await status('/izlez', a), a).not.toBe(403);
      expect(await myViews()).toBeNull();
    }
    as('owner');
    expect((await setBookOnlyAction({}, form({ on: true }))).ok).toBeTruthy();
    as('acc');
    expect(await goes('/sistem')).toBe('/');
  });
});

describe('P40 „Мени: класично / ново“ (per user, never an access rule)', () => {
  it('default „ново“; the owner sets it for a colleague, a colleague for themselves; nobody else, never klient / teren', async () => {
    const { setUserMenuStyle } = await import('@/app/(app)/korisnici/actions');
    const { setMyMenuStyle } = await import('@/app/(app)/lozinka/actions');
    const { menuStyleOf } = await import('@/lib/menu-style');
    const { OWNER_ONLY_MSG } = await import('@/lib/office-owner');
    expect(await menuStyleOf(pg, ID.senior!)).toBe('new');
    as('admin2'); // an administrator who is not the owner
    expect(await setUserMenuStyle(ID.acc!, 'classic')).toEqual({ error: OWNER_ONLY_MSG });
    as('acc'); // a colleague: no „uSave“ (and the book-only action gate refuses korisnici actions anyway)
    await expect(setUserMenuStyle(ID.senior!, 'classic')).rejects.toThrow();
    expect(await status('/korisnici', 'a_korisnici')).toBe(403);
    expect(await menuStyleOf(pg, ID.senior!)).toBe('new');
    as('owner');
    expect(await setUserMenuStyle(ID.acc!, 'classic')).toMatchObject({ ok: expect.any(String) });
    expect(await menuStyleOf(pg, ID.acc!)).toBe('classic');
    expect(await setUserMenuStyle(ID.kl!, 'classic')).toMatchObject({ error: expect.any(String) });
    expect(await setUserMenuStyle(ID.ter!, 'classic')).toMatchObject({ error: expect.any(String) });
    expect(await setUserMenuStyle(ID.acc!, 'bogus')).toMatchObject({ error: expect.any(String) });
    as('acc'); // the own choice on /lozinka (its action file is open to every user)
    expect(await status('/lozinka', 'a_lozinka')).not.toBe(403);
    expect(await setMyMenuStyle('new')).toMatchObject({ ok: expect.any(String) });
    expect(await menuStyleOf(pg, ID.acc!)).toBe('new');
    // the menu style changes nothing in what the colleague may open
    expect(await myViews()).toEqual(RG.restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null }));
    as('kl');
    expect(await setMyMenuStyle('classic')).toMatchObject({ error: expect.any(String) });
  });
});

describe('server actions: the built manifest', () => {
  const built = fileURLToPath(new URL('../../.next/server/server-reference-manifest.json', import.meta.url));
  it.skipIf(!existsSync(built))('against a real build: bookkeeping files allowed, office-wide refused, the shared files present', async () => {
    const { actionFiles } = await vi.importActual<typeof import('@/lib/action-manifest')>('@/lib/action-manifest');
    const M = actionFiles(JSON.parse(readFileSync(built, 'utf8')));
    const files = [...new Set(M.values())];
    const V = RG.restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null })!;
    const of = (seg: string) => files.filter((f) => f.includes(`/(app)/${seg}/`));
    for (const v of ['izlez', 'vlez', 'banka', 'blagajna', 'plati', 'ddv', 'nalozi', '_stock', '_fx', 'lozinka']) {
      expect(of(v).length, v).toBeGreaterThan(0);
      expect(of(v).every((f) => RG.bookActionAllowed(f, V)), v).toBe(true);
    }
    for (const v of ['korisnici', 'sistem', 'kdogovori', 'produktivnost', 'firmIzv', 'aiTrosok', 'robot', 'lawAi', 'kanc', 'rokovi', 'dosie', 'kursna', 'mpinIn', 'konto']) {
      expect(of(v).length, v).toBeGreaterThan(0);
      expect(of(v).some((f) => RG.bookActionAllowed(f, V)), v).toBe(false);
    }
    expect(files.some((f) => f.endsWith('/(app)/top-actions.ts') && RG.bookActionAllowed(f, V))).toBe(false);
  });
});

describe('other users keep their own rules', () => {
  it('demo users are unchanged (the demo allow-list)', async () => {
    jar.clear();
    await signIn('admin', { demo: true });
    expect(await goes('/sistem')).toBe('/');
    expect(await goes('/banka')).toBeNull();
    expect(await goes('/kanc')).toBeNull(); // a demo-office view
    expect(await status('/banka', 'a_top')).not.toBe(403);
    expect(await myViews()).toBeNull();
    useFirm(F1);
  });
  it('client and field users are unchanged', async () => {
    as('kl');
    expect(await goes('/banka')).toBe('/klHome');
    expect(await goes('/sistem')).toBe('/klHome');
    as('ter');
    expect(await goes('/banka')).toBe('/mojzad');
    expect(await goes('/mojzad')).toBeNull();
  });
  it('the owner is never locked out: without a configured owner no admin is restricted', async () => {
    await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'officeOwner'));
    const db = pg as never;
    const admin2 = { id: ID.admin2!, role: 'admin' };
    expect(await viewsOf(db, admin2)).toBeNull();
    expect(await viewsOf(db, { id: ID.owner!, role: 'admin' })).toBeNull();
    expect(await viewsOf(db, { id: ID.acc!, role: 'acc' })).not.toBeNull();
    as('admin2');
    expect(await goes('/sistem')).toBeNull();
    // a failing owner lookup: admins pass too
    const broken = { select: () => { throw new Error('db down'); } } as never;
    expect(await viewsOf(broken, admin2, null)).toBeNull();
    await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: ID.owner } });
    expect(await viewsOf(db, admin2)).not.toBeNull();
  });
});
