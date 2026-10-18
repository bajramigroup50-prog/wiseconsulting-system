/**
 * Read outgoing invoices, the rules for every firm (PGlite): 0 % with no printed note = ЗДДВ чл. 24 with the right to
 * deduct (ready, field 08) unless the firm chose „провери“; a page without lines and amount (a work order /
 * „налог-потврда за извршена услуга“) is not an invoice — skipped and archived.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saleDrafts } from './sales/scan-drafts';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firm: schema.Firm;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'Услуги ДООЕЛ', edb: 'MK4030000000099', vatRegistered: true }).returning() as [schema.Firm];
  await db.insert(schema.partners).values({ firmId: firm.id, name: 'ТЕХНОПАНЕЛ ДОО Илинден', edb: 'MK4080021601835', code: '1' });
}, 120_000);

const exempt = { number: 'CLK-1132', date: '2026-08-24', buyerName: 'ТЕХНОПАНЕЛ ДОО Илинден', buyerEdb: 'MK4080021601835', total: 25000,
  lines: [{ name: 'Дезинфекција', qty: 1, price: 25000, amount: 25000, rate: 0, unit: 'услуга' }], groups: [{ rate: 0, base: 25000, vat: 0 }] };
const workOrder = { number: '001/2026', date: '2026-09-03', buyerName: 'JYSK - Strumica', total: 0, lines: [] };

describe('read outgoing invoices – rules for every firm', () => {
  it('0 % without a note → чл. 24 with the right to deduct, ready; a work order → not an invoice, archived', async () => {
    const [a, b] = await saleDrafts(db as never, firm, { invoices: [exempt, workOrder] } as never);
    expect(a).toMatchObject({ status: 'ok', draft: { vatExempt: 'ded', vatNote: 'Ослободено од ДДВ со право на одбивка согласно член 24 од ЗДДВ' } });
    expect((a!.draft as { vatCheck?: boolean }).vatCheck).toBeUndefined();
    expect(b).toMatchObject({ status: 'skip', skipped: true });
    expect(b!.msg).toMatch(/не е фактура/);
    expect(b!.archived).toBeTruthy();
  });

  it('a firm that chose „провери“ keeps the 0 % invoice for the accountant', async () => {
    const f2 = { ...firm, settings: { ...(firm.settings as object), scanNoVat: 'check' } } as schema.Firm;
    const [a] = await saleDrafts(db as never, f2, { invoices: [exempt] } as never);
    expect(a!.status).toBe('check');
    expect((a!.draft as { vatCheck?: boolean }).vatCheck).toBe(true);
  });
});
