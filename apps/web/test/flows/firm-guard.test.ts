/**
 * Safety flow — no mixing between firms / years, and the login always comes first:
 * - a mutation sent by a page rendered for firm A (header `x-wise-firm`) after another tab switched the session to
 *   firm B is refused with „Фирмата е променета во друг прозорец…“ and nothing is written into B; same for the year;
 * - choosing a firm / year in a stale tab still works (the request that changes the cookie is not a stale page);
 * - login → session cookie without Expires / Max-Age, firm + year cleared → the year screen → the firm list;
 *   „⏏ ИЗЛЕЗ ОД ФИРМАТА“ clears the firm; the session ends after 60 min idle / 8 h absolute.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { hashPassword } from '@wise/db/password';
import { act, cookieOpts, form, jar, pageFor, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const { savePartner } = await import('@/app/(app)/partneri/actions');
const { selectFirm, setYear } = await import('@/app/(app)/actions');
const { login } = await import('@/app/login/actions');
const { getUser, slideExpiry, ABSOLUTE_MS, IDLE_MS } = await import('@/lib/auth');
const { currentFirm, currentYear } = await import('@/lib/context');
const { FIRM_CHANGED_MSG, YEAR_CHANGED_MSG, cookieFrom, firmMismatch, staleTab, yearMismatch } = await import('@/lib/firm-guard');
const { GET: izlezF } = await import('@/app/(app)/izlezF/route');
const { default: Home } = await import('@/app/(app)/page');
const { YearPicker } = await import('@/components/year-picker');
const { FirmPicker } = await import('@/components/firm-picker');

let A = '', B = '';
const partnersOf = async (firmId: string) => (await pg.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.firmId, firmId))).map((p) => p.name);
const newPartner = (name: string) => act(savePartner({}, form({ name, active: true })));

beforeAll(async () => {
  await setupDb();
  const F = await pg.insert(schema.firms).values([{ name: 'ФИРМА А ДООЕЛ' }, { name: 'АЛБАЈРАК ДООЕЛ' }]).returning();
  A = F[0]!.id; B = F[1]!.id;
}, 120_000);

beforeEach(() => { pageFor(null); });

describe('tab / window guard (pure)', () => {
  it('compares the rendered firm / year with the current one', () => {
    expect(firmMismatch(A, A)).toBe(false);
    expect(firmMismatch(A, B)).toBe(true);
    expect(firmMismatch(A, null)).toBe(true);
    expect(firmMismatch('', B)).toBe(false); // page without a firm / request not from the app
    expect(firmMismatch(null, B)).toBe(false);
    expect(firmMismatch('junk', B)).toBe(false);
    expect(yearMismatch('2026', 2026)).toBe(false);
    expect(yearMismatch('2026', 2027)).toBe(true);
    expect(yearMismatch(null, 2027)).toBe(false);
    expect(cookieFrom(`a=1; wc_fid=${A}; wc_year=2026`, 'wc_fid')).toBe(A);
    expect(cookieFrom('a=1', 'wc_fid')).toBeUndefined();
  });

  it('proxy signal: only mutations, only when the cookie differs', () => {
    const h = (o: Record<string, string>) => (n: string) => o[n] ?? null;
    const c = (o: Record<string, string>) => (n: string) => o[n];
    expect(staleTab('POST', h({ 'x-wise-firm': A }), c({ wc_fid: B }))).toBe('firm');
    expect(staleTab('POST', h({ 'x-wise-firm': A }), c({ wc_fid: A }))).toBeNull();
    expect(staleTab('GET', h({ 'x-wise-firm': A }), c({ wc_fid: B }))).toBeNull();
    expect(staleTab('POST', h({ 'x-wise-firm': A, 'x-wise-year': '2026' }), c({ wc_fid: A, wc_year: '2027' }))).toBe('year');
    expect(staleTab('POST', h({}), c({ wc_fid: B }))).toBeNull();
  });
});

describe('no mixing between firms / years', () => {
  beforeAll(async () => { await signIn('admin'); });

  it('a page of the current firm saves normally', async () => {
    useFirm(A); useYear(2026);
    pageFor({ firm: A, year: 2026 });
    expect(await newPartner('Партнер од страница А')).toEqual({ redirect: '/partneri' });
    expect(await partnersOf(A)).toContain('Партнер од страница А');
  });

  it('another tab switched to АЛБАЈРАК: the page of firm A is refused, nothing goes into АЛБАЈРАК', async () => {
    useFirm(A); useYear(2026);
    // the other tab chose firm B → the shared cookie is B; this tab still shows firm A
    useFirm(B);
    pageFor({ firm: A, year: 2026 });
    expect(await newPartner('Извод за фирма А')).toEqual({ error: FIRM_CHANGED_MSG });
    expect(await partnersOf(B)).not.toContain('Извод за фирма А');
    expect(await partnersOf(A)).not.toContain('Извод за фирма А');
  });

  it('the other tab left the firm (no firm cookie): refused too', async () => {
    jar.delete('wc_fid');
    pageFor({ firm: A, year: 2026 });
    expect(await newPartner('Без фирма')).toEqual({ error: FIRM_CHANGED_MSG });
  });

  it('another tab changed the year: refused with the year message', async () => {
    useFirm(A); useYear(2027);
    pageFor({ firm: A, year: 2026 });
    expect(await newPartner('Внес во погрешна година')).toEqual({ error: YEAR_CHANGED_MSG });
    expect(await partnersOf(A)).not.toContain('Внес во погрешна година');
    await expect(currentYear()).rejects.toThrow(YEAR_CHANGED_MSG);
  });

  it('choosing a firm / year in a stale tab still works (and the re-render of that request is not refused)', async () => {
    useFirm(B); useYear(2026);
    pageFor({ firm: A, year: 2026 }); // the tab shows A, the cookie says B
    const u = (await getUser())!;
    await selectFirm(A);
    expect(jar.get('wc_fid')).toBe(A);
    expect((await currentFirm(u))?.id).toBe(A);
    pageFor({ firm: A, year: 2025 });
    await setYear(2027);
    expect(await currentYear()).toBe(2027);
  });

  it('same-tab switch („⇄ Промени фирма“ → selectFirm → soft navigation): the next action of that tab is allowed', async () => {
    useFirm(A); useYear(2026);
    pageFor({ firm: A, year: 2026 }); // the tab shows A and the session is A
    await selectFirm(B);
    expect(jar.get('wc_fid')).toBe(B);
    // the tab now sends B (re-rendered layout / `noteRendered`) with the cookie B: allowed, written into B
    pageFor({ firm: B, year: 2026 });
    const u = (await getUser())!;
    expect((await currentFirm(u))?.id).toBe(B);
    expect(await newPartner('Истиот таб')).toEqual({ redirect: '/partneri' });
    expect(await partnersOf(B)).toContain('Истиот таб');
    expect(await partnersOf(A)).not.toContain('Истиот таб');
  });

  it('„⬇ PDF“ from a page of another firm gets the clear message (409), not a bare 500 / endless spinner', async () => {
    const { POST } = await import('@/app/api/pdf/route');
    useFirm(B); useYear(2026);
    pageFor({ firm: A, year: 2026 });
    const r = await POST(new Request('http://wise.test/api/pdf', { method: 'POST', body: '{}' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: FIRM_CHANGED_MSG });
  });

  it('page loads and requests without the headers are not checked', async () => {
    useFirm(B); useYear(2026);
    pageFor(null);
    const u = (await getUser())!;
    expect((await currentFirm(u))?.id).toBe(B);
    expect(await newPartner('Без заглавие')).toEqual({ redirect: '/partneri' });
    expect(await partnersOf(B)).toContain('Без заглавие');
  });
});

describe('login first, then year, then firm', () => {
  const password = 'Lozinka-' + randomBytes(4).toString('hex');
  let username = '';
  beforeAll(async () => {
    username = 'smetkovod-' + randomBytes(3).toString('hex');
    await pg.insert(schema.users).values({ username, name: 'Сметководител', role: 'admin', allFirms: true, passwordHash: await hashPassword(password), mustChangePassword: false });
  });

  it('without a session every app screen goes to the login', async () => {
    jar.clear();
    expect(await getUser()).toBeNull();
    expect(await act(Home({ searchParams: Promise.resolve({}) }))).toEqual({ redirect: '/login' });
  });

  it('login: browser-session cookie (no Expires / Max-Age), secure flags, last firm + year forgotten', async () => {
    jar.clear();
    useFirm(B); useYear(2027); // left from an earlier session
    const r = await act(login('', form({ username, password })));
    expect(r).toEqual({ redirect: '/' });
    expect(jar.get('wc_sess')).toBeTruthy();
    const o = cookieOpts.get('wc_sess')!;
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.expires).toBeUndefined();
    expect(o.maxAge).toBeUndefined();
    expect(jar.has('wc_fid')).toBe(false);
    expect(jar.has('wc_year')).toBe(false);
  });

  it('after the login: the year screen, then the firm list of that year (never the last firm)', async () => {
    const el = await Home({ searchParams: Promise.resolve({}) }) as React.ReactElement<{ chosen: boolean; year: number; calendar: number }>;
    expect(el.type).toBe(YearPicker);
    expect(el.props.chosen).toBe(false);
    expect(el.props.year).toBe(el.props.calendar);
    await setYear(2026);
    expect(cookieOpts.get('wc_year')?.maxAge).toBeUndefined();
    const el2 = await Home({ searchParams: Promise.resolve({}) }) as React.ReactElement<{ year: number }>;
    expect(el2.type).toBe(FirmPicker);
    expect(el2.props.year).toBe(2026);
    // „Промени година“ goes back to the year screen
    const el3 = await Home({ searchParams: Promise.resolve({ godina: '1' }) }) as React.ReactElement;
    expect(el3.type).toBe(YearPicker);
  });

  it('firm chosen (browser-session cookie), „⏏ ИЗЛЕЗ ОД ФИРМАТА“ clears it and goes to the firm list', async () => {
    await selectFirm(A);
    expect(jar.get('wc_fid')).toBe(A);
    expect(cookieOpts.get('wc_fid')?.maxAge).toBeUndefined();
    const res = izlezF(new NextRequest('http://localhost/izlezF', { headers: { cookie: `wc_fid=${A}` } }));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    expect(res.cookies.get('wc_fid')?.value ?? '').toBe('');
  });

  it('idle timeout slides, never past 8 hours after the login', async () => {
    const t0 = new Date('2026-10-11T08:00:00Z');
    expect(slideExpiry(t0, t0.getTime() + 36e5).getTime()).toBe(t0.getTime() + 36e5 + IDLE_MS);
    expect(slideExpiry(t0, t0.getTime() + 7.5 * 36e5).getTime()).toBe(t0.getTime() + ABSOLUTE_MS);
  });

  it('sessions idle for over 60 minutes or older than 8 hours are over', async () => {
    const [u] = await pg.select().from(schema.users).where(eq(schema.users.username, username));
    const mk = async (createdAt: Date, expiresAt: Date) => {
      const token = randomBytes(24).toString('base64url');
      await pg.insert(schema.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId: u!.id, createdAt, expiresAt });
      jar.set('wc_sess', token);
      return createHash('sha256').update(token).digest('hex');
    };
    const now = Date.now();
    await mk(new Date(now - 2 * 36e5), new Date(now - 6e4)); // idle: expired a minute ago
    expect(await getUser()).toBeNull();
    await mk(new Date(now - 9 * 36e5), new Date(now + 30 * 864e5)); // an old 30-day session: past the 8 h limit
    expect(await getUser()).toBeNull();
    const id = await mk(new Date(now - 36e5), new Date(now + 10 * 6e4)); // active: the expiry slides to +60 min
    expect((await getUser())?.username).toBe(username);
    const [s] = await pg.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(s!.expiresAt.getTime()).toBeGreaterThan(now + 55 * 6e4);
  });
});
