/**
 * НЛБ statements dropped in bulk (synthetic `DpsStatement` layout, `@wise/core/noai/bank-nlb.fixtures`) on PGlite:
 *  - a file read before (same sha256, same firm, same kind) gets its read back — no second read;
 *  - reads that are done but never imported stay pending until imported (marked saved) or dismissed;
 *  - the statement's account (210…) is proposed for the firm's numberless „ЖИРО СМЕТКА ТУТУНСКА БАНКА“ (100001) and
 *    filled in on confirmation; otherwise a new account on the konto of its bank is proposed.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { statementsFromRead } from '@wise/core/ai/bank';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { NLB_ACCOUNT, nlbStatementItems } from '@wise/core/noai/bank-nlb.fixtures';
import { createStatementAccount, linkBankAccountNumber, planImport, saveBankAccount, saveImport } from './bank/index';
import { dismissReads, pendingReads, READ_STALE_MS, reusableReads, undismissReads } from './ai-reuse';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const sha = (c: string) => c.repeat(64).slice(0, 64);
const read = () => JSON.parse(JSON.stringify(statementFromPdfItems(nlbStatementItems()))) as unknown;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
}, 60_000);

const newFirm = async (name: string) => (await db.insert(schema.firms).values({ name, edb: '4000000000000' }).returning())[0]!.id;
let k = 0;
const file = async (firmId: string, h: string, name = 'DpsStatement.pdf') =>
  (await db.insert(schema.files).values({ firmId, bucketKey: `t/${k++}`, name, mime: 'application/pdf', size: 1000, sha256: sha(h), status: 'ready' }).returning())[0]!.id;
const doc = async (firmId: string, fileId: string, status: 'queued' | 'reading' | 'done' | 'saved' | 'error', o: { result?: unknown; updatedAt?: Date; kind?: string } = {}) =>
  (await db.insert(schema.aiDocuments).values({ firmId, fileId, kind: (o.kind ?? 'bank') as never, status, result: o.result ?? null, model: 'noai', ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}) }).returning())[0]!.id;

describe('reads are reused by content', () => {
  it('the same content again (another upload of the same PDF) → the earlier read, done first; no read for a new file', async () => {
    const firm = await newFirm('ФИРМА А');
    const f1 = await file(firm, 'a'), f1b = await file(firm, 'a', 'copy.pdf'), f2 = await file(firm, 'b');
    const d1 = await doc(firm, f1, 'done', { result: read() });
    await doc(firm, f1, 'error');
    const m = await reusableReads(db, { firmId: firm, kind: 'bank', fileIds: [f1, f1b, f2] });
    expect(m.get(f1)).toEqual({ id: d1, status: 'done' });
    expect(m.get(f1b)).toEqual({ id: d1, status: 'done' });
    expect(m.has(f2)).toBe(false);
  });

  it('a read still running is given back (not paid twice); a lost one (stale) is not; other kind / firm are not', async () => {
    const firm = await newFirm('ФИРМА Б'), other = await newFirm('ФИРМА В');
    const f1 = await file(firm, 'c'), f2 = await file(firm, 'd'), f3 = await file(firm, 'e'), fo = await file(other, 'c');
    const q = await doc(firm, f1, 'queued');
    await doc(firm, f2, 'reading', { updatedAt: new Date(Date.now() - READ_STALE_MS - 60_000) });
    await doc(firm, f3, 'done', { kind: 'ob', result: {} });
    const m = await reusableReads(db, { firmId: firm, kind: 'bank', fileIds: [f1, f2, f3] });
    expect(m.get(f1)).toEqual({ id: q, status: 'queued' });
    expect(m.has(f2)).toBe(false);
    expect(m.has(f3)).toBe(false);
    expect((await reusableReads(db, { firmId: other, kind: 'bank', fileIds: [fo] })).size).toBe(0);
  });

  it('an explicit re-read never returns the old read: none at all when asked, and the re-read supersedes the older reads', async () => {
    const firm = await newFirm('ФИРМА Г');
    const f1 = await file(firm, 'f'), f1b = await file(firm, 'f', 'again.pdf');
    const old = await doc(firm, f1, 'done', { result: read() });
    expect((await reusableReads(db, { firmId: firm, kind: 'bank', fileIds: [f1b] })).get(f1b)).toEqual({ id: old, status: 'done' });
    // „↻ Прочитај повторно“ asks for a new read: nothing reused
    expect((await reusableReads(db, { firmId: firm, kind: 'bank', fileIds: [f1b], reread: true })).size).toBe(0);
    // once the content has an explicit re-read (still running), the old read is never returned again — the re-read is
    const re = (await db.insert(schema.aiDocuments).values({ firmId: firm, fileId: f1, kind: 'bank', status: 'queued', options: { reread: true, retry: true } }).returning())[0]!.id;
    expect((await reusableReads(db, { firmId: firm, kind: 'bank', fileIds: [f1b] })).get(f1b)).toEqual({ id: re, status: 'queued' });
  });
});

describe('pending reads and the НЛБ account', () => {
  let firm = '', acctId = '';
  const ids: string[] = [];
  beforeAll(async () => {
    firm = await newFirm('ПРИМЕР КЛИЕНТ ДООЕЛ Скопје');
    // from the opening balance: the account has no number
    acctId = await T((tx) => saveBankAccount(tx, { firmId: firm, userId: null, input: { name: 'ЖИРО СМЕТКА ТУТУНСКА БАНКА', cur: 'MKD', konto: '100001' } }));
    ids.push(await doc(firm, await file(firm, '1'), 'done', { result: read() }));
    ids.push(await doc(firm, await file(firm, '1', 'again.pdf'), 'done', { result: read() }));
    ids.push(await doc(firm, await file(firm, '2'), 'done', { result: read() }));
    await doc(firm, await file(firm, '3'), 'queued');
    await doc(firm, await file(firm, '4'), 'saved', { result: read() });
  });

  it('done reads not imported are pending (one per content), the running ones counted', async () => {
    const p = await pendingReads(db, { firmId: firm, kind: 'bank' });
    expect(p.items.map((x) => x.id)).toEqual([ids[0], ids[2]]);
    expect(p.reading).toBe(1);
  });

  it('preview of a pending read: the numberless НЛБ / Тутунска account is proposed', async () => {
    const plan = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()), defaultAccountId: acctId }));
    expect(plan.errors).toEqual([]);
    expect(plan.accountProposals).toEqual([{ account: NLB_ACCOUNT, bank: 'НЛБ Банка АД Скопје', link: { accountId: acctId, name: 'ЖИРО СМЕТКА ТУТУНСКА БАНКА', konto: '100001' } }]);
    expect(plan.days.map((d) => [d.no, d.date, d.opening, d.closing, d.lines.length])).toEqual([['77', '2026-03-02', 10000000, 11020500, 4]]);
  });

  it('confirmed: the number is filled in, the statement matches the account, imported later from the pending read', async () => {
    await T((tx) => linkBankAccountNumber(tx, { firmId: firm, userId: null, accountId: acctId, account: '210-0000123456-52' }));
    const [a] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, acctId));
    expect(a!.account).toBe(NLB_ACCOUNT);
    const plan = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()) }));
    expect(plan.accountProposals).toBeUndefined();
    expect(plan.days[0]!.accountId).toBe(acctId);
    const x = await T((tx) => saveImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()), format: 'ai', fileName: 'DpsStatement.pdf' }));
    expect(x).toMatchObject({ statements: 1, lines: 4 });
    // the import marks the read saved (markAiReadsSaved in the web action): it leaves the pending list
    await db.update(schema.aiDocuments).set({ status: 'saved' }).where(eq(schema.aiDocuments.id, ids[0]!));
    expect((await pendingReads(db, { firmId: firm, kind: 'bank' })).items.map((x) => x.id)).toEqual([ids[1], ids[2]]);
    // the same statement again (a second copy): every line a duplicate
    const again = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()) }));
    expect(again.days[0]!.allDup).toBe(true);
  });

  it('dismissed reads leave the list; dropped again they come back', async () => {
    expect(await dismissReads(db, { firmId: firm, ids: [ids[1]!, ids[2]!] })).toBe(2);
    expect((await pendingReads(db, { firmId: firm, kind: 'bank' })).items).toEqual([]);
    await undismissReads(db, { firmId: firm, ids: [ids[2]!] });
    expect((await pendingReads(db, { firmId: firm, kind: 'bank' })).items.map((x) => x.id)).toEqual([ids[2]]);
  });

  it('a linked account is not linked twice; a wrong number is refused', async () => {
    await expect(T((tx) => linkBankAccountNumber(tx, { firmId: firm, userId: null, accountId: acctId, account: '210000099988838' }))).rejects.toThrow(/веќе има број/);
    await expect(T((tx) => linkBankAccountNumber(tx, { firmId: firm, userId: null, accountId: acctId, account: '210000012345653' }))).rejects.toThrow(/Неважечки/);
  });
});

describe('no numberless account of that bank → open one on its konto', () => {
  it('Халк numberless account only: a new НЛБ account is proposed on the Тутунска konto and opened', async () => {
    const firm = await newFirm('ДРУГА ФИРМА ДООЕЛ');
    const halk = await T((tx) => saveBankAccount(tx, { firmId: firm, userId: null, input: { name: 'Жиро сметка Халк банка', cur: 'MKD', konto: '100005' } }));
    const plan = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()), defaultAccountId: halk }));
    expect(plan.accountProposals).toEqual([{ account: NLB_ACCOUNT, bank: 'НЛБ Банка АД Скопје', create: { name: 'НЛБ Банка АД Скопје', konto: '100001' } }]);
    const id = await T((tx) => createStatementAccount(tx, { firmId: firm, userId: null, account: NLB_ACCOUNT }));
    const [a] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, id));
    expect(a).toMatchObject({ account: NLB_ACCOUNT, konto: '100001', cur: 'MKD' });
    const p2 = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()), defaultAccountId: halk }));
    expect(p2.accountProposals).toBeUndefined();
    expect(p2.days[0]!.accountId).toBe(id);
  });

  it('two numberless accounts of the bank: not guessed, a new account is proposed', async () => {
    const firm = await newFirm('ТРЕТА ФИРМА ДООЕЛ');
    const a1 = await T((tx) => saveBankAccount(tx, { firmId: firm, userId: null, input: { name: 'Тутунска банка', cur: 'MKD', konto: '100001' } }));
    await T((tx) => saveBankAccount(tx, { firmId: firm, userId: null, input: { name: 'НЛБ подсметка', cur: 'MKD', konto: '1000014' } }));
    const plan = await T((tx) => planImport(tx, { firmId: firm, userId: null, statements: statementsFromRead(read()), defaultAccountId: a1 }));
    expect(plan.accountProposals?.[0]?.link).toBeUndefined();
    expect(plan.accountProposals?.[0]?.create).toBeDefined();
  });
});
