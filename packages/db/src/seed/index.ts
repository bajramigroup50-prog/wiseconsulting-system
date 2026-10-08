/**
 * Idempotent seed: creates the first administrator if no users exist.
 * The password comes from ADMIN_PASSWORD (set it in .env yourself); the admin must change it at first login.
 */
import { sql } from 'drizzle-orm';
import { getDb, users } from '../index';
import { hashPassword } from '../password';

const db = getDb();
const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users)) as [{ n: number }];

if (n > 0) {
  console.log(`seed: ${n} user(s) exist, nothing to do`);
} else {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set ADMIN_PASSWORD (min 10 chars) to create the first admin');
  await db.insert(users).values({
    username,
    name: process.env.ADMIN_NAME ?? 'Администратор',
    role: 'admin',
    allFirms: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
  });
  console.log(`seed: created admin "${username}"`);
}
process.exit(0);
