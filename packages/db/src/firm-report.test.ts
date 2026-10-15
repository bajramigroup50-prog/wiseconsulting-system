/**
 * „🗂 Целосен извештај за фирма“ on a PGlite firm with demo books: every section is computed from the existing domain
 * functions (VAT periods, payroll + МПИН, the deadline calendar, findings with law + article and the stored article
 * text), another firm's data never leaks in, and a failing section does not fail the report.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { firmReportHtml, frAiCheck, frAiPayload, frAiPrompt, frConclusion } from '@wise/core/office/firm-report';
import { computeFirmReport, firmReportWindow } from './firm-report';
import { storeLawText } from './law-search';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import type { Tx } from './audit';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let A = '', B = '', user = '', pA = '';
const TODAY = '2026-10-14';

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(pg);
  const [u] = await pg.insert(schema.users).values({ username: 'acc1', name: 'Сметководител Петров', role: 'acc', passwordHash: 'x' }).returning();
  user = u!.id;
  const [a] = await pg.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000011', embs: '7000001', address: 'Улица 1', city: 'Скопје', legalForm: 'dooel', vatRegistered: true, ownerId: user }).returning();
  const [b] = await pg.insert(schema.firms).values({ name: 'Бета ДОО', edb: '4030000000022', vatRegistered: true }).returning();
  A = a!.id; B = b!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId: A, name: 'Купувач Тајни ДОО', code: '001', edb: '4030999000001' }).returning();
  pA = p!.id;
  // demo books: sales 1.000 (customer) + 300 cash in March, an expense 400 in May, last year 500 revenue
  await pg.transaction((tx) => postJournal(tx, { firmId: A, date: '2026-03-10', kind: 'manual', lines: [{ account: '1200', debit: 1000, partnerId: pA }, { account: '7400', credit: 1000 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: A, date: '2026-03-11', kind: 'manual', lines: [{ account: '1020', debit: 300 }, { account: '7400', credit: 300 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: A, date: '2026-05-02', kind: 'manual', lines: [{ account: '4410', debit: 400 }, { account: '1020', credit: 400 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: A, date: '2025-03-10', kind: 'manual', lines: [{ account: '1020', debit: 500 }, { account: '7400', credit: 500 }], userId: null }));
  // B: a big amount that must never appear in A's report
  const [pb] = await pg.insert(schema.partners).values({ firmId: B, name: 'Тајна Бета', code: '001' }).returning();
  await pg.transaction((tx) => postJournal(tx, { firmId: B, date: '2026-03-10', kind: 'manual', lines: [{ account: '1200', debit: 987654.32, partnerId: pb!.id }, { account: '7400', credit: 987654.32 }], userId: null }));
  // payroll: an employee, September calculated and booked with an accepted МПИН; August only a draft
  await pg.insert(schema.employees).values({ firmId: A, name: 'Вработен Тестовски', active: true });
  await pg.insert(schema.payrollRuns).values({ firmId: A, month: '2026-09', date: '2026-09-30', params: {}, status: 'posted', totals: { gross: 60000, net: 40000, contr: 16800, tax: 3200, emps: 1 } });
  await pg.insert(schema.payrollRuns).values({ firmId: A, month: '2026-08', date: '2026-08-31', params: {}, status: 'draft', totals: { gross: 60000, net: 40000, contr: 16800, tax: 3200, emps: 1 } });
  await pg.insert(schema.mpinAcks).values({ firmId: A, month: '2026-09', no: 'МП-77', status: 'ПРИФАТЕНА', gross: '60000', net: '40000', total: '60000' });
  // the stored law text the VAT finding cites
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ (30.12.2025)', asOf: '2025-12-30', text: 'Член 1\nОвој закон го уредува данокот на додадена вредност.\n\nЧлен 41\nДаночниот обврзник е должен да поднесе даночна пријава и да го плати данокот до 25-ти во месецот по даночниот период.' });
}, 120_000);

describe('computeFirmReport', () => {
  it('window: the current year up to today, last year the same period', () => {
    expect(firmReportWindow(2026, null, TODAY)).toEqual({ from: '2026-01-01', to: TODAY, prevFrom: '2025-01-01', prevTo: '2025-10-14' });
    expect(firmReportWindow(2025, null, TODAY).to).toBe('2025-12-31');
    expect(firmReportWindow(2024, '2024-02-29', TODAY).prevTo).toBe('2023-02-28');
  });

  it('computes every section from the books: income, money, VAT, payroll, deadlines, findings with law + article', async () => {
    const R = (await computeFirmReport(db, { firmId: A, year: 2026, today: TODAY, owner: true, userId: user }))!;
    const S = R.sections;
    for (const [k, s] of Object.entries(S)) expect(s.error, k).toBeUndefined();
    // 1. basic data
    expect(S.osnovni.data).toMatchObject({ name: 'Алфа ДООЕЛ', edb: '4030000000011', vat: 'quarter', responsible: 'Сметководител Петров' });
    expect(S.osnovni.data!.legalFormName).toMatch(/ДООЕЛ/);
    expect(S.osnovni.issues.some((i) => /Нема договор/.test(i.txt))).toBe(true);
    // 2. income: by month and cumulative, last year's same period
    expect(S.prihodi.data!.tot).toEqual({ rev: 1300, exp: 400, res: 900 });
    expect(S.prihodi.data!.prev.rev).toBe(500);
    expect(S.prihodi.data!.months.find((m) => m.m === '2026-05')).toMatchObject({ exp: 400, cumRev: 1300, cumRes: 900 });
    expect(S.prihodi.data!.months).toHaveLength(10);
    // 3. money and receivables (no invoice documents → nothing open)
    expect(S.finansii.data).toMatchObject({ cash: -100 });
    expect(S.finansii.data!.cashNeg.negDays).toBeGreaterThan(100);
    expect(S.finansii.issues[0]).toMatchObject({ sev: 'bad', area: 'Благајна', go: '/blagajna' });
    // 4. VAT: quarterly periods up to today; past ones not closed → ✗ with ЗДДВ чл. 41
    const P = S.ddv.data!.periods.map((p) => p.period);
    expect(P).toEqual(['2026-Т1', '2026-Т2', '2026-Т3', '2026-Т4']);
    expect(S.ddv.data!.periods[0]).toMatchObject({ due: '2026-04-25', closed: false, late: true });
    expect(S.ddv.status).toBe('bad');
    const v = S.ddv.issues.find((i) => i.txt.includes('2026-Т1'))!;
    expect(v.law).toMatch(/ЗДДВ чл\. 41/);
    // 5. payroll + МПИН
    const sep = S.plati.data!.months.find((m) => m.month === '2026-09')!;
    expect(sep).toMatchObject({ gross: 60000, net: 40000, contr: 16800, tax: 3200, mpin: { no: 'МП-77', accepted: true } });
    expect(S.plati.data!.employees).toBe(1);
    expect(S.plati.issues.some((i) => i.txt.includes('2026-08') && /нацрт/.test(i.txt))).toBe(true);
    expect(S.plati.issues.some((i) => i.sev === 'bad' && i.txt.includes('2026-07'))).toBe(true);
    // 7. deadlines from the calendar: ДДВ-04 for Т3 due 26.10 is upcoming, Т1 / Т2 missed
    expect(S.rokovi.data!.upcoming.some((d) => d.href === '/ddv' && d.date === '2026-10-26')).toBe(true);
    expect(S.rokovi.data!.overdue.some((d) => d.href === '/ddv')).toBe(true);
    expect(S.rokovi.status).toBe('bad');
    // 8. legal: the tax review rules with law + article, the stored article text with its version date
    const law = S.zakon.issues.filter((i) => i.src === 'lawrep');
    expect(law.length).toBeGreaterThan(0);
    // every rule names its law; the article where the rule has one (some rules are a rate, e.g. „данок 10% на камата“)
    expect(law.every((i) => /Закон за/.test(i.law ?? ''))).toBe(true);
    expect(S.zakon.issues.filter((i) => /чл\. \d+/.test(i.law ?? '')).length).toBeGreaterThan(2);
    expect(S.zakon.issues.some((i) => i.src === 'cmp' && /ЗЗЛП чл\. 32/.test(i.law ?? ''))).toBe(true);
    expect(S.zakon.data!.aml).toBeNull();
    expect(S.zakon.issues.some((i) => i.src === 'aml')).toBe(true);
    expect(S.zakon.data!.lawrep).not.toBeNull();
    expect(S.zakon.data!.yearend).not.toBeNull();
    // the stored article text (with its version date) is attached to the finding that cites it (ЗДДВ чл. 41)
    const c41 = S.zakon.issues.find((i) => /ЗДДВ чл\. 41\b/.test(i.law ?? ''));
    expect(c41?.lawText?.[0]).toMatchObject({ ref: 'ЗДДВ чл. 41', asOf: '2025-12-30' });
    expect(c41!.lawText![0]!.body).toContain('25-ти во месецот');
    // 9 / 10
    expect(S.dokumenti.data!.months.find((m) => m.m === '2026-03')).toMatchObject({ jour: 2 });
    expect(S.ai.data).toMatchObject({ total: 0, calls: 0 });
    // never the other firm
    expect(JSON.stringify(R)).not.toContain('987654');
    expect(JSON.stringify(R)).not.toContain('Бета ДОО');
    // the conclusion: problems before warnings, each with a screen
    const C = frConclusion(R);
    expect(C.bad).toBeGreaterThan(0);
    expect(C.items[0]!.sev).toBe('bad');
    expect(C.items.every((i) => i.go)).toBe(true);
    // HTML: badges, the law, Word without tables
    const H = firmReportHtml(R, { mode: 'screen' });
    expect(H).toContain('✗ проблем');
    expect(H).toContain('ЗДДВ чл. 41');
    expect(H).toContain('data-go="1"');
    const Wd = firmReportHtml(R, { mode: 'word' });
    expect(Wd).not.toContain('<table');
    expect(Wd).toContain('11. Заклучок');
  });

  it('the AI payload carries numbers and findings only — no names, ЕДБ or personal data', async () => {
    const R = (await computeFirmReport(db, { firmId: A, year: 2026, today: TODAY, owner: true }))!;
    const X = frAiPayload(R, ['Купувач Тајни ДОО', 'Вработен Тестовски', 'Сметководител Петров']);
    const prompt = frAiPrompt(X);
    for (const s of ['Алфа ДООЕЛ', '4030000000011', '7000001', 'Улица 1', 'Купувач Тајни', 'Вработен Тестовски', 'Сметководител Петров', '4030999000001']) expect(prompt, s).not.toContain(s);
    expect(prompt).toContain('"revenue":1300');
    expect(prompt).toMatch(/ЗДДВ чл\. 41/);
    // an article outside the context is tagged
    const c = frAiCheck('Според чл. 41 ЗДДВ треба да се поднесе пријава, а според чл. 999 ЗДДВ нешто друго.', X);
    expect(c.text).toContain('чл. 999 ЗДДВ [треба да се провери]');
    expect(c.text).not.toContain('чл. 41 ЗДДВ [треба');
    expect(c.unverified).toEqual(['чл. 999 ЗДДВ']);
  });

  it('a section that fails shows its error; the rest of the report is still there', async () => {
    const R = (await computeFirmReport(db, { firmId: B, year: 2026, today: TODAY, owner: false }))!;
    expect(R.sections.prihodi.data!.tot.rev).toBe(987654.32);
    expect(R.sections.osnovni.data!.contract).toBeNull(); // not the owner: no contract / fees
    expect(await computeFirmReport(db, { firmId: '00000000-0000-0000-0000-000000000000', year: 2026, today: TODAY, owner: true })).toBeNull();
  });
});
