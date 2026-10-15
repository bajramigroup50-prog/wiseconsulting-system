/**
 * 🎭 Demo mode: a demo user sees only the demo firms (flag + „ДЕМО“) in every list, cannot switch to / act on a real
 * firm, opens only the demo allow-list of views (route guard over ALL views, server actions by source file), and every
 * outward side effect (mail, jobs, backup, fiscal, AI by default) is refused. Real users never see demo firms. Demo
 * links: valid → demo session; expired / revoked / unknown refused; revoke ends the session; hashed; rate-limited.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_AI_OFF_MSG, DEMO_LINK_BAD_MSG, DEMO_OFF_MSG } from '@wise/core/demo';
import { aiBudgetStatus, putDemoSettings, schema } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
// the server-reference manifest of a build: action id → source file
const ACTIONS: Record<string, string> = {
  aSistem: 'app/(app)/sistem/actions.ts', aKanc: 'app/(app)/kanc/actions.ts', aSemi: 'app/(app)/semi/actions.ts',
  aIzlez: 'app/(app)/izlez/actions.ts', aRoot: 'app/(app)/actions.ts', aStock: 'app/(app)/_stock/actions.ts',
};
vi.mock('@/lib/action-manifest', () => ({ actionFile: async (id: string) => ACTIONS[id] ?? null }));

const { getUser } = await import('@/lib/auth');
const { currentFirm } = await import('@/lib/context');
const { allowedFirms } = await import('@/lib/office');
const { firmReport } = await import('@/lib/firm-list');
const firmsApi = await import('@/app/api/firms/route');
const { selectFirm } = await import('@/app/(app)/actions');
const { saveFirm } = await import('@/app/(app)/firmi/actions');
const { saveUser, deleteUser } = await import('@/app/(app)/korisnici/actions');
const { backupNowAction, restoreAction, setAiEnabledAction } = await import('@/app/(app)/sistem/actions');
const { queueMail } = await import('@/lib/mail');
const { enqueue } = await import('@/lib/jobs');
const { fiscalBridge, fiscalOffMsg } = await import('@/lib/fiscal-bridge');
const { isOfficeOwner } = await import('@/lib/office-owner');
const { proxy } = await import('@/proxy');
const { DEMO_BOOK_VIEWS, demoActionAllowed, demoVerdict, demoViews } = await import('@/lib/route-guard');
const demoRoute = await import('@/app/demo/[token]/route');
const { createDemoLink, revokeDemoLink, demoRateNext, DEMO_RATE_MAX } = await import('@/lib/demo-links');
const { saveInvoiceAction } = await import('@/app/(app)/izlez/actions');
const { saveSchemesAction } = await import('@/app/(app)/semi/actions');
const { actionFiles } = await vi.importActual<typeof import('@/lib/action-manifest')>('@/lib/action-manifest');

const firm = async (name: string, settings: Record<string, unknown> = {}) =>
  (await pg.insert(schema.firms).values({ name, settings }).returning())[0]!.id;
let R1: string, MISFLAG: string, PREFIX: string, D1: string, D2: string, realAdmin: string;

beforeAll(async () => {
  await setupDb();
  R1 = await firm('БАЈРАМИ КЛИЕНТ ДООЕЛ');
  MISFLAG = await firm('РЕАЛНА ФИРМА ДОО', { demo: true }); // flag without the prefix → real
  PREFIX = await firm('ДЕМОКРАТИЈА ДОО'); // prefix without the flag → real
  D1 = await firm('ДЕМО ТРГОВИЈА ДООЕЛ', { demo: true });
  D2 = await firm('ДЕМО УСЛУГИ ДООЕЛ', { demo: true });
  realAdmin = await signIn('admin', { username: 'real-owner' });
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: realAdmin } });
});

const REAL = () => [R1, MISFLAG, PREFIX];
const asDemo = async (role = 'admin') => { jar.clear(); return signIn(role, { demo: true }); };
const req = (p: string, o: { method?: string; headers?: Record<string, string> } = {}) => new NextRequest(`https://wise.test${p}`, {
  method: o.method ?? 'GET',
  headers: { 'x-forwarded-for': '203.0.113.9', cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '), ...o.headers },
});
const apiFirms = async () => ((await (await firmsApi.GET(req('/api/firms') as never)).json()) as { firms?: { id: string }[] } | { id: string }[]);
const ids = (x: unknown): string[] => JSON.stringify(x).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? [];

describe('demo user sees only demo firms', () => {
  it('principal = the demo firms, whatever the role / all-firms flag; every listing', async () => {
    await asDemo();
    const u = (await getUser())!;
    expect(u.demo).toBe(true);
    expect([...u.principal.firms].sort()).toEqual([D1, D2].sort());
    const L = (await allowedFirms(u, { year: 'all' })).map((f) => f.id);
    expect(L.sort()).toEqual([D1, D2].sort());
    const api = ids(await apiFirms());
    for (const r of REAL()) expect(api).not.toContain(r);
    const rep = await firmReport(u, { sve: '1' });
    expect(JSON.stringify(rep)).not.toMatch(/БАЈРАМИ|РЕАЛНА|ДЕМОКРАТИЈА/);
  });

  it('cannot switch to a real firm by cookie or by the firm picker', async () => {
    await asDemo();
    const u = (await getUser())!;
    for (const r of REAL()) {
      useFirm(r);
      expect(await currentFirm(u, { check: false })).toBeNull();
      await expect(selectFirm(r)).rejects.toThrow();
    }
    useFirm(D1);
    expect((await currentFirm(u, { check: false }))?.id).toBe(D1);
  });

  it('server actions refuse a real firm id', async () => {
    await asDemo();
    await expect(saveFirm({}, form({ id: R1, name: 'ПРОМЕНА', vatPeriod: 'quarter' }))).rejects.toThrow(/дозвола/);
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.id, R1));
    expect(f!.name).toBe('БАЈРАМИ КЛИЕНТ ДООЕЛ');
    // a new firm (would be a real one) is refused
    await expect(saveFirm({}, form({ name: 'НОВА', vatPeriod: 'quarter' }))).rejects.toThrow(/дозвола/);
  });

  it('the demo admin is never the office owner', async () => {
    const id = await asDemo();
    await pg.update(schema.appSettings).set({ value: { id } }).where(eq(schema.appSettings.key, 'officeOwner'));
    expect(await isOfficeOwner(await getUser())).toBe(false);
    await pg.update(schema.appSettings).set({ value: { id: realAdmin } }).where(eq(schema.appSettings.key, 'officeOwner'));
  });
});

describe('real users never see demo firms in normal lists', () => {
  it('admin lists and reports', async () => {
    jar.clear();
    await signIn('admin');
    const u = (await getUser())!;
    const L = (await allowedFirms(u, { year: 'all' })).map((f) => f.id);
    expect(L).toEqual(expect.arrayContaining(REAL()));
    expect(L).not.toContain(D1);
    expect(L).not.toContain(D2);
    const api = ids(await apiFirms());
    expect(api).not.toContain(D1);
    expect(JSON.stringify(await firmReport(u, { sve: '1' }))).not.toMatch(/ДЕМО ТРГОВИЈА|ДЕМО УСЛУГИ/);
  });
  it('a demo firm keeps its flag and prefix through the firm form; a real firm can never get the flag', async () => {
    jar.clear();
    await signIn('admin');
    expect(JSON.stringify(await act(saveFirm({}, form({ id: D1, name: 'ТРГОВИЈА БЕЗ ПРЕФИКС', vatPeriod: 'quarter' }))))).toMatch(/ДЕМО/);
    await act(saveFirm({}, form({ id: PREFIX, name: 'ДЕМОКРАТИЈА ДОО', vatPeriod: 'quarter', demo: 'true' })));
    const [p] = await pg.select().from(schema.firms).where(eq(schema.firms.id, PREFIX));
    expect((p!.settings as { demo?: unknown }).demo).toBeUndefined();
  });
});

describe('route guard: the demo allow-list over ALL views', () => {
  const dirs = (rel: string) => readdirSync(fileURLToPath(new URL(rel, import.meta.url)), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('[')).map((d) => d.name);
  const ALWAYS_BLOCKED = ['sistem', 'uredi', 'mailhist', 'greski', 'uvozStara', 'kursna', 'semi', 'konvertor', 'mailPotpis', 'efPrep', 'mpinIn', 'zakoni',
    'payBatch', 'zatvoranje', 'izvestuvanja', 'aml', 'zzlp', 'tpl', 'osnovanje', 'firmiImp', 'firmiResh', 'autop', 'baranja', 'mojIzv', 'klPortal',
    'klProfili', 'bankFmt', 'ujpZakoni', 'robot', 'lawAi', 'klDogovori', 'uredi'];

  it('every view of the app: open only when in the allow-list', () => {
    const V = demoViews();
    for (const d of dirs('../../app/(app)/')) expect(demoVerdict(`/${d}`), d).toBe(V.has(d) ? null : '/');
    for (const d of ALWAYS_BLOCKED) expect(demoVerdict(`/${d}`), d).toBe('/');
    for (const d of ALWAYS_BLOCKED) expect(demoVerdict(`/${d}/x`), d).toBe('/');
    expect(demoVerdict('/')).toBeNull();
    expect(demoVerdict('/banka')).toBeNull();
    expect(DEMO_BOOK_VIEWS).not.toContain('korisnici');
  });
  it('print views and API', () => {
    expect(demoVerdict('/print/ddv04All')).toBe('/');
    expect(demoVerdict('/print/firmIzv')).toBe('/');
    expect(demoVerdict('/print/produktivnost')).toBe('/');
    expect(demoVerdict('/print/izjava')).toBe('/');
    expect(demoVerdict('/print/doc/1')).toBeNull();
    expect(demoVerdict('/api/firms')).toBeNull();
    expect(demoVerdict('/api/rokovi/ics')).toBe('403');
    expect(demoVerdict('/api/office/tpl/own')).toBe('403');
    expect(demoVerdict('/demo/abc')).toBeNull();
  });
  it('server actions by source file', () => {
    expect(demoActionAllowed('app/(app)/sistem/actions.ts')).toBe(false);
    expect(demoActionAllowed('app/(app)/kanc/actions.ts')).toBe(demoViews().has('kanc'));
    expect(demoActionAllowed('app/(app)/izlez/actions.ts')).toBe(true);
    expect(demoActionAllowed('app/(app)/_stock/actions.ts')).toBe(true);
    expect(demoActionAllowed('app/(app)/actions.ts')).toBe(true);
    expect(demoActionAllowed(null)).toBe(false);
    expect(demoActionAllowed('lib/x.ts')).toBe(false);
  });
  it('proxy: a demo session is redirected from office views, a blocked action is refused even posted to an allowed page', async () => {
    await asDemo();
    expect((await proxy(req('/sistem'))).headers.get('location')).toMatch(/\/$/);
    expect((await proxy(req('/uredi'))).headers.get('location')).toMatch(/\/$/);
    expect((await proxy(req('/banka'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/api/rokovi/ics'))).status).toBe(403);
    expect((await proxy(req('/banka', { method: 'POST', headers: { 'next-action': 'aSistem' } }))).status).toBe(403);
    expect((await proxy(req('/login', { method: 'POST', headers: { 'next-action': 'aSemi' } }))).status).toBe(403);
    expect((await proxy(req('/banka', { method: 'POST', headers: { 'next-action': 'unknown-id' } }))).status).toBe(403);
    expect((await proxy(req('/izlez', { method: 'POST', headers: { 'next-action': 'aIzlez' } }))).status).not.toBe(403);
    // a real user is not touched
    jar.clear();
    await signIn('admin');
    expect((await proxy(req('/sistem'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/banka', { method: 'POST', headers: { 'next-action': 'aSistem' } }))).status).not.toBe(403);
  });
});

describe('server actions: the built manifest and real calls', () => {
  const built = fileURLToPath(new URL('../../.next/server/server-reference-manifest.json', import.meta.url));
  it('the manifest maps action ids to source files the gate reads (Next 16 writes `apps/web/…` paths)', () => {
    const M = actionFiles({ node: {
      a: { filename: 'apps/web/app/(app)/izlez/actions.ts' }, b: { filename: 'apps/web/app/(app)/sistem/actions.ts' },
      c: { filename: 'apps/web/app/(app)/_stock/actions.ts' }, d: { filename: 'apps/web/app/(app)/korisnici/demo-actions.ts' }, e: {},
    } });
    expect(demoActionAllowed(M.get('a'))).toBe(true);
    expect(demoActionAllowed(M.get('b'))).toBe(false);
    expect(demoActionAllowed(M.get('c'))).toBe(true);
    expect(demoActionAllowed(M.get('e'))).toBe(false);
  });
  it.skipIf(!existsSync(built))('against a real build: every action has a file; bookkeeping allowed, office-wide refused', () => {
    const M = actionFiles(JSON.parse(readFileSync(built, 'utf8')));
    expect(M.size).toBeGreaterThan(100);
    const files = [...new Set(M.values())];
    for (const f of files) expect(f, f).toMatch(/^apps\/web\/app\//);
    const allowed = (seg: string) => files.filter((f) => f.includes(`/(app)/${seg}/`)).every((f) => demoActionAllowed(f));
    for (const v of ['izlez', 'vlez', 'banka', 'blagajna', 'plati', 'ddv', 'nalozi', '_stock']) expect(allowed(v), v).toBe(true);
    for (const v of ['sistem', 'semi', 'uredi', 'kursna', 'mpinIn', 'efPrep', 'zakoni', 'robot', 'klPortal', 'uvozStara']) {
      const F = files.filter((f) => f.includes(`/(app)/${v}/`));
      expect(F.length, v).toBeGreaterThan(0);
      expect(F.some((f) => demoActionAllowed(f)), v).toBe(false);
    }
  });
  it('a demo user saves an invoice in a demo firm; an office-wide action is refused', async () => {
    await asDemo();
    useFirm(D1);
    const [cust] = await pg.insert(schema.partners).values({ firmId: D1, name: 'ДЕМО КУПУВАЧ ДОО' }).returning();
    const today = new Date().toISOString().slice(0, 10);
    const payload = { id: null, kind: 'invoice', number: '', date: today, pdate: '', due: '', partnerId: cust!.id, warehouseId: '', art32: false, advance: false, export: false, svc: true,
      currency: 'MKD', fx: '1', refInvoiceId: '', creditKind: 'price', creditGross: '', fromDocId: '', note: '', data: {}, advances: [],
      lines: [{ itemId: '', code: '', name: 'Консултантска услуга', unit: 'час', qty: '2', price: '1500', disc: '0', rate: '18', account: '' }] };
    const r = await act(saveInvoiceAction({}, form({ payload: JSON.stringify(payload) })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/(izlez|uslugi)\?saved=/) });
    expect((await pg.select().from(schema.invoices).where(eq(schema.invoices.firmId, D1))).length).toBe(1);
    const before = await pg.select().from(schema.appSettings);
    const s = await saveSchemesAction({}, form({ s_kupuvac: '1200' }));
    expect(s.error).toBeTruthy();
    expect(await pg.select().from(schema.appSettings)).toEqual(before);
  });
});

describe('outward side effects are refused', () => {
  it('mail, jobs, backup / restore, AI switch', async () => {
    await asDemo();
    useFirm(D1);
    await expect(queueMail(pg as never, { firmId: D1, to: 'x@example.com', subject: 's', html: 'h', userId: null })).rejects.toThrow(DEMO_OFF_MSG);
    expect(await pg.select().from(schema.mailLog)).toHaveLength(0);
    for (const j of ['mail.send', 'invoice.mail', 'fee.deliver', 'pdf.mail', 'law.texts', 'mpin.read', 'legacy.import', 'ai.read-document', 'robot.ask', 'ai.ping']) {
      await expect(enqueue(j, {}), j).rejects.toThrow(DEMO_OFF_MSG);
    }
    expect((await backupNowAction()).error).toBe(DEMO_OFF_MSG);
    expect((await restoreAction('00000000-0000-0000-0000-000000000000')).error).toBe(DEMO_OFF_MSG);
    expect((await setAiEnabledAction(true)).error).toBe(DEMO_OFF_MSG);
  });
  it('fiscal printing: no bridge on a demo page', () => {
    const w = { wiseFiscal: { version: 1, printReceipt: async () => ({}), status: async () => ({}) }, document: { querySelector: (s: string) => (s === '[data-wise-demo]' ? {} : null) } };
    expect(fiscalBridge(w)).toBeNull();
    expect(fiscalOffMsg(w)).toBe(DEMO_OFF_MSG);
    expect(fiscalBridge({ ...w, document: { querySelector: () => null } })).not.toBeNull();
  });
  it('AI is always refused for demo firms, even when a setting says otherwise (the demo never spends the AI budget)', async () => {
    const s0 = await aiBudgetStatus(pg as never, D1);
    expect(s0.paused).toBe(true);
    expect(s0.msg).toBe(DEMO_AI_OFF_MSG);
    expect((await aiBudgetStatus(pg as never, R1)).paused).toBe(false);
    await putDemoSettings(pg as never, { ai: true, aiLimitUsd: 5 }, null);
    expect((await aiBudgetStatus(pg as never, D1)).paused).toBe(true);
    await putDemoSettings(pg as never, { ai: false }, null);
  });
});

describe('users: a demo admin manages only demo users', () => {
  it('cannot edit or delete a real user; a new user is always demo with demo firms only', async () => {
    const me = await asDemo();
    const before = (await pg.select().from(schema.users).where(eq(schema.users.id, realAdmin)))[0]!;
    const r = await act(saveUser({}, form({ id: realAdmin, name: 'Хакер', username: 'real-owner', role: 'view', pwNew: '', pwNew2: '', active: true })));
    expect(JSON.stringify(r)).toContain(DEMO_OFF_MSG);
    expect((await pg.select().from(schema.users).where(eq(schema.users.id, realAdmin)))[0]!.name).toBe(before.name);
    expect((await deleteUser(realAdmin)).error).toBe(DEMO_OFF_MSG);
    await act(saveUser({}, form({ name: 'Демо Колега', username: 'demo-kolega', role: 'admin', pwNew: 'lozinka-12345', pwNew2: 'lozinka-12345', active: true, allFirms: true, firms: [D1, R1] })));
    const [n] = await pg.select().from(schema.users).where(eq(schema.users.username, 'demo-kolega'));
    expect(n!.demo).toBe(true);
    expect(n!.allFirms).toBe(false);
    const uf = (await pg.select().from(schema.userFirms).where(eq(schema.userFirms.userId, n!.id))).map((x) => x.firmId);
    expect(uf).toEqual([D1]);
    expect(me).toBeTruthy();
  });
  it('only the owner sets the demo flag', async () => {
    jar.clear();
    const other = await signIn('admin');
    const [t] = await pg.insert(schema.users).values({ username: 'kolega-x', name: 'Колега', role: 'acc', passwordHash: 'x' }).returning();
    await act(saveUser({}, form({ id: t!.id, name: 'Колега', username: 'kolega-x', role: 'acc', pwNew: '', pwNew2: '', active: true, demo: true })));
    expect((await pg.select().from(schema.users).where(eq(schema.users.id, t!.id)))[0]!.demo).toBe(false);
    expect(other).toBeTruthy();
  });
});

describe('🔗 demo links', () => {
  const open = (token: string) => demoRoute.GET(new Request(`https://wise.test/demo/${token}`), { params: Promise.resolve({ token }) });
  let demoAdmin: string;
  beforeAll(async () => {
    demoAdmin = (await pg.insert(schema.users).values({ username: 'demo', name: 'Демо', role: 'admin', demo: true, passwordHash: 'x' }).returning())[0]!.id;
  });

  it('valid link → a demo session that sees only demo firms; the token is stored hashed', async () => {
    jar.clear();
    const { token, id } = await createDemoLink({ days: 7, note: 'Купувач А', createdBy: realAdmin });
    const [row] = await pg.select().from(schema.demoLinks).where(eq(schema.demoLinks.id, id));
    expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    const r = await open(token);
    expect(r.status).toBe(303);
    const u = (await getUser())!;
    expect(u.id).toBe(demoAdmin);
    expect(u.demo).toBe(true);
    expect([...u.principal.firms].sort()).toEqual([D1, D2].sort());
    expect(jar.get('wc_fid')).toMatch(new RegExp(`^(${D1}|${D2})$`));
    const [after] = await pg.select().from(schema.demoLinks).where(eq(schema.demoLinks.id, id));
    expect(after!.uses).toBe(1);
  });

  it('a revoked link ends its session and is refused', async () => {
    jar.clear();
    const { token, id } = await createDemoLink({ days: 1, note: null, createdBy: realAdmin });
    await open(token);
    expect((await getUser())?.id).toBe(demoAdmin);
    await revokeDemoLink(id, realAdmin);
    expect(await getUser()).toBeNull();
    const r = await open(token);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain(DEMO_LINK_BAD_MSG);
  });

  it('expired and unknown tokens are refused with the neutral page', async () => {
    jar.clear();
    const { token, id } = await createDemoLink({ days: 1, note: null, createdBy: realAdmin });
    await pg.update(schema.demoLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.demoLinks.id, id));
    for (const t of [token, 'x'.repeat(43), 'kratko']) {
      const r = await open(t);
      expect(r.status, t).toBe(404);
      expect(await r.text()).toContain(DEMO_LINK_BAD_MSG);
    }
    expect(await getUser()).toBeNull();
  });

  it('a session of an expired link ends; a link of a non-demo user never signs in', async () => {
    jar.clear();
    const { token, id } = await createDemoLink({ days: 1, note: null, createdBy: realAdmin });
    await open(token);
    expect((await getUser())?.id).toBe(demoAdmin);
    await pg.update(schema.demoLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.demoLinks.id, id));
    expect(await getUser()).toBeNull();
    // a hand-made link row pointing at a real user is refused
    const raw = 'R'.repeat(43);
    await pg.insert(schema.demoLinks).values({ tokenHash: createHash('sha256').update(raw).digest('hex'), userId: realAdmin, expiresAt: new Date(Date.now() + 864e5) });
    jar.clear();
    expect((await open(raw)).status).toBe(404);
    expect(await getUser()).toBeNull();
  });

  it('rate limit: 10 per IP per 15 minutes', async () => {
    let s = null as ReturnType<typeof demoRateNext>['s'] | null;
    const t0 = 1_000_000;
    for (let i = 1; i <= DEMO_RATE_MAX; i++) { const r = demoRateNext(s, t0 + i); expect(r.ok).toBe(true); s = r.s; }
    expect(demoRateNext(s, t0 + 100).ok).toBe(false);
    expect(demoRateNext(s, t0 + 16 * 6e4).ok).toBe(true);
    // through the route (same IP as the earlier tests: the counter is already running)
    let last = 0;
    for (let i = 0; i < DEMO_RATE_MAX + 2; i++) last = (await open('y'.repeat(43))).status;
    expect(last).toBe(429);
  });
});
