import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export * as schema from './schema/index';
export * from './schema/index';
export { audit, type Tx } from './audit';

export type DB = PostgresJsDatabase<typeof schema>;

let _db: DB | undefined;
/**
 * The pool lives on `globalThis`: Next bundles the proxy, route handlers and pages separately (and re-evaluates
 * modules on every dev reload), so a module-level singleton gave each bundle — and each reload — its own pool. With
 * the dev PGlite server (one Postgres session behind the socket) two pools interleaved their extended-protocol
 * messages („bind message supplies 4 parameters, but prepared statement requires 2“, uuid "f" errors).
 */
const G = globalThis as { __wiseDb?: { url: string; db: DB } };

/** Lazily-created singleton (one pool per process). */
export function getDb(url = process.env.DATABASE_URL): DB {
  if (_db) return _db;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (G.__wiseDb?.url === url) return (_db = G.__wiseDb.db);
  const client = postgres(url, { max: Number(process.env.DB_POOL ?? 10) });
  _db = drizzle(client, { schema });
  G.__wiseDb = { url, db: _db };
  return _db;
}
export * from './posting';
export * from './ledger-queries';
export { seedReference } from './seed/reference';
export * from './bank/index';
export * from './partner-accounts';
export * from './sales/context';
export * from './sales/invoices';
export * from './sales/purchases';
export * from './sales/supplier-credits';
export * from './sales/ai-docs';
export * from './vat-context';
export * from './vat-source';
export * from './vat-lock';
export * from './vat-service';
export * from './yearend';
export * from './office';
export * from './stock-service';
export * from './stock-docs';
export * from './transfer-links';
export * from './stock-reports';
export * from './payroll';
export * from './industry/index';
export * from './vat-estimate';
export * from './mail-queue';
export * from './sales/invoice-print';
export * from './mpin-in';
export * from './lawrep';
export * from './codebooks';
export * from './firm-data';
export * from './app-errors';
export * from './retail';
export * from './retail-items';
export * from './journal-override';
export * from './journal-override-save';
export * from './parity-retail';
export * from './fiscal-receipts';
export * from './parity-stock';
export * from './sales/partners-auto';
export * from './sales/invoice-production';
export * from './sales/invoice-nalog';
export * from './repost';
export * from './firm-years';
export * from './ai-settings';
export * from './ai-budget';
export * from './compliance';
export * from './law-search';
