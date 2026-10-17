/**
 * „Изводи во налогот“: the owner opens the bank nalog (Финансово → Налози → Отвори 6/4-6) and does the statement work
 * right there — the konto of a line changed inside the nalog re-posts the statement (same totals), the bulk save
 * re-posts once, a locked period refuses, a user without `write` sees everything read-only (PGlite).
 */
import { asc, eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Statement } from '@wise/core';
import { bookStatementLines, saveBankAccount, saveImport, schema } from '@wise/db';
import { form, jar, pg, revalidated, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const NaloziPage = (await import('@/app/(app)/nalozi/page')).default;
const { setKontoAction } = await import('@/app/(app)/banka/actions');
const { saveStatementLinesAction } = await import('@/app/(app)/nalozi/statement-actions');

const halk = (): Statement => ({
  format: 'halk-xml', account: '270077299520174', no: '18', date: '2026-06-01', currency: 'MKD',
  opening: 5_115_800, closing: 1_237_900, debit: 3_877_900, credit: 0,
  lines: [
    { date: '2026-06-01', amount: -7_200, counterparty: 'Халкбанк АД Скопје', ref: '', purpose: 'Провизија за платен промет', desc: 'Провизија за платен промет', osnov: '666' },
    { date: '2026-06-01', amount: -19_300, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Персонален данок од плата 05/2026', desc: 'Буџет на РСМ – Персонален данок 05/2026', osnov: '840' },
    { date: '2026-06-01', amount: -20_000, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес за вработување 05/2026', desc: 'Буџет на РСМ – Придонес за вработување', osnov: '843' },
    { date: '2026-06-01', amount: -46_200, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'ДДВ 714116 за 04/2026', desc: 'Буџет на РСМ – ДДВ 714116', osnov: '840' },
    { date: '2026-06-01', amount: -167_900, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес за здравствено осигурување', desc: 'Буџет на РСМ – здравствено', osnov: '843' },
    { date: '2026-06-01', amount: -288_800, counterparty: 'Алфа ДОО', ref: '', purpose: 'Плаќање по договор', desc: 'Алфа ДОО – плаќање по договор', osnov: '220' },
    { date: '2026-06-01', amount: -723_900, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес ПИО 05/2026', desc: 'Буџет на РСМ – ПИО', osnov: '843' },
    { date: '2026-06-01', amount: -2_604_600, counterparty: 'Нов Добавувач ДООЕЛ', ref: '', purpose: 'Набавка на стока', desc: 'Нов Добавувач ДООЕЛ – набавка на стока', osnov: '200' },
  ],
});

let firmId = '', stId = '', number = '', owner = '', viewer = '', beta = '';
const html = async (n: string) => renderToStaticMarkup(await NaloziPage({ searchParams: Promise.resolve({ n }) }));
const stLines = () => pg.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, stId)).orderBy(asc(schema.bankLines.lineNo));
const jLines = async () => {
  const [j] = await pg.select().from(schema.journals).where(eq(schema.journals.sourceId, stId));
  return pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id)).orderBy(asc(schema.journalLines.lineNo));
};
const cents = (v: string) => Math.round(Number(v) * 100);
const totals = async () => { const L = await jLines(); return { D: L.reduce((s, l) => s + cents(l.debit), 0), P: L.reduce((s, l) => s + cents(l.credit), 0) }; };
const onK = async (k: string) => (await jLines()).filter((l) => l.account === k).reduce((s, l) => s + cents(l.debit), 0);

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Изводи во Налог ДООЕЛ' }).returning();
  firmId = f!.id;
  await pg.insert(schema.partners).values({ firmId, name: 'Алфа ДОО', code: '1' });
  beta = (await pg.insert(schema.partners).values({ firmId, name: 'Бета ДОО', code: '2' }).returning())[0]!.id;
  await pg.transaction((tx) => saveBankAccount(tx as never, { firmId, userId: null, input: { name: 'Халкбанк', account: '270077299520174', cur: 'MKD', konto: '1000' } }));
  const r = await pg.transaction((tx) => saveImport(tx as never, { firmId, userId: null, statements: [halk()], format: 'halk-xml' }));
  stId = r.statementIds![0]!;
  const b = await pg.transaction((tx) => bookStatementLines(tx as never, { firmId, userId: null, statementIds: [stId] }));
  expect(b.skipped).toEqual([]);
  number = b.posted.get(stId)!.number!;
  viewer = await signIn('view', { firms: [firmId] }); viewer = jar.get('wc_sess')!;
  await signIn('admin'); owner = jar.get('wc_sess')!;
  useFirm(firmId); useYear(2026);
}, 120_000);

describe('Изводи во налогот (open bank nalog)', () => {
  it('the open nalog lists the statement with ALL its lines and an editable konto per line', async () => {
    expect(number).toBe('6/4-6');
    const h = await html(number);
    expect(h).toContain('Изводи во налогот (1)');
    expect(h).toContain('Извод бр. 18');
    expect(h).toContain('✓ салдо');
    for (const p of ['Провизија за платен промет', 'Придонес ПИО 05/2026', 'Набавка на стока']) expect(h).toContain(p);
    expect(h.match(/aria-label="Конто"/g)).toHaveLength(8);
    expect(h).toContain('Зачувај ги сите промени');
    // the bank kontos are not offered as counter kontos
    expect(h).not.toMatch(/<datalist id="nalBkK2">[^]*?value="1000"[^]*?<\/datalist>/);
  });

  it('changing a konto inside the nalog re-posts the statement with the new konto; the totals stay', async () => {
    const before = await totals();
    const L = await stLines();
    const pio = L[6]!;
    expect(pio.konto).toBe('2341'); // „Придонес ПИО“ → the payroll scheme's ПИО konto (pay_pio)
    revalidated.length = 0;
    const r = await setKontoAction({}, form({ line: pio.id, konto: '2349', partner: '' }));
    expect(r.error).toBeUndefined();
    expect(revalidated).toContain('/nalozi');
    expect(await onK('2349')).toBe(723_900);
    expect(await totals()).toEqual(before);
    expect(before.D).toBe(before.P);
    const h = await html(number);
    expect(h).toMatch(/2349<\/b>|value="2349"/);
  });

  it('„Зачувај ги сите промени“ saves several lines, re-posting the statement once; untouched lines stay', async () => {
    const before = await totals();
    const L = await stLines();
    const posts0 = (await pg.select().from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId))).length;
    const items = [
      { lineId: L[1]!.id, konto: '2341', partnerId: null },
      { lineId: L[4]!.id, konto: '2341', partnerId: null },
      { lineId: L[5]!.id, konto: '2200', partnerId: beta },
    ];
    const r = await saveStatementLinesAction({}, form({ items: JSON.stringify(items) }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/Зачувани 3 ставки; прекнижани 1 изводи/);
    // the earlier hand edit (ПИО → 2349) is kept
    expect(await onK('2341')).toBe(19_300 + 167_900);
    expect(await onK('2349')).toBe(723_900);
    const JL = await jLines();
    expect(JL.some((l) => l.account === '2200' && l.partnerId === beta && cents(l.debit) === 288_800)).toBe(true);
    expect((await stLines())[0]!.konto).toBe('4460');
    expect(await totals()).toEqual(before);
    const audits = (await pg.select().from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId))).length;
    expect(audits - posts0).toBeGreaterThanOrEqual(3);
  });

  it('a locked period is refused and shown read-only with 🔒', async () => {
    await pg.update(schema.firms).set({ lockDate: '2026-06-30' }).where(eq(schema.firms.id, firmId));
    try {
      const L = await stLines();
      const r = await setKontoAction({}, form({ line: L[0]!.id, konto: '4400', partner: '' }));
      expect(r.error).toMatch(/заклучен/);
      const b = await saveStatementLinesAction({}, form({ items: JSON.stringify([{ lineId: L[0]!.id, konto: '4400', partnerId: null }]) }));
      expect(b.error).toMatch(/заклучен/);
      expect((await stLines())[0]!.konto).toBe('4460');
      const h = await html(number);
      expect(h).toContain('🔒 заклучен период');
      expect(h).not.toContain('aria-label="Конто"');
    } finally {
      await pg.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
    }
  });

  it('a user without write sees the statements read-only and cannot save', async () => {
    jar.set('wc_sess', viewer);
    try {
      const h = await html(number);
      expect(h).toContain('Изводи во налогот (1)');
      expect(h).toContain('Само преглед');
      expect(h).not.toContain('aria-label="Конто"');
      expect(h).not.toContain('Зачувај ги сите промени');
      const L = await stLines();
      expect((await setKontoAction({}, form({ line: L[0]!.id, konto: '4400', partner: '' }))).error).toBeTruthy();
      expect((await saveStatementLinesAction({}, form({ items: JSON.stringify([{ lineId: L[0]!.id, konto: '4400', partnerId: null }]) }))).error).toBeTruthy();
      expect((await stLines())[0]!.konto).toBe('4460');
    } finally {
      jar.set('wc_sess', owner);
    }
  });
});
