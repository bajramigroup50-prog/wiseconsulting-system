/**
 * „⏸ За проверка – минат период“ workflow: „Зачувај ги сите спремни“ holds the scanned invoices dated in a past VAT
 * period, the scan screen and the inbox show them with a count, only the owner / `fix` / `settings` decide (a
 * colleague sees them without the buttons), a confirm „во својот период“ lands in „Корекции на ДДВ-04 потребни“ on the
 * ДДВ-04 screen. Synthetic firm; the dates are relative to today (the previous quarter).
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { periodOf, perRange } from '@wise/core';
import { addDays, todaySkopje } from '@wise/core/office/dates';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/lib/jobs', () => ({ enqueue: async () => 'job', renderPdf: async () => 'x' }));

const { saveSalesOk, confirmPastAction, rejectPastAction, setPastHoldAction } = await import('@/app/(app)/skan/actions');
const { ScanCenter } = await import('@/components/sales/scan-center');
const { default: PristPage } = await import('@/app/(app)/prist/page');
const { default: DdvPage } = await import('@/app/(app)/ddv/page');

const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let A = '', cust = '', docId = '';
const today = todaySkopje();
const curFrom = perRange(periodOf(today, 'quarter'))[0];
const PAST = addDays(curFrom, -20);
const PAST_P = periodOf(PAST, 'quarter');
const draft = (number: string, date: string) => ({
  draft: { number, date, due: '', partnerId: cust, art32: false, buyer: { name: 'Купувач Тест', edb: '', address: '', city: '' }, items: [{ itemId: '', name: 'Услуга', unit: 'ком', qty: 1, price: 500, disc: 0, rate: 18, konto: '' }], total: 590 },
  status: 'ok' as const, msg: '',
});
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

beforeAll(async () => {
  await setupDb();
  A = (await pg.insert(schema.firms).values({ name: 'МИНАТ ПЕРИОД ФЛОУ ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning())[0]!.id;
  cust = (await pg.insert(schema.partners).values({ firmId: A, name: 'Купувач Тест', code: '1' }).returning())[0]!.id;
  await signIn('admin', { username: 'past-owner' }); S.owner = jar.get('wc_sess')!;
  await signIn('acc', { firms: [A] }); S.acc = jar.get('wc_sess')!;
  await signIn('senior', { firms: [A] }); S.senior = jar.get('wc_sess')!;
  docId = (await pg.insert(schema.aiDocuments).values({ firmId: A, kind: 'sale', status: 'done', drafts: [draft('ИЗ-1', PAST), draft('ИЗ-2', PAST), draft('ИЗ-3', today)] }).returning())[0]!.id;
}, 120_000);

describe('⏸ За проверка – минат период', () => {
  it('the bulk save posts the current invoice and holds the two of the past period', async () => {
    as('acc'); useFirm(A);
    const r = await saveSalesOk();
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/Зачувани 1 од 3 фактури\. ⏸ Задржани 2 од минат ДДВ период/);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, docId));
    expect(d!.drafts.map((x) => x.status)).toEqual(['past', 'past', 'ok']);
    expect(d!.drafts[0]!.msg).toContain('претходен период');
  });

  it('a colleague without the right sees the held items but cannot decide', async () => {
    as('acc'); useFirm(A);
    const h = await html(ScanCenter({ mode: 'skan', sp: { k: 'sale' } }));
    expect(h).toContain('⏸ За проверка – минат период');
    expect(h).toContain('data-past-count="2"');
    expect(h).toContain('Одлучува сопственикот');
    expect(h).not.toContain('Прокнижи во својот период');
    expect(h).not.toContain('датум на прием во тековниот период');
    expect((await confirmPastAction(docId, 0, 'own')).error).toMatch(/Само сопственикот/);
    expect((await rejectPastAction(docId, 1)).error).toMatch(/Само сопственикот/);
    expect((await setPastHoldAction(false)).error).toMatch(/Само сопственикот/);
    const p = await html(PristPage({ searchParams: Promise.resolve({ firm: A }) }));
    expect(p).toContain('⏸ 2 минат период');
  });

  it('the owner confirms „во својот период“ (no receipt-date option for outgoing) and ДДВ-04 lists the correction', async () => {
    as('owner'); useFirm(A);
    const h = await html(ScanCenter({ mode: 'skan', sp: { k: 'sale' } }));
    expect(h).toContain('✓ Прокнижи во својот период');
    expect(h).not.toContain('Прокнижи со датум на прием во тековниот период');
    expect(h).toContain('Излезната фактура секогаш припаѓа на периодот на датумот на издавање');
    expect((await confirmPastAction(docId, 0, 'receipt', today)).error).toMatch(/датумот на издавање/);
    const r = await confirmPastAction(docId, 0, 'own');
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/ДДВ-04 за тој период треба да се коригира/);
    const [inv] = await pg.select().from(schema.invoices).where(eq(schema.invoices.date, PAST));
    expect(inv).toBeTruthy();
    const ddv = await html(DdvPage({ searchParams: Promise.resolve({ p: PAST_P }) }));
    expect(ddv).toContain('Корекции на ДДВ-04 потребни');
    expect(ddv).toContain(inv!.number);
  });

  it('a senior (settings right) rejects the other one', async () => {
    as('senior'); useFirm(A);
    expect((await rejectPastAction(docId, 1)).ok).toBe('Документот е отфрлен.');
    const h = await html(ScanCenter({ mode: 'skan', sp: { k: 'sale' } }));
    expect(h).not.toContain('data-past-count');
    const A2 = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.firmId, A));
    expect(A2.map((x) => x.action)).toEqual(expect.arrayContaining(['pastHold', 'pastPost', 'pastReject']));
  });
});
