/**
 * Workflow 4 — payroll month through the real server actions and route handlers on PGlite: two employees (Вработени
 * form) → new month → F4 (save + post) → payslips → МПИН TXT / XLSX → ПП for the salaries → „Плати – сите фирми“.
 */
import { and, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRun, schema } from '@wise/db';
import { act, form, pg, r2, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const { saveEmployee } = await import('@/app/(app)/vraboteni/actions');
const { createRun, saveRunAction } = await import('@/app/(app)/plati/actions');
const { confirmBatch } = await import('@/app/(app)/payBatch/actions');
const mpin = await import('@/app/(app)/plati/[month]/mpin/route');
const pecati = await import('@/app/(app)/plati/[month]/pecati/route');
const nalozi = await import('@/app/(app)/plati/[month]/nalozi/route');

const MONTH = '2026-04';
let firmId = '', firm2 = '';
let net = 0;
const P = (month: string) => ({ params: Promise.resolve({ month }) });

beforeAll(async () => {
  await setupDb();
  const F = await pg.insert(schema.firms).values([
    { name: 'ПЛАТИ ТЕСТ ДООЕЛ', edb: '4030026000123', embs: '7000123', city: 'Скопје', address: 'ул. Втора 2', settings: { bank: '300000000012355', opstina: '1' } },
    { name: 'ВТОРА ФИРМА ДОО', edb: '4030026000456', embs: '7000456', city: 'Битола', settings: {} },
  ]).returning();
  firmId = F[0]!.id; firm2 = F[1]!.id;
  await signIn('admin');
  useFirm(firmId);
}, 120_000);

describe('flow 4 — payroll', () => {
  it('two employees through the employee form', async () => {
    for (const [name, embg, net] of [['Ана Петрова', '0101990455001', '30000'], ['Борис Илиев', '0202985450002', '45000']] as const) {
      const r = await act(saveEmployee({}, form({ name, embg, netBase: net, start: '2020-03-01', bankAcc: '210000000000074', bank: 'НЛБ', active: true })));
      expect(r).toEqual({ redirect: '/vraboteni' });
    }
    const E = await pg.select().from(schema.employees).where(eq(schema.employees.firmId, firmId));
    expect(E.map((e) => [e.no, e.name]).sort()).toEqual([['1', 'Ана Петрова'], ['2', 'Борис Илиев']]);
  });

  it('new month (calendar) and F4: the run is calculated and posted with a balanced journal', async () => {
    expect(await act(createRun({}, form({ month: MONTH, mode: 'cal' })))).toEqual({ redirect: `/plati/${MONTH}` });
    const run = (await loadRun(pg as never, firmId, { month: MONTH }))!;
    expect(run.emps).toHaveLength(2);
    const r = await saveRunAction({ month: MONTH, runId: run.id, params: run.params, emps: run.emps, post: true });
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/прокнижена/);
    const [rr] = await pg.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id));
    expect(rr!.status).toBe('posted');
    const L = await pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, rr!.journalId!));
    const d = r2(L.reduce((s, l) => s + Number(l.debit), 0)), c = r2(L.reduce((s, l) => s + Number(l.credit), 0));
    expect(d).toBe(c);
    // net pay = the base nets 30 000 + 45 000 plus past-service (минат труд) for 6 and 10 years
    net = r2(rr!.totals.net ?? 0);
    expect(net).toBeGreaterThan(75000);
    expect(net).toBeLessThan(80000);
    expect(rr!.totals.gross ?? 0).toBeGreaterThan(net * 1.3);
    // the journal carries the net as the liability to the employees
    const cr: Record<string, number> = {};
    for (const l of L) cr[l.account] = r2((cr[l.account] ?? 0) + Number(l.credit));
    expect(Object.values(cr), JSON.stringify(cr)).toContain(net);
  });

  it('payslips print with both employees and their net pay', async () => {
    const res = await pecati.GET(new Request(`http://x/plati/${MONTH}/pecati`), P(MONTH));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Ана Петрова');
    expect(html).toContain('Борис Илиев');
    expect(html).toMatch(/30[.\s]?000,00/);
    expect(html).toMatch(/45[.\s]?000,00/);
  });

  it('МПИН TXT (windows-1251) and XLSX with the right totals; both archived', async () => {
    const t = await mpin.GET(new Request(`http://x/plati/${MONTH}/mpin?force=1`), P(MONTH));
    expect(t.status).toBe(200);
    expect(t.headers.get('content-type')).toMatch(/windows-1251/);
    const txt = new TextDecoder('windows-1251').decode(new Uint8Array(await t.arrayBuffer()));
    expect(txt).toContain('0101990455001');
    expect(txt).toContain('4030026000123');
    const x = await mpin.GET(new Request(`http://x/plati/${MONTH}/mpin?f=xlsx`), P(MONTH));
    expect(x.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await x.arrayBuffer()), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 });
    const body = rows.filter((r) => Array.isArray(r) && /^\d{13}$/.test(String(r[2] ?? '')));
    expect(body).toHaveLength(2);
    const head = rows.find((r) => Array.isArray(r) && r.includes('Нето плата')) as unknown[];
    const iNet = head.indexOf('Нето плата');
    expect(r2(body.reduce((s: number, r) => s + Number((r as unknown[])[iNet]), 0))).toBe(net);
    const X = await pg.select({ k: schema.payrollExports.kind }).from(schema.payrollExports).where(eq(schema.payrollExports.firmId, firmId));
    expect(X.map((r) => r.k).sort()).toEqual(['mpin-txt', 'mpin-xlsx']);
  });

  it('payment orders for the salaries: ПП30 per employee for the net, ПП50 for the contributions', async () => {
    const res = await nalozi.GET(new Request(`http://x/plati/${MONTH}/nalozi?datum=2026-05-10&csv=1`), P(MONTH));
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split(/\r?\n/).slice(1);
    expect(lines).toHaveLength(2);
    // the bank list pays exactly the posted net
    expect(r2(lines.reduce((s, l) => s + Number(l.split(';')[4]!.replace(',', '.')), 0))).toBe(net);
    const html = await (await nalozi.GET(new Request(`http://x/plati/${MONTH}/nalozi?datum=2026-05-10`), P(MONTH))).text();
    expect(html).toMatch(/ПП ?50|ПП50/);
  });

  it('„Плати – сите фирми“ books the month for every firm with employees', async () => {
    await pg.insert(schema.employees).values({ firmId: firm2, no: '1', name: 'Венко Ристов', embg: '0303980450003', netBase: '25000', start: '2019-01-01' });
    const r = await confirmBatch('2026-05', 'cal', [firmId, firm2]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/Прокнижени: 2/);
    for (const f of [firmId, firm2]) {
      const [run] = await pg.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.firmId, f), eq(schema.payrollRuns.month, '2026-05')));
      expect(run!.status).toBe('posted');
    }
    // a second run does not book again
    const again = await confirmBatch('2026-05', 'cal', [firmId, firm2]);
    expect(again.ok).toMatch(/Прокнижени: 0/);
  });
});
