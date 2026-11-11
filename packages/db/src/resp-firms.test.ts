import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from './audit';
import { alSentFor, markAlSent, respFirms, saveRespFirms } from './resp-firms';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: Tx) => Promise<R>) => db.transaction((tx) => f(tx as unknown as Tx));
let a = '', b = '', f1 = '', f2 = '', f3 = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const U = await db.insert(schema.users).values([{ username: 'isra', name: 'Исра', role: 'acc', passwordHash: 'x' }, { username: 'ensar', name: 'Енсар', role: 'senior', passwordHash: 'x' }]).returning();
  a = U[0]!.id; b = U[1]!.id;
  const F = await db.insert(schema.firms).values([{ name: 'А' }, { name: 'Б' }, { name: 'В' }]).returning();
  f1 = F[0]!.id; f2 = F[1]!.id; f3 = F[2]!.id;
}, 60_000);

describe('firms per colleague', () => {
  it('saves a colleague\'s firms; a firm moves when another colleague takes it', async () => {
    await T((tx) => saveRespFirms(tx, { userId: a, firmIds: [f1, f2], by: null }));
    await T((tx) => saveRespFirms(tx, { userId: b, firmIds: [f2, f3], by: null }));
    const M = await respFirms(db as unknown as Tx);
    expect(M[a]).toEqual([f1]);
    expect(M[b]).toEqual([f2, f3]);
    await T((tx) => saveRespFirms(tx, { userId: a, firmIds: [], by: null }));
    expect((await respFirms(db as unknown as Tx))[a]).toBeUndefined();
  });
  it('remembers the last notice sent to a colleague', async () => {
    expect(await alSentFor(db as unknown as Tx, b)).toBeNull();
    await T((tx) => markAlSent(tx, { userId: b, by: 'Бурханетин', byId: null, n: 7, bad: 3 }));
    expect(await alSentFor(db as unknown as Tx, b)).toMatchObject({ by: 'Бурханетин', n: 7, bad: 3 });
  });
});
