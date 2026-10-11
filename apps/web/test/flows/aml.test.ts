/**
 * AML / УФР workflow: monitoring of the books → alert queue (no duplicates) → documented decision → report to УФР with
 * its deadline → submission locks it → 10-year retention blocks deletion; permissions (client never, staff only the
 * internal report, owner / officer the module); the client's audit trail and backup never show AML work.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addMonths, amlDeadline, todaySkopje } from '@wise/core/office';
import { schema } from '@wise/db';
import { form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { proxy } = await import('@/proxy');
const U = await import('@/app/(app)/aml/ufr-actions');
const OA = await import('@/app/(app)/aml/office-actions');
const CA = await import('@/app/(app)/aml/actions');
const { exportFirm } = await import('@wise/db');

const td = todaySkopje();
const y = td.slice(0, 4);
let firmId = '', partnerId = '', adminId = '';
const reports = () => pg.select().from(schema.amlReports);

async function cash(date: string, amount: string, partner: string | null) {
  const [j] = await pg.insert(schema.journals).values({ firmId, date, kind: 'blagajna', number: `${date}-${amount}` }).returning();
  await pg.insert(schema.journalLines).values([
    { journalId: j!.id, firmId, lineNo: 1, account: '102', debit: amount },
    { journalId: j!.id, firmId, lineNo: 2, account: '120', credit: amount, partnerId: partner },
  ]);
}

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'КЛИЕНТ АМЛ ДООЕЛ', edb: '4030000000099' }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Готовински купувач', code: '1' }).returning();
  partnerId = p!.id;
  await cash(`${y}-03-02`, '922500.00', partnerId); // exactly 15.000 € at 61,5
  await cash(`${y}-03-10`, '500000.00', partnerId); // linked (Tue + Wed)
  await cash(`${y}-03-11`, '500000.00', partnerId);
  // a cash deposit to the bank (only money accounts) is not a client transaction
  const [t] = await pg.insert(schema.journals).values({ firmId, date: `${y}-03-12`, kind: 'nalog', number: 'T1' }).returning();
  await pg.insert(schema.journalLines).values([
    { journalId: t!.id, firmId, lineNo: 1, account: '100', debit: '2000000' }, { journalId: t!.id, firmId, lineNo: 2, account: '102', credit: '2000000' },
  ]);
}, 120_000);

describe('AML permissions', () => {
  it('a client never reaches the module, its print forms or its actions', async () => {
    await signIn('klient', { firms: [firmId] });
    useFirm(firmId);
    const req = (p: string) => new NextRequest(new URL(p, 'http://localhost'), { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const p of ['/aml', '/amlDoc?d=prog']) expect((await proxy(req(p))).headers.get('location')).toMatch(/\/klHome$/);
    expect((await U.amlScanRun({}, form({}))).error).toBeTruthy();
    expect((await OA.amlRepNew({}, form({ firmId, text: 'x' }))).error).toBeTruthy();
    expect((await CA.saveAml({}, form({}))).error).toBeTruthy();
  });
  it('staff may file an internal report but not open the officer work', async () => {
    await signIn('acc', { allFirms: true });
    useFirm(firmId);
    expect((await OA.amlRepNew({}, form({ firmId, text: 'Клиентот плаќа во готово за фиктивни услуги' }))).ok).toBeTruthy();
    expect((await U.amlScanRun({}, form({}))).error).toMatch(/Само сопственикот/);
    expect((await CA.saveAml({}, form({ rep_name: 'X' }))).error).toMatch(/Само сопственикот/);
    const [r] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'int');
    expect(r!.data).toMatchObject({ kind: 'int', due: amlDeadline('int', td) });
  });
});

describe('monitoring → decision → УФР report → retention', () => {
  it('scan finds the single and the linked cash transactions once, ignores the bank deposit', async () => {
    adminId = await signIn('admin');
    useFirm(firmId);
    const r1 = await U.amlScanRun({}, form({ firmId, from: `${y}-01-01`, to: `${y}-12-31` }));
    expect(r1.ok).toMatch(/Нови сигнали: 2/);
    const A = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'alert');
    expect(A.map((x) => (x.data as { rule: string }).rule).sort()).toEqual(['cash', 'cashLinked']);
    expect((await U.amlScanRun({}, form({ firmId, from: `${y}-01-01`, to: `${y}-12-31` }))).ok).toMatch(/Нема нови сигнали/);
    // the client's audit trail never shows AML work (ban on disclosure)
    const au = await pg.select().from(schema.auditLog).where(sql`${schema.auditLog.action} like 'aml%'`);
    expect(au.length).toBeGreaterThan(0);
    expect(au.every((a) => a.firmId === null)).toBe(true);
  });

  it('a decision needs a reason; a cash report gets 3 working days from the transaction; submission locks it', async () => {
    const [al] = (await reports()).filter((x) => (x.data as { rule?: string }).rule === 'cash');
    expect((await U.amlDecide({}, form({ id: al!.id, result: 'ctr' }))).error).toMatch(/образложение/);
    expect((await U.amlDecide({}, form({ id: al!.id, result: 'ctr', reason: 'Готовинска уплата ≥ 15.000 €' }))).ok).toBeTruthy();
    expect((await U.amlDecide({}, form({ id: al!.id, result: 'none', reason: 'x' }))).error).toMatch(/веќе/);
    const [ctr] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'ctr');
    expect(ctr!.data).toMatchObject({ src: al!.id, from: `${y}-03-02`, due: amlDeadline('ctr', `${y}-03-02`) });
    expect((await U.amlUfrSave({}, form({ id: ctr!.id, f_desc: 'опис' }))).ok).toBeTruthy();
    expect((await U.amlUfrSubmit({}, form({ id: ctr!.id, date: td }))).error).toMatch(/потврдата/);
    expect((await U.amlUfrSubmit({}, form({ id: ctr!.id, date: '2999-01-01', ufrNo: '1' }))).error).toMatch(/иднина/);
    expect((await U.amlUfrSubmit({}, form({ id: ctr!.id, date: td, ufrNo: 'УФР-123' }))).ok).toBeTruthy();
    expect((await U.amlUfrSave({}, form({ id: ctr!.id, f_desc: 'промена' }))).error).toMatch(/заклучен/);
    const [x] = await pg.select().from(schema.amlReports).where(eq(schema.amlReports.id, ctr!.id));
    expect(x!.status).toBe('пријавено во УФР');
    expect(x!.data).toMatchObject({ submitted: td, ufrNo: 'УФР-123', late: true });
  });

  it('an STR from an internal report is due within 24 hours', async () => {
    const [int] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'int');
    expect((await U.amlDecide({}, form({ id: int!.id, result: 'str', reason: 'Индикатор: фиктивни фактури' }))).ok).toBeTruthy();
    const [str] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'str');
    expect(str!.data).toMatchObject({ due: amlDeadline('str', td), src: int!.id });
  });

  it('nothing is deleted before 10 years; after that only by the owner', async () => {
    const [ctr] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'ctr');
    expect((await U.amlPurge(ctr!.id, 'report')).error).toMatch(/10 години/);
    const old = addMonths(td, -121);
    await pg.update(schema.amlReports).set({ data: sql`${schema.amlReports.data} || ${JSON.stringify({ submitted: old })}::jsonb` }).where(eq(schema.amlReports.id, ctr!.id));
    expect((await U.amlPurge(ctr!.id, 'report')).ok).toBeTruthy();
    expect(await pg.select().from(schema.amlReports).where(eq(schema.amlReports.id, ctr!.id))).toHaveLength(0);
    const au = await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'amlPurge'), isNull(schema.auditLog.firmId)));
    expect(au).toHaveLength(1);
  });
});

describe('client file (CDD)', () => {
  it('saves the file, creates the ЦРСМ discrepancy report, keeps the record out of the firm backup and restricts deletion', async () => {
    const r = await CA.saveAml({}, form({ rep_name: 'Петар Петров', rep_idNo: 'A123', rep_ver: true, bo0_name: 'Петар Петров', bo0_share: '100', bo0_ver: td,
      crsm_date: td, crsm_result: 'mismatch', crsm_note: 'во ЦРСМ друг удел', purpose: 'сметководство', source: 'промет', sanc_date: td, sanc_result: 'none', relStart: td }));
    expect(r.ok).toMatch(/чл\. 32/);
    const [rec] = await pg.select().from(schema.amlRecords).where(eq(schema.amlRecords.firmId, firmId));
    expect((rec!.data as { hist?: unknown[] }).hist).toHaveLength(1);
    const bo = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'bo');
    expect(bo).toHaveLength(1);
    expect((bo[0]!.data as { due: string }).due).toBe(amlDeadline('bo', td));
    // saving again does not duplicate the report
    await CA.saveAml({}, form({ rep_name: 'Петар Петров', crsm_date: td, crsm_result: 'mismatch' }));
    expect((await reports()).filter((x) => (x.data as { kind?: string }).kind === 'bo')).toHaveLength(1);
    const B = await exportFirm(pg as never, firmId);
    expect(JSON.stringify(B)).not.toContain('aml_records');
    expect((await U.amlPurge(firmId, 'client')).error).toMatch(/10 години/);
  });

  it('management approval for EDD only by the owner', async () => {
    const off = await signIn('acc', { allFirms: true });
    await OA.amlOffSet({}, form({ officer: 'X' })); // acc cannot appoint
    const s = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'aml'));
    expect((s[0]?.value as { officer?: string } | undefined)?.officer).toBeUndefined();
    await pg.insert(schema.appSettings).values({ key: 'aml', value: { officer: 'Офицер', offUid: off }, updatedBy: adminId })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: { officer: 'Офицер', offUid: off } } });
    useFirm(firmId);
    expect((await CA.saveAml({}, form({ pep: true, mgrOk: 'on' }))).error).toMatch(/раководството/);
    expect((await CA.saveAml({}, form({ pep: true, wealth: 'плата' }))).ok).toMatch(/high/);
  });
});

describe('screens and print forms render (smoke)', () => {
  type El = { type?: unknown; props?: { children?: unknown } & Record<string, unknown> };
  const SERVER = new Set<unknown>();
  async function walk(n: unknown): Promise<number> {
    if (!n || typeof n !== 'object') return 0;
    if (Array.isArray(n)) { let k = 0; for (const x of n) k += await walk(x); return k; }
    const e = n as El;
    let k = 0;
    if (SERVER.has(e.type)) { k++; k += await walk(await (e.type as (p: unknown) => unknown)(e.props)); }
    return k + await walk(e.props?.children);
  }
  it('every tab of /aml and every /amlDoc form', async () => {
    const tabs = [await import('@/app/(app)/aml/tab-tasks'), await import('@/app/(app)/aml/tab-client'), await import('@/app/(app)/aml/tab-monitor'),
      await import('@/app/(app)/aml/tab-reports'), await import('@/app/(app)/aml/tab-registers'), await import('@/app/(app)/aml/tab-office'), await import('@/app/(app)/aml/tab-proc')];
    for (const m of tabs) for (const v of Object.values(m)) SERVER.add(v);
    const page = (await import('@/app/(app)/aml/page')).default;
    await signIn('admin');
    useFirm(firmId);
    for (const tab of ['zad', 'cl', 'mon', 'rep', 'reg', 'off', 'proc']) expect(await walk(await page({ searchParams: Promise.resolve({ tab }) }))).toBeGreaterThan(0);
    const [r] = (await reports()).filter((x) => (x.data as { kind?: string }).kind === 'str');
    expect(await walk(await page({ searchParams: Promise.resolve({ tab: 'rep', id: r!.id }) }))).toBeGreaterThan(0);
    const doc = (await import('@/app/(print)/amlDoc/page')).default;
    for (const d of ['cdd', 'decl', 'prog', 'odl', 'self', 'ctl', 'conf']) expect(await doc({ searchParams: Promise.resolve({ d }) })).toBeTruthy();
    expect(await doc({ searchParams: Promise.resolve({ d: 'ufr', id: r!.id }) })).toBeTruthy();
  });
});
