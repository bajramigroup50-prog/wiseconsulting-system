/**
 * Reads interrupted by a worker restart (deploy, crash): the `ai_documents` / `firm_resh_reads` row stays
 * `queued` / `reading` while its pg-boss job is gone or still `active` for the dead process (pg-boss only fails it
 * after `expireInSeconds`). On startup the worker re-enqueues every such row that has not changed for `staleMs`
 * and has no job waiting (`created` / `retry`); the orphaned `active` jobs of those rows are cancelled first so they
 * are not retried later as a second read. Idempotent: a requeued row is touched (`updated_at`) and has a waiting job,
 * so the next sweep skips it.
 */
import { and, gt, inArray, lt, sql } from 'drizzle-orm';
import { aiDocuments, firmReshReads, type DB, type Tx } from '@wise/db';
import { AI_READ_DOCUMENT } from './jobs/ai-read-document';
import { AI_READ_FIRM_RESH } from './jobs/firm-resh';

/** One kind of long read: the job, the key of the row id in the job data, the interrupted rows and the reset. */
interface Spec {
  job: string; key: string;
  stale(db: DB | Tx, staleBefore: Date, newerThan: Date): Promise<string[]>;
  reset(db: DB | Tx, ids: string[]): Promise<unknown>;
}
const pend = ['queued', 'reading'] as const;
export const REQUEUE_SPECS: Spec[] = [
  {
    job: AI_READ_DOCUMENT, key: 'docId',
    // a cancelled read („Откажи читање“) is never started again
    stale: async (db, before, after) => (await db.select({ id: aiDocuments.id }).from(aiDocuments).where(and(
      inArray(aiDocuments.status, [...pend]), lt(aiDocuments.updatedAt, before), gt(aiDocuments.createdAt, after),
      sql`coalesce((${aiDocuments.options}->>'cancelled')::boolean, false) = false`))).map((r) => r.id),
    reset: (db, ids) => db.update(aiDocuments).set({ status: 'queued' }).where(inArray(aiDocuments.id, ids)),
  },
  {
    job: AI_READ_FIRM_RESH, key: 'id',
    stale: async (db, before, after) => (await db.select({ id: firmReshReads.id }).from(firmReshReads).where(and(
      inArray(firmReshReads.status, [...pend]), lt(firmReshReads.updatedAt, before), gt(firmReshReads.createdAt, after)))).map((r) => r.id),
    reset: (db, ids) => db.update(firmReshReads).set({ status: 'queued' }).where(inArray(firmReshReads.id, ids)),
  },
];

export interface QueueJob { id: string; state: string; rowId: string | null }
export interface RequeueDeps {
  /** Jobs of the queue in `created` / `retry` / `active` state (`rowId` = `data[key]`). */
  jobs(name: string, key: string): Promise<QueueJob[]>;
  send(name: string, data: object): Promise<unknown>;
  cancel(name: string, ids: string[]): Promise<unknown>;
  log?: (m: string) => void;
  now?: Date;
  /** Rows unchanged for this long count as interrupted (default 2 min). */
  staleMs?: number;
  /** Older rows are left alone (default 24 h; nobody waits for them and a read costs tokens). */
  maxAgeMs?: number;
}

/** Re-enqueue interrupted reads; returns the requeued row ids per job. */
export async function requeueStaleReads(db: DB | Tx, d: RequeueDeps): Promise<Record<string, string[]>> {
  const now = d.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (d.staleMs ?? 2 * 60_000));
  const newerThan = new Date(now.getTime() - (d.maxAgeMs ?? 24 * 3600_000));
  const out: Record<string, string[]> = {};
  for (const s of REQUEUE_SPECS) {
    const rows = await s.stale(db, staleBefore, newerThan);
    out[s.job] = [];
    if (!rows.length) continue;
    const J = await d.jobs(s.job, s.key);
    const waiting = new Set(J.filter((j) => j.state === 'created' || j.state === 'retry').map((j) => j.rowId));
    const ids = rows.filter((id) => !waiting.has(id));
    if (!ids.length) continue;
    const want = new Set(ids);
    const orphans = J.filter((j) => j.state === 'active' && j.rowId && want.has(j.rowId)).map((j) => j.id);
    if (orphans.length) {
      try { await d.cancel(s.job, orphans); } catch (e) { d.log?.(`[requeue] ${s.job}: cancel failed: ${(e as Error).message}`); }
    }
    // back to `queued` (and `updated_at` touched) before the job is sent: a second sweep does not send it again
    await s.reset(db, ids);
    for (const id of ids) await d.send(s.job, { [s.key]: id });
    out[s.job] = ids;
    d.log?.(`[requeue] ${s.job}: ${ids.length} interrupted read(s) queued again`);
  }
  return out;
}

/** pg-boss jobs of a queue that are waiting or running (straight from the `pgboss.job` table). */
export async function pgbossJobs(db: DB, name: string, key: string): Promise<QueueJob[]> {
  const R = await db.execute(sql`select id::text as id, state::text as state, data->>${key} as "rowId" from pgboss.job
    where name = ${name} and state in ('created', 'retry', 'active')`);
  return (R as unknown as QueueJob[]).map((r) => ({ id: r.id, state: r.state, rowId: r.rowId }));
}
