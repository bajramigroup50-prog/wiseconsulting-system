import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Drizzle maps a nested object of a LEFT-JOINED table to null as soon as its FIRST column is null – later non-null
// columns of the same table do not undo it. A partner without a code thus lost its name on the nalog print.
// Rule: a nested left-joined selection starts with a non-null column (the primary key).
const P = pgTable('p', { id: uuid('id').primaryKey().defaultRandom(), code: text('code'), name: text('name').notNull() });
const L = pgTable('l', { id: uuid('id').primaryKey().defaultRandom(), no: text('no').notNull(), partnerId: uuid('partner_id') });

const pg = new PGlite();
const db = drizzle(pg);

beforeAll(async () => {
  await pg.exec(`create table p (id uuid primary key default gen_random_uuid(), code text, name text not null);
    create table l (id uuid primary key default gen_random_uuid(), no text not null, partner_id uuid);`);
  const [a] = await db.insert(P).values({ code: null, name: 'Без шифра' }).returning();
  await db.insert(L).values([{ no: '1', partnerId: a!.id }, { no: '2', partnerId: null }]);
});
afterAll(() => pg.close());

describe('drizzle leftJoin nested selection', () => {
  it('a nullable first column nulls the whole nested object (the bug)', async () => {
    const R = await db.select({ no: L.no, p: { code: P.code, name: P.name } }).from(L).leftJoin(P, eq(P.id, L.partnerId)).orderBy(asc(L.no));
    expect(R[0]!.p).toBeNull();
    expect(R[1]!.p).toBeNull();
  });
  it('the primary key first keeps the object of a joined row and nulls only an unmatched one (the fix)', async () => {
    const R = await db.select({ no: L.no, p: { id: P.id, code: P.code, name: P.name } }).from(L).leftJoin(P, eq(P.id, L.partnerId)).orderBy(asc(L.no));
    expect(R[0]!.p).toMatchObject({ code: null, name: 'Без шифра' });
    expect(R[1]!.p).toBeNull();
  });
});
