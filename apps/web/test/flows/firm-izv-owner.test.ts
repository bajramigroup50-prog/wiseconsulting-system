/**
 * „🗂 Целосен извештај за фирма“ — office OWNER only: another administrator, an accountant and a client are refused by
 * the page, the server action, the print view and the Word route. The owner picks ANY firm (the selected-firm cookie is
 * not used and not changed) and gets the report computed from the books (VAT, payroll / МПИН, deadlines, findings with
 * law + article), printable and as Word; „💲 AI анализа“ is queued with numbers and findings only and refused while the
 * AI budget is paused.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FIRM_REPORT_AI_JOB } from '@wise/core/office/firm-report';
import { postJournal, putAiBudget, schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm } from '../harness';

const jobs: [string, Record<string, unknown>][] = [];
vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: Record<string, unknown>) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));
// rendered outside the app router (the page's client components only render here)
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const Page = (await import('@/app/(app)/firmIzv/page')).default;
const Print = (await import('@/app/print/firmIzv/page')).default;
const Word = await import('@/app/(app)/firmIzv/word/route');
const A = await import('@/app/(app)/firmIzv/actions');
const { docxText } = await import('@/lib/docx');

const MSG = 'Само за сопственикот на канцеларијата.';
const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
let fa = '', fb = '';
const Y = new Date().getFullYear();

beforeAll(async () => {
  await setupDb();
  const [a, b] = await pg.insert(schema.firms).values([
    { name: 'АЛФА ИЗВЕШТАЈ ДООЕЛ', edb: '4030000000123', city: 'Скопје', address: 'ул. 1', vatRegistered: true },
    { name: 'БЕТА ДРУГА ДОО', edb: '4030000000456', vatRegistered: false },
  ]).returning();
  fa = a!.id; fb = b!.id;
  for (const [k, role, firms] of [['owner', 'admin', []], ['admin2', 'admin', []], ['acc', 'acc', [fa]], ['kl', 'klient', [fa]]] as const) {
    const id = await signIn(role, { username: `fi_${k}`, ...(firms.length ? { firms: [...firms] } : {}) });
    if (k === 'owner') await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, id));
    S[k] = jar.get('wc_sess')!;
  }
  // demo books of A: a sale in January, an employee with a calculated January payroll
  const [p] = await pg.insert(schema.partners).values({ firmId: fa, name: 'Купувач Демо', code: '001' }).returning();
  await pg.transaction((tx) => postJournal(tx as never, { firmId: fa, date: `${Y}-01-10`, kind: 'manual', lines: [{ account: '1200', debit: 1180, partnerId: p!.id }, { account: '7400', credit: 1180 }], userId: null }));
  await pg.insert(schema.employees).values({ firmId: fa, name: 'Демо Вработен', active: true });
  await pg.insert(schema.payrollRuns).values({ firmId: fa, month: `${Y}-01`, date: `${Y}-01-31`, params: {}, status: 'posted', totals: { gross: 50000, net: 34000, contr: 14000, tax: 2000, emps: 1 } });
}, 120_000);

const q = (o: Record<string, string>) => Promise.resolve(o);
const word = (qs: string) => Word.GET(new Request(`http://localhost/firmIzv/word?${qs}`));

describe('firmIzv — office owner only', () => {
  it('others are refused: page, action, print view, Word route', async () => {
    for (const who of ['admin2', 'acc']) {
      as(who);
      useFirm(fa);
      const h = await html(Page({ searchParams: q({ f: fa }) }));
      expect(h).toContain(MSG);
      expect(h).not.toContain('АЛФА ИЗВЕШТАЈ');
      expect(await A.firmReportAiAction(fa, Y, null)).toEqual({ error: MSG });
      const pr = await html(Print({ searchParams: q({ f: fa }) }));
      expect(pr).toContain(MSG);
      expect(pr).not.toContain('АЛФА ИЗВЕШТАЈ');
      expect((await word(`f=${fa}`)).status).toBe(403);
    }
    as('kl');
    useFirm(fa);
    await expect(Page({ searchParams: q({ f: fa }) })).rejects.toThrow();
    await expect(Print({ searchParams: q({ f: fa }) })).rejects.toThrow();
    expect(await A.firmReportAiAction(fa, Y, null)).toEqual({ error: MSG });
    expect((await word(`f=${fa}`)).status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('every server action, the page, the print view and the Word route check the owner', () => {
    const X = src('app/(app)/firmIzv/actions.ts');
    const fns = [...X.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    expect(fns.map((m) => m[1])).toEqual(['firmReportAiAction']);
    for (const [, name, body] of fns) expect(body, name).toMatch(/await fiOwnerAction\(\)/);
    expect(X).not.toMatch(/currentFirm\(|officeAction\(/);
    expect(src('app/(app)/firmIzv/page.tsx')).toMatch(/await fiOwnerUser\(\)/);
    expect(src('app/print/firmIzv/page.tsx')).toMatch(/await fiOwnerUser\(\)/);
    expect(src('app/(app)/firmIzv/word/route.ts')).toMatch(/if \(!u\) return new Response\('Forbidden', \{ status: 403 \}\)/);
    expect(src('app/(app)/firmIzv/lib.ts')).toMatch(/isOfficeOwner\(u\)/);
  });

  it('the owner reports on any firm (not the selected one): sections, VAT, payroll, deadlines, findings with law', async () => {
    as('owner');
    useFirm(fb); // the selected firm is another one — it stays selected
    const picker = await html(Page({ searchParams: q({}) }));
    expect(picker).toContain('АЛФА ИЗВЕШТАЈ ДООЕЛ');
    expect(picker).toContain('БЕТА ДРУГА ДОО');
    const h = await html(Page({ searchParams: q({ f: fa, y: String(Y) }) }));
    expect(jar.get('wc_fid')).toBe(fb);
    for (const t of ['ЦЕЛОСЕН ИЗВЕШТАЈ ЗА ФИРМА', 'АЛФА ИЗВЕШТАЈ ДООЕЛ', '1. Основни податоци', '4. ДДВ', '5. Плати и МПИН', '7. Рокови', '8. Законска усогласеност и контроли', '11. Заклучок', 'ДДВ-04', '✗ проблем']) expect(h, t).toContain(t);
    expect(h).toMatch(/ЗДДВ чл\. \d+/);
    expect(h).toContain('50.000,00'); // the January payroll gross from the books
    expect(h).toContain('1.180,00'); // the sale
    expect(h).toContain(`/print/firmIzv?f=${fa}&amp;y=${Y}`);
    expect(h).toContain(`/firmIzv/word?f=${fa}&amp;y=${Y}`);
    expect(h).toContain('data-go="1"');
    const pr = await html(Print({ searchParams: q({ f: fa, y: String(Y) }) }));
    expect(pr).toContain('class="pdfdoc"');
    expect(pr).toContain('АЛФА ИЗВЕШТАЈ ДООЕЛ');
    expect(pr).not.toContain('data-go');
    const w = await word(`f=${fa}&y=${Y}`);
    expect(w.status).toBe(200);
    expect(w.headers.get('content-type')).toMatch(/wordprocessingml/);
    const t = docxText(new Uint8Array(await w.arrayBuffer()));
    expect(t).toContain('ЦЕЛОСЕН ИЗВЕШТАЈ ЗА ФИРМА');
    expect(t).toContain('11. Заклучок');
  });

  it('„💲 AI анализа“: queued with numbers and findings only (no names, ЕДБ); refused while the AI budget is paused', async () => {
    as('owner');
    useFirm(fb);
    const r = await A.firmReportAiAction(fa, Y, null);
    expect(r).toHaveProperty('ok');
    expect(jobs.at(-1)![0]).toBe(FIRM_REPORT_AI_JOB);
    expect(jobs.at(-1)![1]).toMatchObject({ firmId: fa, year: Y });
    const [st] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, `firmIzvAi:${fa}:${Y}`));
    const v = st!.value as { status: string; reqId: string; payload: unknown };
    expect(v.status).toBe('queued');
    expect(v.reqId).toBe(jobs.at(-1)![1].reqId);
    const P = JSON.stringify(v.payload);
    for (const s of ['АЛФА ИЗВЕШТАЈ', '4030000000123', 'Купувач Демо', 'Демо Вработен', 'fi_owner']) expect(P, s).not.toContain(s);
    expect(P).toContain('"revenue":1180');
    const [a] = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'frAi'));
    expect(a).toMatchObject({ firmId: fa, entityId: fa });
    // the screen shows the request
    expect(await html(Page({ searchParams: q({ f: fa, y: String(Y) }) }))).toContain('AI ја пишува анализата');
    // paused budget: refused, nothing queued
    await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, `firmIzvAi:${fa}:${Y}`));
    await putAiBudget(pg as never, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: 'x', costUsd: '2.000000' });
    const n = jobs.length;
    const r2 = await A.firmReportAiAction(fa, Y, null);
    expect(r2.error).toMatch(/AI е паузиран/);
    expect(jobs.length).toBe(n);
  });
});
