/** „📥 Пристигнати документи“ on PGlite: the bank statement auto-import by IBAN, duplicates, proposals, routing. */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseStatementFile, type Statement } from '@wise/core/bank-parsers';
import { addIncoming, incomingBankAuto, principalOfUser, routeIncoming, skipIncoming, writableFirmAccounts } from './incoming';
import { saveBankAccount } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
type D = typeof db;
const T = <R>(f: (tx: D) => Promise<R>) => db.transaction((tx) => f(tx as unknown as D));
let A = '', B = '', C = '', user = '';
const halk = new Uint8Array(readFileSync(fileURLToPath(new URL('../../core/test/golden/bank/fixtures/halk-mkd.xml', import.meta.url))));
const S = (): Statement[] => parseStatementFile(halk, 'izvod.xml')!;
let n = 0;
const file = async (firmId: string | null, name = 'izvod.xml') => (await db.insert(schema.files).values({ firmId, bucketKey: `k/${++n}`, name, mime: 'text/xml', size: 10, sha256: String(n), status: 'ready', uploadedBy: user }).returning())[0]!.id;
const row = async (firmId: string | null) => { const f = await file(firmId); return (await T((tx) => addIncoming(tx as never, { firmId, fileIds: [f], userId: user })))[0]!; };
const get = async (id: string) => (await db.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, id)))[0]!;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [A, B, C] = (await db.insert(schema.firms).values([{ name: 'Фирма А ДООЕЛ' }, { name: 'Фирма Б ДООЕЛ' }, { name: 'Туѓа фирма ДОО' }]).returning()).map((f) => f.id) as [string, string, string];
  user = (await db.insert(schema.users).values({ username: 'acc1', name: 'Сметководител', role: 'acc', passwordHash: 'x' }).returning())[0]!.id;
  await db.insert(schema.userFirms).values([{ userId: user, firmId: A }, { userId: user, firmId: B }]);
  await T((tx) => saveBankAccount(tx as never, { firmId: A, userId: null, input: { name: 'Халк', account: '270000012345678', cur: 'MKD', konto: '1000' } }));
  await T((tx) => saveBankAccount(tx as never, { firmId: B, userId: null, input: { name: 'Комерцијална', account: '300000000999999', cur: 'MKD', konto: '1000' } }));
  await T((tx) => saveBankAccount(tx as never, { firmId: C, userId: null, input: { name: 'Стопанска', account: '200000000777777', cur: 'MKD', konto: '1000' } }));
}, 60_000);

describe('incoming bank statements', () => {
  it('the user books only into the assigned firms', async () => {
    const F = await writableFirmAccounts(db as never, await principalOfUser(db as never, user));
    expect(F.map((f) => f.id).sort()).toEqual([A, B].sort());
  });
  it('a statement with the firm\'s own IBAN is imported automatically into the bank nalog', async () => {
    const id = await row(A);
    const r = await T((tx) => incomingBankAuto(tx as never, { id, statements: S(), format: 'halk-xml' }));
    expect(r.status, r.result).toBe('done');
    const x = await get(id);
    expect(x).toMatchObject({ status: 'done', route: 'bank', firmId: A });
    expect(x.routeRef).toMatch(/^bank_import:/);
    const st = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, A));
    expect(st.length).toBeGreaterThan(0);
    expect(st[0]!.fileId).toBe(x.fileId);
  });
  it('the same statement again is a duplicate and is skipped', async () => {
    const id = await row(A);
    const r = await T((tx) => incomingBankAuto(tx as never, { id, statements: S(), format: 'halk-xml' }));
    expect(r.status).toBe('skipped');
    expect((await get(id)).result).toMatch(/Дупликат/);
  });
  it('the IBAN of another accessible firm is only proposed', async () => {
    const id = await row(B);
    const r = await T((tx) => incomingBankAuto(tx as never, { id, statements: S(), format: 'halk-xml' }));
    expect(r).toMatchObject({ status: 'read', proposed: [{ id: A, name: 'Фирма А ДООЕЛ' }] });
    expect(await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, B))).toHaveLength(0);
  });
  it('an unknown IBAN (or one of a firm the user cannot access) waits for a decision', async () => {
    const id = await row(B);
    const st = S().map((s) => ({ ...s, account: '200000000777777', iban: 'MK07200000000777777' }));
    const r = await T((tx) => incomingBankAuto(tx as never, { id, statements: st, format: 'halk-xml' }));
    expect(r.status).toBe('read');
    expect(r).not.toHaveProperty('proposed');
    expect(await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, C))).toHaveLength(0);
  });
});

describe('incoming routing', () => {
  it('a purchase goes to the scan review (an ai_documents read of the firm)', async () => {
    const id = await row(A);
    const r = await T((tx) => routeIncoming(tx as never, { id, firmId: A, route: 'purchase', userId: user }));
    expect(r.go).toBe('/skan');
    const [d] = await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, r.aiDocIds[0]!));
    expect(d).toMatchObject({ firmId: A, kind: 'purchase', status: 'queued', options: { incomingId: id } });
    expect(await get(id)).toMatchObject({ status: 'done', route: 'purchase' });
  });
  it('routing in another firm is refused; skip / unskip', async () => {
    const id = await row(A);
    await expect(T((tx) => routeIncoming(tx as never, { id, firmId: B, route: 'dossier', userId: user }))).rejects.toThrow(/оваа фирма/);
    await T((tx) => skipIncoming(tx as never, { id, firmId: A, userId: user, skip: true }));
    expect((await get(id)).status).toBe('skipped');
  });
});
