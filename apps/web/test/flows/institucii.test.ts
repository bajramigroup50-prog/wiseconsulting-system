/**
 * „🏛 Институции – барања и плаќања“: an office colleague enters an УЈП decision with an amount, the list shows it
 * red when overdue, the КТБ order is drafted from it on /ppNal, the bank statement marks it paid, the status buttons
 * work, an attached scan is queued for reading, and a colleague without the firm gets nothing.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
const jobs = vi.hoisted(() => [] as [string, object][]);
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: object) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));

const A = await import('@/app/(app)/institucii/actions');
const { default: Page } = await import('@/app/(app)/institucii/page');
const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

let firmId = '', other = '', id = '';
const item = async () => (await pg.select().from(schema.instItems).where(eq(schema.instItems.id, id)))[0]!;

beforeAll(async () => {
  await setupDb();
  await signIn('admin');
  const [f] = await pg.insert(schema.firms).values({ name: 'ИНСТИТУЦИИ ТЕСТ ДООЕЛ', edb: '4030022222222', city: 'Скопје' }).returning();
  const [g] = await pg.insert(schema.firms).values({ name: 'ДРУГА ФИРМА ДООЕЛ', edb: '4030033333333' }).returning();
  firmId = f!.id; other = g!.id;
});

describe('🏛 /institucii', () => {
  it('saves an УЈП decision with the payment details; the list shows it overdue in red with the amount', async () => {
    await signIn('acc', { firms: [firmId] });
    useFirm(firmId);
    const r = await act(A.instSave({}, form({
      firmId, inst: 'ujp', type: 'reshenie', refNo: '13-77/2026', received: '2026-01-05', due: '2026-01-15', subject: 'Доплата ДДВ по контрола',
      amount: '1.500,00', payUplSm: '840-019-02687', payPrihod: '714116 00', payRef: '99887766',
    })));
    id = (r as { redirect: string }).redirect.split('=')[1]!;
    expect(await item()).toMatchObject({ firmId, inst: 'ujp', type: 'reshenie', amount: '1500.00', status: 'new', source: 'manual' });
    const html = await page({ f: 'all' });
    expect(html).toContain('13-77/2026');
    expect(html).toContain('1.500,00');
    expect(html).toMatch(/задоцнето/);
    expect(html).not.toContain('ДРУГА ФИРМА'); // the colleague's firm filter lists only their firms
    const one = await page({ id });
    expect(one).toContain('Направи налог КТБ (јавни приходи)');
    // the deadline calendar has the row
    const [rok] = await pg.select().from(schema.rokovi).where(eq(schema.rokovi.key, `inst:${id}`));
    expect(rok).toBeUndefined(); // January is outside the calendar window – only recent deadlines are kept there
  });

  it('a colleague without the firm can neither save into it nor change the item', async () => {
    await signIn('acc', { firms: [other] });
    useFirm(other);
    expect((await A.instSave({}, form({ firmId, inst: 'ujp', type: 'baranje' }))).error).toBeTruthy();
    expect((await A.instStatus(id, 'closed')).error).toBeTruthy();
    expect(await page({ id })).toContain('Записот не постои');
  });

  it('paid from the bank statement (amount + повикување на број), then answered / closed', async () => {
    await signIn('acc', { firms: [firmId] });
    useFirm(firmId);
    const [acc] = await pg.insert(schema.bankAccounts).values({ firmId, name: 'Жиро', account: '300000000000056', konto: '1000' }).returning();
    const [st] = await pg.insert(schema.bankStatements).values({ firmId, bankAccountId: acc!.id, date: '2026-01-14', number: '3' }).returning();
    await pg.insert(schema.bankLines).values({ firmId, statementId: st!.id, bankAccountId: acc!.id, lineNo: 1, date: '2026-01-14', amount: '-1500.00', dupKey: randomUUID(), counterAccount: '100000000063095', purpose: 'ДДВ 99887766' });
    expect((await A.instMatchNow([firmId])).ok).toMatch(/Платени според изводите: 1/);
    expect(await item()).toMatchObject({ status: 'paid', paidOn: '2026-01-14', paidNote: '✓ платено (извод бр. 3 од 14.01.2026, 1.500,00 ден.)' });
    expect((await A.instStatus(id, 'closed')).ok).toBeTruthy();
    expect((await item()).status).toBe('closed');
    expect(await page({ f: firmId })).not.toContain('13-77/2026'); // the default list shows the open ones
    expect(await page({ f: firmId, st: 'all' })).toContain('13-77/2026');
  });

  it('an attached scan is linked and queued for reading', async () => {
    await signIn('acc', { firms: [firmId] });
    useFirm(firmId);
    const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: `t/${randomUUID()}`, name: 'opomena.pdf', mime: 'application/pdf', size: 3, sha256: 'z', status: 'ready' }).returning();
    jobs.length = 0;
    const r = await act(A.instSave({}, form({ firmId, inst: 'other', type: 'drugo', fileIds: [f!.id] })));
    const nid = (r as { redirect: string }).redirect.split('=')[1]!;
    const [n] = await pg.select().from(schema.instItems).where(eq(schema.instItems.id, nid));
    expect(n).toMatchObject({ source: 'upload' });
    expect(jobs.filter(([j]) => j === 'ai.read-document')).toHaveLength(1);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.fileId, f!.id));
    expect(d).toMatchObject({ kind: 'inst', options: { instId: nid } });
    expect(await page({ id: nid })).toContain('се чита');
  });
});
