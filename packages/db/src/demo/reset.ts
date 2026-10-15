/**
 * 🎭 Demo reset: delete every demo firm (flag AND „ДЕМО“ prefix, re-checked in JS on every candidate) with all its data
 * and the demo users (`users.demo`, except the kept ones), then seed fresh demo data — one transaction, so a failure
 * anywhere leaves the database as it was. Real firms and real users are never touched: a candidate that fails the JS
 * check aborts the whole transaction before anything is deleted.
 *
 * The per-firm tables are found by walking the drizzle schema (every table with a `firm_id` column) and deleted with
 * `delete … where firm_id in (…)`; FK ordering between them is resolved by retrying a failed table (inside a
 * savepoint) after the others. Kept (their `firm_id` / `user_id` go to null through the FK): `audit_log` — append-only by
 * law (`compliance.sql` refuses DELETE) — and `ai_usage`, so the AI cost log stays whole.
 */
import { and, eq, getTableName, inArray, is, not } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import { isDemoFirm } from '@wise/core/demo';
import type { Tx } from '../audit';
import * as schema from '../schema/index';
import { firms, users } from '../schema/index';
import { demoFirmSql } from './filters';
import type { SQL } from 'drizzle-orm';
import { seedDemo, type SeedDemoResult } from './seed';

export class DemoResetError extends Error {}

/** Tables whose rows outlive the demo firm (their FK is `set null`): the append-only audit log and the AI cost log. */
const KEEP_TABLES = new Set(['audit_log', 'ai_usage']);

/** Throws unless EVERY row is a demo firm (flag AND prefix). */
export function assertDemoFirms(rows: readonly { id: string; name: string | null; settings: unknown }[]): void {
  const bad = rows.filter((r) => !isDemoFirm(r));
  if (bad.length) throw new DemoResetError(`Не е демо фирма: ${bad.map((b) => `„${b.name ?? ''}“ (${b.id})`).join(', ')} – ништо не е избришано.`);
}

/** Throws unless EVERY user row is a demo user. */
export function assertDemoUsers(rows: readonly { id: string; username: string; demo: boolean }[]): void {
  const bad = rows.filter((r) => r.demo !== true);
  if (bad.length) throw new DemoResetError(`Не е демо корисник: ${bad.map((b) => b.username).join(', ')} – ништо не е избришано.`);
}

/** Every schema table with a `firm_id` column (except `firms` and the kept tables), with that column. */
export function firmScopedTables(): { name: string; table: PgTable; col: PgColumn }[] {
  const out: { name: string; table: PgTable; col: PgColumn }[] = [];
  const seen = new Set<string>();
  for (const v of Object.values(schema)) {
    if (!is(v, PgTable) || v === firms) continue;
    const c = getTableConfig(v);
    const col = c.columns.find((x) => x.name === 'firm_id');
    if (!col || KEEP_TABLES.has(c.name) || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: getTableName(v), table: v, col });
  }
  return out;
}

export interface DeleteDemoResult { firmIds: string[]; userIds: string[]; rows: Record<string, number> }

/**
 * Delete all demo firms with their data and the demo users not in `keepUserIds`. Run it inside a transaction (it
 * throws, rolling back, when a candidate is not a demo firm / user or a row cannot be deleted).
 */
/**
 * `candidateSql` (tests only): a different candidate filter, to prove that the JS check still refuses a firm a drifted
 * SQL filter would select (the delete never relies on the SQL alone).
 */
export async function deleteDemoData(tx: Tx, opts: { keepUserIds: string[]; candidateSql?: SQL }): Promise<DeleteDemoResult> {
  // 1. candidates by SQL, then the hard JS check on every one of them
  const F = await tx.select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(opts.candidateSql ?? demoFirmSql).for('update');
  assertDemoFirms(F);
  const firmIds = F.map((f) => f.id);
  const keep = opts.keepUserIds.filter(Boolean);
  const U = await tx.select({ id: users.id, username: users.username, demo: users.demo }).from(users)
    .where(keep.length ? and(eq(users.demo, true), not(inArray(users.id, keep))) : eq(users.demo, true));
  assertDemoUsers(U);
  const userIds = U.map((u) => u.id);
  const rows: Record<string, number> = {};

  // 2. per-firm tables, in dependency order found by retrying (each attempt in a savepoint)
  if (firmIds.length) {
    let todo = firmScopedTables();
    let lastErr: unknown = null;
    while (todo.length) {
      const failed: typeof todo = [];
      for (const t of todo) {
        try {
          const n = await tx.transaction(async (sp) => (await sp.delete(t.table).where(inArray(t.col, firmIds)).returning({ x: t.col })).length);
          if (n) rows[t.name] = (rows[t.name] ?? 0) + n;
        } catch (e) {
          failed.push(t);
          lastErr = e;
        }
      }
      if (failed.length === todo.length) {
        const cause = (lastErr as { cause?: { message?: string } })?.cause?.message ?? (lastErr as Error)?.message ?? String(lastErr);
        throw new DemoResetError(`Демо податоците не можат да се избришат (${failed.map((t) => t.name).join(', ')}): ${cause}`);
      }
      todo = failed;
    }
    rows.firms = (await tx.delete(firms).where(inArray(firms.id, firmIds)).returning({ id: firms.id })).length;
  }
  // 3. demo users (sessions, demo links, user_firms cascade; audit rows and other references go to null)
  if (userIds.length) {
    rows.users = (await tx.delete(users).where(and(inArray(users.id, userIds), eq(users.demo, true))).returning({ id: users.id })).length;
  }
  return { firmIds, userIds, rows };
}

/** Delete the demo data and seed it again — one transaction. */
export async function resetDemo(db: Tx, opts: { adminUserId: string; year?: number; keepUserIds?: string[] }): Promise<SeedDemoResult & { deleted: DeleteDemoResult }> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Tx;
    const deleted = await deleteDemoData(tx, { keepUserIds: [opts.adminUserId, ...(opts.keepUserIds ?? [])] });
    const seeded = await seedDemo(tx, { adminUserId: opts.adminUserId, year: opts.year });
    return { ...seeded, deleted };
  });
}
