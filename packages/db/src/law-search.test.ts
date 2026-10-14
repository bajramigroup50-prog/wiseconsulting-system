import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { lawDiff, diffChanged } from '@wise/core/law';
import { getLawArticle, lawArticleExists, lawArticleVersions, lawCorpusStatus, lawFirmFacts, searchLawArticles, storeLawText } from './law-search';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });

const V1 = `ЗАКОН ЗА ДАНОКОТ НА ДОДАДЕНА ВРЕДНОСТ
Предмет
Член 1
Со овој закон се воведува данок на додадена вредност.

Настанување на даночна обврска
Член 14
(1) Даночната обврска настанува во моментот кога е извршен прометот.
(2) Ако надоместокот е платен пред извршување на прометот (аванс), даночната обврска настанува со наплатата на авансот.

Повластена стапка
Член 30
Повластената стапка на данокот е 5%.`;
const V2 = V1.replace('Повластената стапка на данокот е 5%.', 'Повластената стапка на данокот е 10%.');
const ZIN = `ЗАКОН ЗА ИНСПЕКЦИСКИ НАДЗОР
Рокови
Член 32
Инспекцискиот надзор се врши во рок од 15 дена од денот на поднесувањето на иницијативата.`;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ (2024)', text: V1, asOf: '2024-01-01', sourceUrl: 'https://ujp.gov.mk/a.pdf' });
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ (30.12.2025)', text: V2, asOf: '2025-12-30', effectiveFrom: '2026-01-01', sourceUrl: 'https://ujp.gov.mk/b.pdf' });
  await storeLawText(db, { law: 'zin', title: 'ЗИН', text: ZIN, asOf: '2023-05-01', source: 'manual' });
}, 60_000);

describe('law article store', () => {
  it('same text twice → no new version; no articles → error', async () => {
    expect((await storeLawText(db, { law: 'zddv', title: 'x', text: V2 + '  ' })).isNew).toBe(false);
    await expect(storeLawText(db, { law: 'zro', title: 'x', text: 'без членови' })).rejects.toThrow(/не се најдени членови/);
    const C = await lawCorpusStatus(db);
    expect(C.find((c) => c.law === 'zddv')).toMatchObject({ versions: 2, latest: { asOf: '2025-12-30' } });
    expect(C.find((c) => c.law === 'zro')!.versions).toBe(0);
  });
  it('retrieval by article reference and by keyword (stemmed, ranked), in the applicable version', async () => {
    const byRef = await searchLawArticles(db, 'Што вели чл. 30 ЗДДВ?');
    expect(byRef[0]).toMatchObject({ law: 'zddv', no: '30', via: 'ref', asOf: '2025-12-30' });
    expect(byRef[0]!.body).toContain('10%');
    const old = await searchLawArticles(db, 'чл. 30 ЗДДВ', { date: '2025-06-30' });
    expect(old[0]!.body).toContain('5%');
    const kw = await searchLawArticles(db, 'Дали фирмата требаше да пресмета ДДВ на авансот?', { laws: ['zddv'] });
    expect(kw[0]).toMatchObject({ no: '14', via: 'fts' });
    const zin = await searchLawArticles(db, 'рок за инспекциски надзор');
    expect(zin.map((h) => h.law)).toContain('zin');
    expect(await searchLawArticles(db, 'нешто сосема непостоечко xyzq')).toEqual([]);
    expect(await searchLawArticles(db, 'чл. 30', { date: '2020-01-01', laws: ['zddv'] })).toEqual([]);
  });
  it('version ↔ version of one article', async () => {
    const V = await lawArticleVersions(db, 'zddv', '30');
    expect(V.map((v) => v.asOf)).toEqual(['2024-01-01', '2025-12-30']);
    const D = lawDiff(V[0]!.body, V[1]!.body);
    expect(diffChanged(D)).toBe(true);
    expect(D.filter((d) => d.t !== 'eq').map((d) => d.s)).toEqual(['5%.', '10%.']);
    expect((await getLawArticle(db, 'zddv', '14'))!.heading).toBe('Настанување на даночна обврска');
    expect(await lawArticleExists(db, 'zddv', '77')).toBe(false);
    expect(await lawArticleExists(db, '*', '32')).toBe(true);
  });
  it('firm facts: sales by rate, advances, purchases', async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'Факти ДООЕЛ', vatRegistered: true }).returning();
    const [i] = await db.insert(schema.invoices).values({ firmId: f!.id, kind: 'invoice', number: 'F-1', date: '2026-02-10', base: '1000', vat: '180', total: '1180' }).returning();
    await db.insert(schema.invoiceLines).values({ invoiceId: i!.id, lineNo: 1, name: 'Услуга', qty: '2', price: '500', rate: 18, account: '7400' });
    await db.insert(schema.invoices).values({ firmId: f!.id, kind: 'invoice', number: 'A-1', date: '2026-02-11', base: '500', vat: '0', total: '500', advance: true });
    await db.insert(schema.purchases).values({ firmId: f!.id, number: 'P-1', date: '2026-02-12', base: '100', vat: '18', total: '118', cash: true });
    const F = await lawFirmFacts(db, f!, '2026-01-01', '2026-03-31', '2026-10-14');
    expect(F.sales).toMatchObject({ count: 2, base: 1500, vat: 180, byRate: { 18: 1000 }, advances: { count: 1, vat: 0 } });
    expect(F.purchases).toMatchObject({ count: 1, cash: { count: 1, total: 118 } });
    expect(F.docs![0]).toMatchObject({ no: 'F-1', total: 1180 });
  });
});
