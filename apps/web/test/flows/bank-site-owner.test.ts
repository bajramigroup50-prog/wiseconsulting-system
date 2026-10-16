/**
 * „🏦 Конта за изводи – за сите фирми“ — office OWNER only: another administrator, an accountant, a 🎭 demo admin and a
 * client are refused by the page, every server action and the Excel route; book-only colleagues never get the view
 * (menu, tab, grant list). The owner's preview never lists a demo firm, the start requires the backup confirmation,
 * drops a demo firm id and queues the worker job `bank.konta-all`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BANK_KONTA_ALL_JOB, schema } from '@wise/db';
import { jar, pg, setupDb, signIn } from '../harness';

const jobs: [string, Record<string, unknown>][] = [];
vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: Record<string, unknown>) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const Page = (await import('@/app/(app)/bankSite/page')).default;
const Xlsx = await import('@/app/(app)/bankSite/xlsx/route');
const A = await import('@/app/(app)/bankSite/actions');
const { NAV, OWNER_VIEWS, withoutViews, navFlat, viewAllowed } = await import('@/lib/nav');
const { BOOK_ONLY_VIEWS, demoViews } = await import('@/lib/route-guard');
const { mayOpen } = await import('@/lib/screen-access');
const { hubByKey, visibleTabs } = await import('@/lib/nav-hubs');

const MSG = 'Само за сопственикот на канцеларијата.';
const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const Y = new Date().getFullYear();
let fa = '', fd = '';

beforeAll(async () => {
  await setupDb();
  const [a, d] = await pg.insert(schema.firms).values([
    { name: 'АЛФА БАНКА ДООЕЛ' },
    { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } },
  ]).returning();
  fa = a!.id; fd = d!.id;
  for (const [k, role, demo] of [['owner', 'admin', false], ['admin2', 'admin', false], ['acc', 'acc', false], ['demo', 'admin', true], ['kl', 'klient', false]] as const) {
    const id = await signIn(role, { username: `bs_${k}`, ...(role === 'klient' ? { firms: [fa] } : {}), ...(demo ? { demo: true, firms: [fd] } : {}) });
    if (k === 'owner') await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, id));
    S[k] = jar.get('wc_sess')!;
  }
  // an account still on the generic 1000 — a change for the preview
  await pg.insert(schema.bankAccounts).values([
    { firmId: fa, name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000' },
    { firmId: fd, name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000' },
  ]);
}, 120_000);

const start = (o: Partial<Parameters<typeof A.bankSiteStartAction>[0]> = {}) =>
  A.bankSiteStartAction({ year: Y, firmIds: [fa, fd], steps: ['konto', 'transit', 'layout'], backupOk: true, ...o });

describe('bankSite — office owner only', () => {
  it('others are refused: page, every action, the Excel route', async () => {
    for (const who of ['admin2', 'acc', 'demo']) {
      as(who);
      const h = await html(Page({ searchParams: Promise.resolve({}) }));
      expect(h, who).toContain(MSG);
      expect(h).not.toContain('Прегледај ги промените');
      expect(await A.bankSitePreviewAction(Y)).toEqual({ error: MSG });
      expect(await start()).toEqual({ error: MSG });
      expect(await A.bankSiteStatusAction()).toEqual({ error: MSG });
      expect((await Xlsx.GET()).status).toBe(403);
    }
    as('kl');
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(await A.bankSitePreviewAction(Y)).toEqual({ error: MSG });
    expect((await Xlsx.GET()).status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('every server action and the routes check the owner (isOfficeOwner)', () => {
    const X = src('app/(app)/bankSite/actions.ts');
    const fns = [...X.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    expect(fns.map((m) => m[1])).toEqual(['bankSitePreviewAction', 'bankSiteStartAction', 'bankSiteStatusAction']);
    for (const [, name, body] of fns) expect(body, name).toMatch(/await bsOwnerAction\(\)/);
    expect(src('app/(app)/bankSite/page.tsx')).toMatch(/await bsOwnerUser\(\)/);
    expect(src('app/(app)/bankSite/xlsx/route.ts')).toMatch(/if \(!me\) return new Response\('Forbidden', \{ status: 403 \}\)/);
    expect(src('app/(app)/bankSite/lib.ts')).toMatch(/isOfficeOwner\(u\)/);
  });

  it('menu / tab: owner only; never for book-only colleagues, demo users or clients', () => {
    const ids = (g: typeof NAV) => g.flatMap(([, L]) => navFlat(L).map(([v]) => v));
    expect(OWNER_VIEWS).toContain('bankSite');
    expect(ids(NAV)).toContain('bankSite');
    expect(ids(withoutViews(NAV, OWNER_VIEWS))).not.toContain('bankSite');
    expect(BOOK_ONLY_VIEWS).not.toContain('bankSite');
    expect(demoViews().has('bankSite')).toBe(false);
    expect(viewAllowed('klient', 'bankSite')).toBe(false);
    const hub = hubByKey('izvodiCfg')!;
    const ctx = { role: 'admin' as const, demo: false, views: null, can: () => true };
    expect(visibleTabs(hub, (v, p) => mayOpen({ ...ctx, owner: true }, v, p)).map((t) => t.view)).toContain('bankSite');
    expect(visibleTabs(hub, (v, p) => mayOpen({ ...ctx, owner: false }, v, p)).map((t) => t.view)).not.toContain('bankSite');
    expect(visibleTabs(hub, (v, p) => mayOpen({ ...ctx, owner: true, views: new Set(BOOK_ONLY_VIEWS) }, v, p)).map((t) => t.view)).not.toContain('bankSite');
  });

  it('the owner: preview without demo firms, backup confirmation required, demo id dropped, job queued', async () => {
    as('owner');
    const h = await html(Page({ searchParams: Promise.resolve({}) }));
    expect(h).toContain('Прегледај ги промените');
    const p = await A.bankSitePreviewAction(Y);
    expect(p.plans!.map((x) => x.name)).toEqual(['АЛФА БАНКА ДООЕЛ']);
    expect(p.plans![0]!.accounts).toEqual([expect.objectContaining({ from: '1000', to: '100005' })]);
    expect(await start({ backupOk: false })).toEqual({ error: 'Потврдете дека е направена резервна копија пред примена.' });
    expect(await start({ steps: [] })).toEqual({ error: 'Изберете барем еден чекор.' });
    expect(await start({ firmIds: [fd] })).toEqual({ error: 'Изберете барем една фирма.' });
    expect(jobs).toHaveLength(0);
    expect(await start({ steps: ['konto'] })).toHaveProperty('ok');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]![0]).toBe(BANK_KONTA_ALL_JOB);
    const s = (await A.bankSiteStatusAction()).run!;
    expect(s).toMatchObject({ status: 'queued', firmIds: [fa], steps: ['konto'], year: Y, total: 1, runId: jobs[0]![1].runId });
    // a second start while the first is queued is refused
    expect(await start()).toEqual({ error: 'Примената веќе тече – почекајте да заврши.' });
    const [au] = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'bankKontaAllRun'));
    expect(au!.data).toMatchObject({ steps: ['konto'], firms: 1 });
    // the Excel of the (queued, still empty) run
    const x = await Xlsx.GET();
    expect(x.status).toBe(200);
    expect(x.headers.get('content-type')).toMatch(/spreadsheetml/);
  });
});
