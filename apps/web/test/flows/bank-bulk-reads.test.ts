/**
 * НЛБ statements dropped in bulk into the import box (PGlite, server actions): a file read before is not read again
 * (no new ai_document, no job), done reads that were never imported are offered as „Прочитани изводи што чекаат
 * увоз“ and imported later through the same preview / save (balances, duplicates), the statement's 210… account is
 * linked to the firm's numberless „ЖИРО СМЕТКА ТУТУНСКА БАНКА“ on confirmation.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { NLB_ACCOUNT, nlbStatementItems } from '@wise/core/noai/bank-nlb.fixtures';
import { saveBankAccount, schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

const jobs: [string, object][] = [];
vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: object) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));

const { startAiRead } = await import('@/app/(app)/_ai/actions');
const { pendingBankReadsAction, dismissBankReadsAction, linkStatementAccountAction, previewNalogImportAction, saveImportAction } = await import('@/app/(app)/banka/actions');

let firmId = '', acctId = '', f1 = '', f3 = '', d1 = '';
let k = 0;
const file = async (h: string, name: string) =>
  (await pg.insert(schema.files).values({ firmId, bucketKey: `bulk/${k++}`, name, mime: 'application/pdf', size: 900, sha256: h.repeat(64).slice(0, 64), status: 'ready' }).returning())[0]!.id;
const docsOf = (fileId: string) => pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.fileId, fileId));

beforeAll(async () => {
  await setupDb();
  firmId = (await pg.insert(schema.firms).values({ name: 'ПРИМЕР КЛИЕНТ ДООЕЛ Скопје', edb: '4000000000000' }).returning())[0]!.id;
  acctId = await pg.transaction((tx) => saveBankAccount(tx as never, { firmId, userId: null, input: { name: 'ЖИРО СМЕТКА ТУТУНСКА БАНКА', cur: 'MKD', konto: '100001' } }));
  f1 = await file('a', 'DpsStatement01.pdf');
  f3 = await file('c', 'DpsStatement03.pdf');
  // read earlier (the browser stopped waiting, nothing was imported)
  const result = JSON.parse(JSON.stringify(statementFromPdfItems(nlbStatementItems())));
  d1 = (await pg.insert(schema.aiDocuments).values({ firmId, fileId: f1, kind: 'bank', status: 'done', model: 'noai', result }).returning())[0]!.id;
  await signIn('admin');
  useFirm(firmId); useYear(2026);
}, 120_000);

describe('bulk statement reads', () => {
  it('dropped again: the earlier read is given back — no second read, no job; a new file is read once', async () => {
    const r = await startAiRead({ kind: 'bank', fileIds: [f1, f3], reuse: true });
    expect(r.error).toBeUndefined();
    expect(r.ids![0]).toBe(d1);
    expect(r.reused).toBe(1);
    expect(await docsOf(f1)).toHaveLength(1);
    expect(await docsOf(f3)).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    // the third drop while f3 is still being read: still no new read
    const r2 = await startAiRead({ kind: 'bank', fileIds: [f1, f3], reuse: true });
    expect(r2.ids).toEqual(r.ids);
    expect(jobs).toHaveLength(1);
    expect(await docsOf(f3)).toHaveLength(1);
  });

  it('the read waiting for import is offered (and the one still reading counted)', async () => {
    const p = await pendingBankReadsAction();
    expect(p.items.map((x) => [x.id, x.name])).toEqual([[d1, 'DpsStatement01.pdf']]);
    expect(p.reading).toBe(1);
  });

  it('preview from the stored read: balances check, the 210… account proposed for the numberless Тутунска account', async () => {
    const r = await previewNalogImportAction(form({ file: new File([], 'DpsStatement01.pdf'), aiDoc: d1, acct: acctId }));
    expect(r.error).toBeUndefined();
    const plan = r.plans![0]!.plan;
    expect(plan.errors).toEqual([]);
    expect(plan.days.map((d) => [d.no, d.date, d.opening, d.closing, d.lines.length])).toEqual([['77', '2026-03-02', 10000000, 11020500, 4]]);
    expect(plan.accountProposals).toEqual([expect.objectContaining({ account: NLB_ACCOUNT, link: { accountId: acctId, name: 'ЖИРО СМЕТКА ТУТУНСКА БАНКА', konto: '100001' } })]);
  });

  it('„Поврзи ја сметката“ fills in the number; the import then goes to that account and the read leaves the list', async () => {
    expect((await linkStatementAccountAction(acctId, NLB_ACCOUNT)).error).toBeUndefined();
    const again = await previewNalogImportAction(form({ file: new File([], 'DpsStatement01.pdf'), aiDoc: d1, acct: '' }));
    expect(again.plans![0]!.plan.accountProposals).toBeUndefined();
    const s = await saveImportAction(form({ file: new File([], 'DpsStatement01.pdf'), aiDoc: d1, acct: '' }));
    expect(s.error).toBeUndefined();
    expect(s.ok).toMatch(/1 изводи, 4 ставки/);
    const [st] = await pg.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, firmId));
    expect(st).toMatchObject({ bankAccountId: acctId, number: '77', date: '2026-03-02' });
    expect((await pendingBankReadsAction()).items).toEqual([]);
  });

  it('a batch where one file fails: the others are imported, the failed one is reported with its reason', async () => {
    const result = JSON.parse(JSON.stringify(statementFromPdfItems(nlbStatementItems())));
    const f4 = await file('d', 'DpsStatement04.pdf');
    const d4 = (await pg.insert(schema.aiDocuments).values({ firmId, fileId: f4, kind: 'bank', status: 'done', model: 'noai', result }).returning())[0]!.id;
    const bad = (await pg.insert(schema.aiDocuments).values({ firmId, fileId: f3, kind: 'bank', status: 'done', model: 'noai', result: { items: [] } }).returning())[0]!.id;
    const fd = form({ acct: '' });
    for (const [n, id] of [['DpsStatement03.pdf', bad], ['DpsStatement04.pdf', d4]] as const) { fd.append('file', new File([], n)); fd.append('aiDoc', id); }
    const p = await previewNalogImportAction(fd);
    expect(p.plans!.map((x) => [x.file, x.i])).toEqual([['DpsStatement04.pdf', 1]]);
    expect(p.skipped).toEqual([{ file: 'DpsStatement03.pdf', error: expect.stringMatching(/не се пронајдени ставки/) }]);
    // the same statement in another file: every line a duplicate (skipped on save)
    expect(p.plans![0]!.plan.days[0]!.allDup).toBe(true);
    const s = await saveImportAction(fd);
    expect(s.failed).toEqual([expect.objectContaining({ file: 'DpsStatement03.pdf', i: 0 })]);
    expect(s.ok).toMatch(/4 дупликати прескокнати/);
    // dismissing what is left
    expect((await pendingBankReadsAction()).items.map((x) => x.id)).toEqual([bad]);
    expect((await dismissBankReadsAction([bad])).ok).toMatch(/Отфрлени 1/);
    expect((await pendingBankReadsAction()).items).toEqual([]);
  });
});
