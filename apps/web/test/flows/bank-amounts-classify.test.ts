/**
 * Statement screen fixes (PGlite, server actions): amounts with dots as thousands separators („12.000“, „1.234.567“)
 * are read as such and an unreadable amount is an error (compensation, statement header, manual line) instead of
 * a silent skip; an AI proposal on a partner konto keeps the line's partner; the nalog shows „корекцијата … не е
 * применета“ whenever an edit was dropped (also next to applied ones).
 */
import { and, eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addManualLine, saveBankAccount, schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

const props: { id: string; konto?: string; reason: string }[] = [];
vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
vi.mock('@/app/(app)/banka/classify', () => ({ bankClassifyProposals: async () => props, classifyInput: async () => ({ open: [] }) }));
vi.mock('@/app/(app)/banka/paynotes', () => ({ runPayNotes: async () => undefined }));

const { amt, badAmt, num } = await import('@/lib/bank');
const { addManualLineAction, updateStatementAction } = await import('@/app/(app)/banka/actions');
const { applyBankClassifyAction } = await import('@/app/(app)/banka/classify-actions');
const { saveKompAction } = await import('@/app/(app)/kompenzacii/actions');
const NaloziPage = (await import('@/app/(app)/nalozi/page')).default;

let firmId = '', acct = '', partner = '';
const lineOf = async (desc: string) => (await pg.select().from(schema.bankLines).where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.description, desc))))[0]!;

beforeAll(async () => {
  await setupDb();
  firmId = (await pg.insert(schema.firms).values({ name: 'Износи ДООЕЛ' }).returning())[0]!.id;
  partner = (await pg.insert(schema.partners).values({ firmId, name: 'Гама ДОО', code: '7' }).returning())[0]!.id;
  acct = await pg.transaction((tx) => saveBankAccount(tx as never, { firmId, userId: null, input: { name: 'Халкбанк', cur: 'MKD', konto: '100077' } }));
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('amounts typed in the bank forms', () => {
  it('dots as thousands separators; decimals kept; rates keep three decimals', () => {
    expect(['12.000', '1.234.567', '1.234.567,5', '12.5', '12,5', '1.234,56', '1,234.56', '-1.500', ''].map((v) => amt(v))).toEqual([12000, 1234567, 1234567.5, 12.5, 12.5, 1234.56, 1234.56, -1500, null]);
    expect(num('61.495')).toBe(61.495);
    expect([badAmt('12a'), badAmt(''), badAmt('1.234.567')]).toEqual([true, false, false]);
  });

  it('manual line: „12.000“ is 12000; an unreadable amount is an error', async () => {
    expect((await addManualLineAction({}, form({ acct, date: '2026-02-03', dir: 'in', amount: '12.000', desc: 'Уплата Гама', konto: '1200', partner })))).toMatchObject({ ok: expect.any(String) });
    expect((await lineOf('Уплата Гама')).amount).toBe('12000.00');
    expect(await addManualLineAction({}, form({ acct, date: '2026-02-03', dir: 'in', amount: '12x', desc: 'Лошо' }))).toEqual({ error: 'Неважечки износ.' });
  });

  it('statement header: „1.234.567“ is saved, an unreadable balance is refused', async () => {
    const st = (await lineOf('Уплата Гама')).statementId;
    expect((await updateStatementAction({}, form({ st, opening: '1.234.567', closing: '1.246.567' }))).error).toBeUndefined();
    const [s] = await pg.select().from(schema.bankStatements).where(eq(schema.bankStatements.id, st));
    expect([s!.opening, s!.closing]).toEqual(['1234567.00', '1246567.00']);
    expect((await updateStatementAction({}, form({ st, opening: 'abc' }))).error).toMatch(/Неважечки износ: почетно салдо/);
  });

  it('compensation: an unreadable amount is an error, not a skipped row', async () => {
    const r = await saveKompAction({}, form({ date: '2026-02-05', 'amt:a': 'x12', 'doc:a': 'Ф-1', 'side:a': 'rec', 'amt:b': '100', 'side:b': 'pay' }));
    expect(r.error).toBe('Неважечки износ: Ф-1');
  });
});

describe('AI classification', () => {
  it('a proposal on a partner konto keeps the line\'s partner', async () => {
    const id = await pg.transaction((tx) => addManualLine(tx as never, { firmId, userId: null, bankAccountId: acct, date: '2026-05-04', amount: 300, desc: 'Аванс Гама', konto: '2200', partnerId: partner }));
    props.splice(0, props.length, { id, konto: '1200', reason: 'уплата од купувач' });
    expect((await applyBankClassifyAction({}, form({ ai: '', accept: id }))).error).toBeUndefined();
    const l = await lineOf('Аванс Гама');
    expect([l.konto, l.partnerId, l.auto]).toEqual(['1200', partner, 'ai']);
  });
});

describe('nalog with a dropped correction', () => {
  it('the warning shows whenever an edit was dropped, also next to applied ones', async () => {
    const st = (await lineOf('Уплата Гама')).statementId;
    const [j] = await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceId, st)));
    await pg.update(schema.journals).set({ meta: { ...((j!.meta ?? {}) as object), override: { applied: 1, dropped: 1 } } }).where(eq(schema.journals.id, j!.id));
    const html = renderToStaticMarkup(await NaloziPage({ searchParams: Promise.resolve({ n: j!.number }) }));
    expect(html).toContain('Налогот е рачно коригиран');
    expect(html).toContain('не е применета');
  });
});
