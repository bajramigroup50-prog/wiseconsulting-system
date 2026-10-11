/** Legacy `schRepost` / `oldVatDocs`: re-posting the year with the current schemes, locked periods skipped. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { oldVatDocCount, repostResult } from '@wise/core/repost';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { saveInvoice } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';
import { saveSalesDay } from './stock-docs';
import { oldVatDocs, repostYear } from './repost';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const office: DocActor = { userId: null, role: 'acc' };
let firmId = '';

/** Simulate an old booking: VAT on the summary konto (legacy `VAT_BAD`). */
async function spoil() {
  const J = await db.select({ id: schema.journals.id }).from(schema.journals).where(and(eq(schema.journals.firmId, firmId), inArray(schema.journals.sourceType, ['invoice', 'purchase', 'sales_daily'])));
  for (const j of J) {
    await db.update(schema.journalLines).set({ account: '2300' }).where(and(eq(schema.journalLines.journalId, j.id), inArray(schema.journalLines.account, ['230018', '23005'])));
    await db.update(schema.journalLines).set({ account: '1300' }).where(and(eq(schema.journalLines.journalId, j.id), eq(schema.journalLines.account, '130018')));
  }
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Прекнижување ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning();
  firmId = f!.id;
  const [c, s] = await db.insert(schema.partners).values([{ firmId, name: 'Купувач', code: '1' }, { firmId, name: 'Добавувач', code: '2' }]).returning();
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-10', partnerId: c!.id, lines: [{ name: 'Услуга', qty: 1, price: 1000, rate: 18 }] }, office));
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-04-10', partnerId: c!.id, lines: [{ name: 'Услуга', qty: 2, price: 500, rate: 18 }] }, office));
  await tx((t) => savePurchase(t, firmId, { number: 'D-1', date: '2026-04-11', partnerId: s!.id, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 1000, vat: 180 }] }, office));
  await tx((t) => saveSalesDay(t, { firmId, userId: null }, { kind: 'fisk', date: '2026-04-12', number: '7', gross: { 18: 1180, 5: 105 } }));
});

describe('repostYear (legacy schRepost)', () => {
  it('counts documents with VAT on a summary konto', async () => {
    expect(oldVatDocCount([{ sourceType: 'invoice', sourceId: 'a', account: '2300' }, { sourceType: 'invoice', sourceId: 'a', account: '2301' }, { sourceType: 'manual', sourceId: 'b', account: '2300' }, { sourceType: 'purchase', sourceId: 'c', account: '130018' }])).toBe(1);
    expect(await tx((t) => oldVatDocs(t, firmId, 2026))).toBe(0);
    await spoil();
    expect(await tx((t) => oldVatDocs(t, firmId, 2026))).toBe(4);
  });
  it('re-posts with the current schemes and skips the locked period', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    const R = await tx((t) => repostYear(t, { firmId, userId: null }, 2026));
    expect(R).toMatchObject({ n: 3, locked: 1, failed: 0 });
    expect(repostResult(R.n, R.locked)).toBe('3 документи се прекнижани. 1 се прескокнати – заклучен период (не се менуваат).');
    // only the January invoice (locked) keeps the summary konto
    expect(await tx((t) => oldVatDocs(t, firmId, 2026))).toBe(1);
    const L = await db.select({ a: schema.journalLines.account }).from(schema.journalLines).innerJoin(schema.journals, eq(schema.journals.id, schema.journalLines.journalId))
      .where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'sales_daily')));
    expect(L.map((x) => x.a)).toEqual(expect.arrayContaining(['230018', '23005']));
  });
});
