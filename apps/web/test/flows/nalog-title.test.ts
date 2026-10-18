/**
 * „✎ Назив“ in Налози за книжење: the imported VAT nalog „1/3 – Увезен налог 1/3“ is renamed to „ДДВ 01-03“ — the list,
 * the opened nalog, the print and the Excel/CSV journal use the name; clearing it brings back the automatic title; the
 * same number in another year and other numbers keep theirs; a viewer cannot rename; a locked period still allows it; an
 * imported nalog opens in the manual editor with its lines, headed by its name (PGlite).
 */
import { eq } from 'drizzle-orm';
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { postJournal, schema } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const NaloziPage = (await import('@/app/(app)/nalozi/page')).default;
const PrintNalog = (await import('@/app/print/nalog/page')).default;
const Dnevnik = await import('@/app/(app)/nalozi/dnevnik/route');
const { setNalogTitleAction } = await import('@/app/(app)/nalozi/actions');

let firmId = '', owner = '', viewer = '';
const html = async (el: React.ReactNode) => new Response((await prerender(el)).prelude).text();
const page = async (sp: Record<string, string> = {}) => html(await NaloziPage({ searchParams: Promise.resolve(sp) }));
const print = async (n: string) => html(await PrintNalog({ searchParams: Promise.resolve({ n }) }));
const csv = async () => (await Dnevnik.GET(new Request('http://x/nalozi/dnevnik?f=csv'))).text();
const rename = (n: string, title: string, year = 2026) => act(setNalogTitleAction(n, year, {}, form({ title })));

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Назив на Налог ДООЕЛ' }).returning();
  firmId = f!.id;
  for (const [date, number] of [['2026-03-31', '1/3'], ['2026-06-30', '1/4-6'], ['2025-03-31', '1/3']] as const) {
    await pg.transaction((tx) => postJournal(tx as never, { firmId, date, kind: 'manual', number, description: 'Увезен налог ' + number, userId: null,
      lines: [{ account: '4000', debit: 100 }, { account: '1000', credit: 100 }] }));
  }
  await signIn('view', { firms: [firmId] }); viewer = jar.get('wc_sess')!;
  await signIn('admin'); owner = jar.get('wc_sess')!;
  useFirm(firmId); useYear(2026);
}, 120_000);

describe('✎ Назив на налог', () => {
  it('the opened nalog offers ✎ Назив; the form shows the automatic title as placeholder', async () => {
    jar.set('wc_sess', owner);
    expect(await page({ n: '1/3' })).toContain('✎ Назив');
    const h = await page({ n: '1/3', naziv: '' });
    expect(h).toContain('aria-label="Назив на налогот"');
    expect(h).toContain('placeholder="Увезен налог 1/3"');
  });

  it('renaming shows the name in the list, the heading, the print and the CSV; other year / number unaffected', async () => {
    jar.set('wc_sess', owner);
    expect(await rename('1/3', 'ДДВ 01-03')).toEqual({ redirect: '/nalozi?n=1%2F3' });
    const list = await page();
    expect(list).toContain('ДДВ 01-03');
    expect(list).toContain('Увезен налог 1/4-6');
    expect(list).not.toContain('Увезен налог 1/3<');
    expect(await page({ n: '1/3' })).toContain('ДДВ 01-03 ·');
    const p = await print('1/3');
    expect(p).toContain('ДДВ 01-03');
    expect(p).not.toContain('УВЕЗЕН НАЛОГ 1/3</div>');
    expect(await print('1/4-6')).toContain('УВЕЗЕН НАЛОГ 1/4-6');
    const c = await csv();
    expect(c).toContain('Назив на налог');
    expect(c).toMatch(/1\/3;ДДВ 01-03;/);
    expect(c).toMatch(/1\/4-6;Увезен налог 1\/4-6;/);
    // the same number in 2025 keeps its own title
    useYear(2025);
    expect(await page()).toContain('Увезен налог 1/3');
    expect(await print('1/3')).toContain('УВЕЗЕН НАЛОГ 1/3');
    useYear(2026);
    const a = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'nalTitle'));
    expect(a.at(-1)!.data).toEqual({ year: 2026, number: '1/3', from: null, to: 'ДДВ 01-03' });
  });

  it('allowed in a locked period (no amounts change)', async () => {
    jar.set('wc_sess', owner);
    await pg.update(schema.firms).set({ lockDate: '2026-12-31' }).where(eq(schema.firms.id, firmId));
    expect(await rename('1/3', 'ДДВ Q1')).toEqual({ redirect: '/nalozi?n=1%2F3' });
    await pg.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
    expect(await print('1/3')).toContain('ДДВ Q1');
  });

  it('an empty name brings back the automatic title', async () => {
    jar.set('wc_sess', owner);
    await rename('1/3', '');
    expect(await page()).toContain('Увезен налог 1/3');
    expect(await print('1/3')).toContain('УВЕЗЕН НАЛОГ 1/3');
    expect(await csv()).toMatch(/1\/3;Увезен налог 1\/3;/);
  });

  it('an imported nalog opens in the manual editor with its lines and its name (not an empty document correction)', async () => {
    jar.set('wc_sess', owner);
    const j = await pg.transaction((tx) => postJournal(tx as never, { firmId, date: '2026-06-30', kind: 'manual', number: '4/4-6', description: 'Увезен налог 4/4-6',
      sourceType: 'import', sourceId: 'b1:4', userId: null, lines: [{ account: '230018', debit: 500 }, { account: '130018', credit: 500 }] }));
    await rename('4/4-6', 'ДДВ 04-06');
    const h = await page({ edit: j.id });
    expect(h).toContain('Корекција на налог 4/4-6');
    expect(h).toContain('ДДВ 04-06');
    expect(h).not.toContain('рачна корекција');
    expect(h).toContain('230018');
    expect(h).toContain('130018');
  });

  it('a viewer sees no ✎ Назив and cannot rename; an unknown nalog is refused', async () => {
    jar.set('wc_sess', viewer);
    expect(await page({ n: '1/3' })).not.toContain('✎ Назив');
    expect(await rename('1/3', 'X')).toHaveProperty('error');
    jar.set('wc_sess', owner);
    expect(await rename('9/9', 'X')).toEqual({ error: 'Налогот 9/9 не постои за 2026.' });
  });
});
