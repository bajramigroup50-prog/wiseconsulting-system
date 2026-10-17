import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { nalTitleOf, nalTitlesOf, setNalogTitle, withNalTitle } from './nalog-titles';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
const settings = async () => (await db.select().from(schema.firms).where(eq(schema.firms.id, firmId)))[0]!.settings;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Називи ДООЕЛ', settings: { nalogPer: 'month' } }).returning();
  firmId = f!.id;
  for (const [date, number] of [['2026-03-31', '1/3'], ['2026-04-30', '1/4'], ['2025-03-31', '1/3']] as const) {
    await db.transaction((tx) => postJournal(tx, { firmId, date, kind: 'manual', number, description: 'Увезен налог ' + number, userId: null,
      lines: [{ account: '4000', debit: 100 }, { account: '1000', credit: 100 }] }));
  }
}, 60_000);

describe('nalog names (✎ Назив)', () => {
  it('pure helpers: set, trim, clear, other years untouched', () => {
    const s1 = withNalTitle({ x: 1 }, 2026, '1/3', '  ДДВ   01-03 ');
    expect(nalTitleOf(s1, 2026, '1/3')).toBe('ДДВ 01-03');
    expect(s1.x).toBe(1);
    const s2 = withNalTitle(s1, 2025, '1/3', 'Стар');
    expect(nalTitlesOf(s2, 2026)).toEqual({ '1/3': 'ДДВ 01-03' });
    expect(nalTitleOf(s2, 2025, '1/3')).toBe('Стар');
    const s3 = withNalTitle(s2, 2026, '1/3', '   ');
    expect(nalTitleOf(s3, 2026, '1/3')).toBeNull();
    expect((s3.nalTitles as Record<string, unknown>)['2026']).toBeUndefined();
    expect(nalTitleOf(s3, 2025, '1/3')).toBe('Стар');
    expect(nalTitleOf(undefined, 2026, '1/3')).toBeNull();
  });

  it('sets and clears the name of one nalog, audited; other numbers / years and other settings stay', async () => {
    const r = await db.transaction((tx) => setNalogTitle(tx, { firmId, userId: null, year: 2026, number: '1/3', title: 'ДДВ 01-03' }));
    expect(r.title).toBe('ДДВ 01-03');
    let s = await settings();
    expect(nalTitleOf(s, 2026, '1/3')).toBe('ДДВ 01-03');
    expect(nalTitleOf(s, 2026, '1/4')).toBeNull();
    expect(nalTitleOf(s, 2025, '1/3')).toBeNull();
    expect((s as { nalogPer?: string }).nalogPer).toBe('month');

    await db.transaction((tx) => setNalogTitle(tx, { firmId, userId: null, year: 2025, number: '1/3', title: 'ДДВ 2025' }));
    await db.transaction((tx) => setNalogTitle(tx, { firmId, userId: null, year: 2026, number: '1/3', title: '' }));
    s = await settings();
    expect(nalTitleOf(s, 2026, '1/3')).toBeNull();
    expect(nalTitleOf(s, 2025, '1/3')).toBe('ДДВ 2025');

    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'nalTitle'));
    expect(a.map((x) => x.data)).toEqual([
      { year: 2026, number: '1/3', from: null, to: 'ДДВ 01-03' },
      { year: 2025, number: '1/3', from: null, to: 'ДДВ 2025' },
      { year: 2026, number: '1/3', from: 'ДДВ 01-03', to: null },
    ]);
  });

  it('refuses a nalog that does not exist in that year', async () => {
    await expect(db.transaction((tx) => setNalogTitle(tx, { firmId, userId: null, year: 2025, number: '1/4', title: 'X' }))).rejects.toThrow('не постои');
  });
});
