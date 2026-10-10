/**
 * Firm data export / restore — the server version of legacy „Податоци и резервна копија“ (`VIEWS.sistem` 8992,
 * `backupJson`, `bkpRestoreFirm` 8987). Legacy copied the Firestore collections of a firm (`COLS`); here every table
 * of the schema that belongs to a firm is found from the Drizzle schema itself, so new modules are included
 * automatically:
 *  - firm tables: a `firm_id` column (except the audit log and user assignments, which are not firm data);
 *  - child tables: no `firm_id`, but a foreign key to a firm table (invoice lines, purchase cost lines, file links…).
 *
 * Restore replaces the firm's rows with the backup's in one transaction, in foreign-key order (children deleted
 * first, parents inserted first; self references are cleared and re-applied). Documents (`files`, `file_links`) are
 * merged instead of replaced: the stored objects stay in the bucket and later documents are not lost.
 * References to users that no longer exist are cleared (or set to the restoring user when required).
 */
import { and, eq, inArray, is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import { audit, type Tx } from './audit';
import * as S from './schema/index';
import { firms, users } from './schema/index';

export const FIRM_BACKUP_FORMAT = 'wise-firm-backup';
export const FIRM_BACKUP_VERSION = 1;

/** Not firm data: the audit trail is append-only, user access belongs to user administration. */
const SKIP = new Set(['audit_log', 'user_firms', 'sessions']);
/** Merged, never deleted on restore (documents in the bucket). */
const MERGE = new Set(['files', 'file_links']);

interface Ref { col: PgColumn; key: string; target: string; targetCol: string; notNull: boolean }
export interface FirmTable {
  name: string;
  table: PgTable;
  /** `firm`: own `firm_id`; `child`: rows reached through `parent.parentKey`. */
  mode: 'firm' | 'child';
  parent?: { table: string; col: PgColumn; parentCol: string };
  refs: Ref[];
  /** JS property names of `timestamp` columns (JSON strings → Date on restore). */
  dates: string[];
  serialId: boolean;
}

let _plan: FirmTable[] | undefined;

/** Firm tables in insert order (parents first). */
export function firmTables(): FirmTable[] {
  if (_plan) return _plan;
  const all = new Map<string, { table: PgTable; cfg: ReturnType<typeof getTableConfig> }>();
  for (const t of Object.values(S)) if (is(t, PgTable)) { const cfg = getTableConfig(t); all.set(cfg.name, { table: t, cfg }); }
  const keyOf = (t: PgTable, col: PgColumn) => Object.entries(t).find(([, v]) => v === col)?.[0] ?? col.name;
  const firmSet = new Set([...all].filter(([n, { cfg }]) => !SKIP.has(n) && cfg.columns.some((c) => c.name === 'firm_id')).map(([n]) => n));
  const out: FirmTable[] = [];
  const describe = (name: string, mode: 'firm' | 'child', parent?: FirmTable['parent']): FirmTable => {
    const { table, cfg } = all.get(name)!;
    const refs: Ref[] = cfg.foreignKeys.flatMap((fk) => {
      const r = fk.reference();
      const target = getTableConfig(r.foreignTable).name;
      return r.columns.map((col, i) => ({ col, key: keyOf(table, col), target, targetCol: r.foreignColumns[i]!.name, notNull: col.notNull }));
    });
    const dates = cfg.columns.filter((c) => c.columnType === 'PgTimestamp').map((c) => keyOf(table, c));
    const serialId = cfg.columns.some((c) => c.name === 'id' && c.columnType === 'PgBigSerial53');
    return { name, table, mode, parent, refs, dates, serialId };
  };
  for (const n of firmSet) out.push(describe(n, 'firm'));
  for (const [n, { cfg }] of all) {
    if (firmSet.has(n) || SKIP.has(n) || n === 'firms') continue;
    const fk = cfg.foreignKeys.map((f) => f.reference()).find((r) => firmSet.has(getTableConfig(r.foreignTable).name) && r.columns.length === 1);
    if (!fk) continue;
    // Global rows that merely point at a firm file (Word templates) are not firm data.
    if (n === 'word_templates') continue;
    out.push(describe(n, 'child', { table: getTableConfig(fk.foreignTable).name, col: fk.columns[0]!, parentCol: fk.foreignColumns[0]!.name }));
  }
  // Topological order on references between firm tables (self references are handled separately).
  const names = new Set(out.map((t) => t.name));
  const sorted: FirmTable[] = [];
  const state = new Map<string, 1 | 2>();
  const byName = new Map(out.map((t) => [t.name, t]));
  const visit = (t: FirmTable) => {
    const s = state.get(t.name);
    if (s === 2) return;
    if (s === 1) throw new Error(`firm-data: foreign-key cycle at ${t.name}`);
    state.set(t.name, 1);
    for (const r of t.refs) if (r.target !== t.name && names.has(r.target)) visit(byName.get(r.target)!);
    state.set(t.name, 2);
    sorted.push(t);
  };
  for (const t of [...out].sort((a, b) => a.name.localeCompare(b.name))) visit(t);
  return (_plan = sorted);
}

const col = (t: FirmTable, name: string) => getTableConfig(t.table).columns.find((c) => c.name === name)!;

/** Rows of one firm table (children through their parent's firm rows). */
async function rowsOf(tx: Tx, t: FirmTable, firmId: string): Promise<Record<string, unknown>[]> {
  if (t.mode === 'firm') return tx.select().from(t.table).where(eq(col(t, 'firm_id'), firmId)) as Promise<Record<string, unknown>[]>;
  const p = firmTables().find((x) => x.name === t.parent!.table)!;
  const sub = tx.select({ k: col(p, t.parent!.parentCol) }).from(p.table).where(eq(col(p, 'firm_id'), firmId));
  return tx.select().from(t.table).where(inArray(t.parent!.col, sub)) as Promise<Record<string, unknown>[]>;
}

export interface FirmBackup {
  format: typeof FIRM_BACKUP_FORMAT;
  version: number;
  at: string;
  firm: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Row counts per table for one firm (legacy „Оваа фирма – записи“). */
export async function firmRecordCounts(tx: Tx, firmId: string): Promise<{ table: string; n: number }[]> {
  const out: { table: string; n: number }[] = [];
  for (const t of firmTables()) {
    if (t.mode === 'firm') {
      const [r] = (await tx.select({ n: sql<number>`count(*)::int` }).from(t.table).where(eq(col(t, 'firm_id'), firmId))) as [{ n: number }];
      out.push({ table: t.name, n: r.n });
    } else {
      const p = firmTables().find((x) => x.name === t.parent!.table)!;
      const sub = tx.select({ k: col(p, t.parent!.parentCol) }).from(p.table).where(eq(col(p, 'firm_id'), firmId));
      const [r] = (await tx.select({ n: sql<number>`count(*)::int` }).from(t.table).where(inArray(t.parent!.col, sub))) as [{ n: number }];
      out.push({ table: t.name, n: r.n });
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

/** Everything of one firm as a JSON-able object. */
export async function exportFirm(tx: Tx, firmId: string): Promise<FirmBackup> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new FirmDataError('Фирмата не постои.');
  const tables: FirmBackup['tables'] = {};
  for (const t of firmTables()) {
    const R = await rowsOf(tx, t, firmId);
    if (R.length) tables[t.name] = R;
  }
  // JSON round trip: Date → ISO string, bigint-free (bigserial ids are numbers).
  return JSON.parse(JSON.stringify({ format: FIRM_BACKUP_FORMAT, version: FIRM_BACKUP_VERSION, at: new Date().toISOString(), firm: f, tables })) as FirmBackup;
}

export class FirmDataError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse and check an uploaded backup (legacy: „Ова не е резервна копија од програмата.“). */
export function parseFirmBackup(text: string): FirmBackup {
  let J: Partial<FirmBackup>;
  try { J = JSON.parse(text) as Partial<FirmBackup>; } catch { throw new FirmDataError('Датотеката не може да се прочита.'); }
  if (!J || J.format !== FIRM_BACKUP_FORMAT || !J.firm || typeof J.tables !== 'object' || !UUID.test(String(J.firm.id ?? ''))) {
    throw new FirmDataError('Ова не е резервна копија од програмата.');
  }
  if ((J.version ?? 0) > FIRM_BACKUP_VERSION) throw new FirmDataError('Копијата е од понова верзија на програмата.');
  return J as FirmBackup;
}

/** Counts per table in a backup (for the restore confirmation). */
export const backupCounts = (B: FirmBackup): Record<string, number> =>
  Object.fromEntries(Object.entries(B.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));

const chunks = <T>(a: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Replace the firm of the backup (`B.firm.id`; created when it doesn't exist) with the backup's state.
 * The caller checks the permission (legacy: administrator, `del`).
 */
export async function restoreFirm(tx: Tx, B: FirmBackup, a: { userId: string }): Promise<{ firmId: string; inserted: number; deleted: number; skipped: string[] }> {
  const firmId = String(B.firm.id);
  const plan = firmTables();
  const known = new Set(plan.map((t) => t.name));
  const skipped = Object.keys(B.tables).filter((k) => !known.has(k));
  const dateKeys = getTableConfig(firms).columns.filter((c) => c.columnType === 'PgTimestamp').map((c) => Object.entries(firms).find(([, v]) => v === c)?.[0] ?? c.name);
  const reviveDates = (row: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (typeof row[k] === 'string') row[k] = new Date(row[k] as string);
    return row;
  };
  const { id: _id, ...fr } = reviveDates({ ...B.firm }, dateKeys);
  const [cur] = await tx.select({ id: firms.id }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (cur) await tx.update(firms).set(fr as Partial<typeof firms.$inferInsert>).where(eq(firms.id, firmId));
  else await tx.insert(firms).values({ ...(fr as typeof firms.$inferInsert), id: firmId });

  // 1) delete current rows, children first; clear self references before deleting.
  let deleted = 0;
  for (const t of [...plan].reverse()) {
    if (MERGE.has(t.name)) continue;
    const self = t.refs.filter((r) => r.target === t.name);
    if (t.mode === 'firm') {
      if (self.length) await tx.update(t.table).set(Object.fromEntries(self.map((r) => [r.key, null]))).where(eq(col(t, 'firm_id'), firmId));
      const R = await tx.delete(t.table).where(eq(col(t, 'firm_id'), firmId)).returning({ x: sql`1` });
      deleted += R.length;
    } else {
      const p = plan.find((x) => x.name === t.parent!.table)!;
      const sub = tx.select({ k: col(p, t.parent!.parentCol) }).from(p.table).where(eq(col(p, 'firm_id'), firmId));
      const R = await tx.delete(t.table).where(inArray(t.parent!.col, sub)).returning({ x: sql`1` });
      deleted += R.length;
    }
  }

  // 2) insert, parents first.
  const userIds = new Set((await tx.select({ id: users.id }).from(users)).map((u) => u.id));
  let inserted = 0;
  for (const t of plan) {
    const rows = (B.tables[t.name] ?? []) as Record<string, unknown>[];
    if (!rows.length) continue;
    const self = t.refs.filter((r) => r.target === t.name && !r.notNull);
    const userRefs = t.refs.filter((r) => r.target === 'users');
    const prepared = rows.map((r0) => {
      const r = reviveDates({ ...r0 }, t.dates);
      if (t.mode === 'firm') r.firmId = firmId;
      for (const u of userRefs) if (r[u.key] != null && !userIds.has(String(r[u.key]))) r[u.key] = u.notNull ? a.userId : null;
      for (const s of self) r[s.key] = null;
      return r;
    });
    for (const part of chunks(prepared, 200)) {
      const q = tx.insert(t.table).values(part as never);
      await (MERGE.has(t.name) ? q.onConflictDoNothing() : q);
    }
    inserted += rows.length;
    // re-apply self references
    if (self.length) {
      const idCol = col(t, 'id');
      for (const r0 of rows) {
        const set = Object.fromEntries(self.filter((s) => r0[s.key] != null).map((s) => [s.key, r0[s.key]]));
        if (Object.keys(set).length) await tx.update(t.table).set(set).where(eq(idCol, r0.id as string));
      }
    }
    if (t.serialId) {
      await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('"${t.name}"', 'id'), greatest((select coalesce(max(id), 0) from "${t.name}"), 1))`));
    }
  }
  await audit(tx, { userId: a.userId, firmId, action: 'bkRestoreGo', entityType: 'firm', entityId: firmId, data: { at: B.at, inserted, deleted, skipped } });
  return { firmId, inserted, deleted, skipped };
}

/** Backup files of a firm stored in the archive (`files`), newest first. */
export const BACKUP_FILE_PREFIX = 'Rezervna_kopija_';
export const PRE_RESTORE_PREFIX = 'Pred_vrakjanje_';
export async function firmBackupFiles(tx: Tx, firmId: string) {
  const R = await tx.select().from(S.files).where(and(eq(S.files.firmId, firmId), eq(S.files.mime, 'application/json'), eq(S.files.status, 'ready')));
  return R.filter((f) => f.name.startsWith(BACKUP_FILE_PREFIX) || f.name.startsWith(PRE_RESTORE_PREFIX))
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

