/** Office-wide defaults „за сите фирми (и новите)“: nalog numbering and bank kontos written into every firm, kept for new firms. */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from './audit';
import { applyBankKontaDefaults, applyFirmDefaults, applyNalogDefaults } from './firm-defaults';
import { firmNalogSettings } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const X = db as unknown as Tx;
const firmOf = async (name: string, settings?: Record<string, unknown>) => (await db.insert(schema.firms).values({ name, ...(settings ? { settings } : {}) }).returning())[0]!.id;
const settingsOf = async (id: string) => ((await db.select().from(schema.firms).where(eq(schema.firms.id, id)))[0]!.settings ?? {}) as Record<string, unknown>;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
});

describe('firm defaults for the whole office', () => {
  it('numbering: every firm, other settings kept, and the new firms', async () => {
    const a = await firmOf('А', { nalCodes: { vlez: '20' }, nalogMode: 'period' });
    const b = await firmOf('Б');
    const n = await applyNalogDefaults(X, null, { nalogMode: 'doc', nalogPer: 'quarter', nalPayPer: 'month' });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(firmNalogSettings({ settings: await settingsOf(a) }).nalogMode).toBe('doc');
    expect((await settingsOf(a)).nalCodes).toEqual({ vlez: '20' });
    expect(firmNalogSettings({ settings: await settingsOf(b) }).nalogMode).toBe('doc');
    const c = await firmOf('В');
    await applyFirmDefaults(X, c);
    expect(firmNalogSettings({ settings: await settingsOf(c) }).nalogMode).toBe('doc');
    // a firm that brings its own numbering keeps it
    const d = await firmOf('Г', { nalogMode: 'period' });
    await applyFirmDefaults(X, d);
    expect(firmNalogSettings({ settings: await settingsOf(d) }).nalogMode).toBe('period');
  });
  it('bank kontos: validated against the chart, merged into every firm', async () => {
    const a = await firmOf('Д', { bankKonta: { pos: '1200001' } });
    await expect(applyBankKontaDefaults(X, null, { customer: '99999999' })).rejects.toThrow(/контниот план/);
    await applyBankKontaDefaults(X, null, { customer: '1200' });
    expect((await settingsOf(a)).bankKonta).toEqual({ pos: '1200001', customer: '1200' });
    const b = await firmOf('Ѓ');
    await applyFirmDefaults(X, b);
    expect((await settingsOf(b)).bankKonta).toEqual({ customer: '1200' });
  });
});
