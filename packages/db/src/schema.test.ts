import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { audit } from './audit';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
}, 60_000); // migrations on PGlite can exceed the 10 s default while other suites run in parallel

describe('schema v1 (migrations on PGlite)', () => {
  it('creates a firm and a user with firm access', async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'БАЈРАМИ ГРОУП ДООЕЛ', edb: 'MK4030000000000' }).returning();
    const [u] = await db.insert(schema.users).values({ username: 'Ana', name: 'Ана', role: 'acc', passwordHash: 'x' }).returning();
    await db.insert(schema.userFirms).values({ userId: u!.id, firmId: f!.id });
    expect(f!.vatRegistered).toBe(true);
    expect(f!.settings).toEqual({});
    const rows = await db.select().from(schema.userFirms).where(eq(schema.userFirms.userId, u!.id));
    expect(rows).toHaveLength(1);
  });

  it('usernames are unique case-insensitively', async () => {
    await expect(db.insert(schema.users).values({ username: 'ANA', name: 'x', passwordHash: 'x' })).rejects.toThrow();
  });

  it('audit rows roll back with their transaction', async () => {
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog);
    await expect(db.transaction(async (tx) => {
      await audit(tx, { userId: null, action: 'saveFirm', entityType: 'firm', entityId: '1' });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await db.transaction(async (tx) => audit(tx, { userId: null, action: 'newFirm' }));
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog);
    expect(after[0]!.n - before[0]!.n).toBe(1);
  });
});
