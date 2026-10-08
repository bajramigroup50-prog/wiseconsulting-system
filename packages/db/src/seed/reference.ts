/**
 * Idempotent reference-data seed (Phase 2): the built-in chart of accounts (legacy `KONTO_SRC`, 2,859 accounts),
 * office-wide codebooks for cities (legacy `cbSeedCity`) and currencies (legacy `FX_DEF`).
 * Safe to run on every deploy: global rows are upserted by code; per-firm overrides are never touched.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '../audit';
import { accounts, codes } from '../schema/index';
import ACCOUNTS from './data/accounts.json' with { type: 'json' };
import CITIES from './data/cities.json' with { type: 'json' };
import CURRENCIES from './data/currencies.json' with { type: 'json' };

const chunks = <T>(a: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function seedReference(db: Tx): Promise<{ accounts: number; cities: number; currencies: number }> {
  const A = ACCOUNTS as [string, string][];
  for (const part of chunks(A, 500)) {
    await db.insert(accounts).values(part.map(([code, name]) => ({ code, name })))
      .onConflictDoUpdate({ target: accounts.code, targetWhere: sql`${accounts.firmId} is null`, set: { name: sql`excluded.name` } });
  }
  const C = CITIES as [string, string, string, string][];
  const fx = CURRENCIES as { date: string; rows: [string, string, number][] };
  const codeRows = [
    ...C.map(([code, name, postal, muni]) => ({ cb: 'city', code, name, data: { postal, muni } })),
    ...fx.rows.map(([code, name, rate]) => ({ cb: 'currency', code, name, data: { rate, date: fx.date } })),
  ];
  await db.insert(codes).values(codeRows)
    .onConflictDoNothing({ target: [codes.cb, codes.code], where: sql`${codes.firmId} is null and ${codes.code} is not null` });
  return { accounts: A.length, cities: C.length, currencies: fx.rows.length };
}
