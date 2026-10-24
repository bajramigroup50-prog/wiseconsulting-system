import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type DB } from '@wise/db';
import { setObjectRemover } from '../storage';
import { dropAbandonedUploads } from './maintenance';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
}, 120_000);
afterAll(() => setObjectRemover(null));

describe('maintenance: abandoned uploads', () => {
  it('deletes the storage object with the row; a row whose object could not be deleted stays for the next night', async () => {
    const old = new Date(Date.now() - 3 * 864e5);
    const f = (key: string, status: 'pending' | 'ready', createdAt: Date) => ({ bucketKey: key, name: key, mime: 'image/png', size: 1, sha256: key, status, createdAt });
    await pg.insert(schema.files).values([
      f('office/2026/old.png', 'pending', old), f('office/2026/fail.png', 'pending', old),
      f('office/2026/new.png', 'pending', new Date()), f('office/2026/ready.png', 'ready', old),
    ]);
    const removed: string[] = [];
    setObjectRemover(async (k) => { if (k.includes('fail')) throw new Error('S3 down'); removed.push(k); });
    expect(await dropAbandonedUploads(db)).toEqual({ removed: 1, failed: 1 });
    expect(removed).toEqual(['office/2026/old.png']);
    const left = (await pg.select({ k: schema.files.bucketKey }).from(schema.files)).map((r) => r.k).sort();
    expect(left).toEqual(['office/2026/fail.png', 'office/2026/new.png', 'office/2026/ready.png']);
  });
});
