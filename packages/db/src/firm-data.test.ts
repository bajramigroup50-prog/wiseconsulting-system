import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { backupCounts, exportFirm, firmRecordCounts, firmTables, FirmDataError, parseFirmBackup, restoreFirm } from './firm-data';
import * as schema from './schema/index';

const MIG = fileURLToPath(new URL('../migrations', import.meta.url));
const mk = async () => { const d = drizzle(new PGlite(), { schema }); await migrate(d, { migrationsFolder: MIG }); return d; };
let db: Awaited<ReturnType<typeof mk>>;
let firmId = '', other = '', userId = '';

beforeAll(async () => {
  db = await mk();
  const [f] = await db.insert(schema.firms).values({ name: 'Фирма А', edb: '4030000000001' }).returning();
  const [g] = await db.insert(schema.firms).values({ name: 'Фирма Б' }).returning();
  firmId = f!.id; other = g!.id;
  const [u] = await db.insert(schema.users).values({ username: 'admin', name: 'Админ', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Купувач', code: '1' }).returning();
  await db.insert(schema.partners).values({ firmId: other, name: 'Туѓ', code: '1' });
  const [inv] = await db.insert(schema.invoices).values({ firmId, kind: 'invoice', number: '1', date: '2026-02-01', partnerId: p!.id, total: '118', createdBy: userId }).returning();
  await db.insert(schema.invoices).values({ firmId, kind: 'credit', number: '1', date: '2026-02-05', partnerId: p!.id, refInvoiceId: inv!.id, total: '-11.8' });
  await db.insert(schema.invoiceLines).values({ invoiceId: inv!.id, lineNo: 1, name: 'Услуга', qty: '1', price: '100', rate: 18, account: '7400' } as typeof schema.invoiceLines.$inferInsert);
  const [j] = await db.insert(schema.journals).values({ firmId, date: '2026-02-01', kind: 'invoice', number: '1' }).returning();
  await db.insert(schema.journalLines).values([
    { journalId: j!.id, firmId, lineNo: 1, account: '1200', debit: '118', partnerId: p!.id },
    { journalId: j!.id, firmId, lineNo: 2, account: '7400', credit: '100' },
    { journalId: j!.id, firmId, lineNo: 3, account: '2300', credit: '18' },
  ]);
  const [file] = await db.insert(schema.files).values({ firmId, bucketKey: `firms/${firmId}/2026/a.pdf`, name: 'a.pdf', mime: 'application/pdf', size: 10, sha256: 'x', status: 'ready' }).returning();
  await db.insert(schema.fileLinks).values({ fileId: file!.id, entityType: 'invoice', entityId: inv!.id });
}, 60_000);

describe('firm data plan', () => {
  it('finds firm and child tables from the schema, parents before children', () => {
    const P = firmTables().map((t) => t.name);
    for (const n of ['partners', 'invoices', 'invoice_lines', 'journals', 'journal_lines', 'files', 'file_links', 'codes']) expect(P).toContain(n);
    for (const n of ['audit_log', 'user_firms', 'firms', 'users', 'word_templates']) expect(P).not.toContain(n);
    expect(P.indexOf('partners')).toBeLessThan(P.indexOf('invoices'));
    expect(P.indexOf('invoices')).toBeLessThan(P.indexOf('invoice_lines'));
    expect(P.indexOf('journals')).toBeLessThan(P.indexOf('journal_lines'));
  });
});

describe('export / restore', () => {
  it('exports only this firm, restores the state of the copy and keeps later documents', async () => {
    const B = parseFirmBackup(JSON.stringify(await exportFirm(db, firmId)));
    expect(backupCounts(B)).toMatchObject({ partners: 1, invoices: 2, invoice_lines: 1, journals: 1, journal_lines: 3, files: 1, file_links: 1 });

    // changes after the copy
    await db.delete(schema.invoices).where(eq(schema.invoices.kind, 'credit'));
    await db.insert(schema.partners).values({ firmId, name: 'Нов по копијата', code: '2' });
    await db.update(schema.firms).set({ name: 'Преименувана' }).where(eq(schema.firms.id, firmId));
    await db.insert(schema.files).values({ firmId, bucketKey: `firms/${firmId}/2026/b.json`, name: 'Rezervna_kopija_x.json', mime: 'application/json', size: 5, sha256: 'y', status: 'ready' });

    const r = await db.transaction((tx) => restoreFirm(tx, B, { userId }));
    expect(r.skipped).toEqual([]);
    const C = Object.fromEntries((await firmRecordCounts(db, firmId)).map((x) => [x.table, x.n]));
    expect(C).toMatchObject({ partners: 1, invoices: 2, invoice_lines: 1, journal_lines: 3, files: 2, file_links: 1 });
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    expect(f!.name).toBe('Фирма А');
    const [cr] = await db.select().from(schema.invoices).where(eq(schema.invoices.kind, 'credit'));
    expect(cr!.refInvoiceId).toBeTruthy();
    // the other firm is untouched
    const O = await db.select().from(schema.partners).where(eq(schema.partners.firmId, other));
    expect(O.map((x) => x.name)).toEqual(['Туѓ']);
    const A = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'bkRestoreGo'));
    expect(A).toHaveLength(1);
  });

  it('restores into an empty database: creates the firm, clears unknown users, advances id sequences', async () => {
    const B = await exportFirm(db, firmId);
    const db2 = await mk();
    const [u2] = await db2.insert(schema.users).values({ username: 'novo', name: 'Н', role: 'admin', passwordHash: 'x' }).returning();
    await db2.transaction((tx) => restoreFirm(tx, B, { userId: u2!.id }));
    const [inv] = await db2.select().from(schema.invoices).where(eq(schema.invoices.kind, 'invoice'));
    expect(inv!.createdBy).toBeNull();
    const [j] = await db2.select().from(schema.journals);
    await db2.insert(schema.journalLines).values([
      { journalId: j!.id, firmId, lineNo: 9, account: '1000', debit: '1' },
      { journalId: j!.id, firmId, lineNo: 10, account: '1000', credit: '1' },
    ]);
    const [{ n }] = (await db2.select({ n: sql<number>`count(*)::int` }).from(schema.journalLines)) as [{ n: number }];
    expect(n).toBe(5);
  });

  it('refuses files that are not a backup', () => {
    expect(() => parseFirmBackup('{"a":1}')).toThrow(FirmDataError);
    expect(() => parseFirmBackup('nije json')).toThrow('Датотеката не може да се прочита.');
  });
});
