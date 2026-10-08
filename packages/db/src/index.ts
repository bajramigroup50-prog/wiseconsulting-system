import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export * as schema from './schema/index';
export * from './schema/index';
export { audit, type Tx } from './audit';

export type DB = PostgresJsDatabase<typeof schema>;

let _db: DB | undefined;

/** Lazily-created singleton (one pool per process). */
export function getDb(url = process.env.DATABASE_URL): DB {
  if (_db) return _db;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: Number(process.env.DB_POOL ?? 10) });
  _db = drizzle(client, { schema });
  return _db;
}
export * from './posting';
export * from './ledger-queries';
export { seedReference } from './seed/reference';
