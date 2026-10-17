import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBankAccount, schema, seedReference, type Tx } from '@wise/db';
import { setObjectReader } from '../ai/storage';
import { linesToCells, textPdf } from '../ai/text-pdf.fixtures';
import { runIncomingDetect } from './incoming-detect';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', userId = '';
const OBJ = new Map<string, Uint8Array>();
const halk = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../../packages/core/test/golden/bank/fixtures/halk-mkd.xml', import.meta.url))));

async function incoming(name: string, mime: string, body: Uint8Array): Promise<string> {
  const key = 'k/' + Math.random();
  OBJ.set(key, body);
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: key, name, mime, size: body.length, sha256: key, status: 'ready', uploadedBy: userId }).returning();
  const [r] = await pg.insert(schema.incomingDocs).values({ firmId, fileId: f!.id, createdBy: userId }).returning();
  return r!.id;
}
const get = async (id: string) => (await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, id)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
  firmId = (await pg.insert(schema.firms).values({ name: 'Вајс Тест ДООЕЛ', edb: '4030000000001' }).returning())[0]!.id;
  userId = (await pg.insert(schema.users).values({ username: 'adm', name: 'Админ', role: 'admin', passwordHash: 'x' }).returning())[0]!.id;
  await pg.transaction((tx) => saveBankAccount(tx as never, { firmId, userId: null, input: { name: 'Халк', account: '270000012345678', cur: 'MKD', konto: '1000' } }));
  setObjectReader(async (k) => OBJ.get(k) ?? new Uint8Array());
}, 60_000);
afterAll(() => setObjectReader(null));

describe('incoming.detect', () => {
  it('a Halk XML statement of the firm: detected and imported automatically', async () => {
    const id = await incoming('izvod.xml', 'text/xml', halk);
    await runIncomingDetect(db, id);
    const r = await get(id);
    expect(r).toMatchObject({ kind: 'bank', how: 'bank', status: 'done', route: 'bank' });
    expect(r.result).toMatch(/Автоматски увезен/);
  });
  it('a text purchase PDF → влезна фактура, without AI, not routed by itself', async () => {
    const pdf = textPdf(linesToCells(['ФАКТУРА бр. 15/2026', 'Продавач: Алфа ДОО  ЕДБ 4030999999999', 'Купувач: Вајс Тест  ЕДБ 4030000000001', 'Вкупно за плаќање  11.800,00']));
    const id = await incoming('faktura.pdf', 'application/pdf', pdf);
    await runIncomingDetect(db, id);
    expect(await get(id)).toMatchObject({ kind: 'in', how: 'text', status: 'read', route: null });
  });
  it('a photo waits for the AI on the user\'s click', async () => {
    const id = await incoming('IMG_1.jpg', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]));
    await runIncomingDetect(db, id);
    const r = await get(id);
    expect(r).toMatchObject({ kind: 'unknown', status: 'read' });
    expect(r.detect).toMatchObject({ needsAi: true });
  });
});
