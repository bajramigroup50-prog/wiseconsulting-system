/**
 * Idempotent seed: reference data (chart of accounts, cities, currencies — see ./reference.ts),
 * then the first administrator if no users exist.
 * Credentials come from ADMIN_USERNAME (default `1`) and ADMIN_PASSWORD, set in .env on the server — never committed.
 * The system starts empty: no firms, no sample data, only this administrator.
 * Set ADMIN_MUST_CHANGE_PASSWORD=1 to force a password change at first login.
 */
import { sql } from 'drizzle-orm';
import { getDb, users } from '../index';
import { hashPassword } from '../password';
import { seedReference } from './reference';

const db = getDb();
const ref = await seedReference(db);
console.log(`seed: ${ref.accounts} accounts, ${ref.cities} cities, ${ref.currencies} currencies`);
const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users)) as [{ n: number }];

if (n > 0) {
  console.log(`seed: ${n} user(s) exist, nothing to do`);
} else if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) {
  // Don't block the stack from starting: set ADMIN_PASSWORD and re-run the seed (`docker compose run --rm migrate`).
  console.warn('seed: ADMIN_PASSWORD is not set (min 10 chars) — no administrator created yet');
} else {
  const username = process.env.ADMIN_USERNAME || '1';
  const password = process.env.ADMIN_PASSWORD;
  await db.insert(users).values({
    username,
    name: process.env.ADMIN_NAME ?? 'Администратор',
    role: 'admin',
    allFirms: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: process.env.ADMIN_MUST_CHANGE_PASSWORD === '1',
  });
  console.log(`seed: created admin "${username}"`);
}
process.exit(0);
