/**
 * Reads that are not repeated and not lost (bank statements dropped in bulk):
 *  - `reusableReads`: a file whose content (sha256) already has a read of the same kind in the firm — done, saved, or
 *    still being read — gets that read back instead of a new one (no new AI / queue job; dropping the same 144 PDFs
 *    again costs nothing);
 *  - `pendingReads`: reads that are done but were never imported (the page was closed, the browser stopped waiting,
 *    a deploy restarted the server) — offered again for preview / import until saved or dismissed.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Tx } from './audit';
import { aiDocuments, files } from './schema/index';

const SHA = /^[0-9a-f]{64}$/;
/** Preference among reads of the same content: a finished one first, then one still running. */
const RANK: Record<string, number> = { done: 0, saved: 1, reading: 2, queued: 3 };
/** A read still queued / reading without a change for this long is taken as lost (a new read is started). */
export const READ_STALE_MS = 15 * 60_000;

type Q = Pick<Tx, 'select'>;

export interface ReusedRead { id: string; status: string }

/**
 * For each file (by id): an existing read of the same content (sha256; the file itself when it has no hash) of this
 * kind in this firm. Files without one are not in the map.
 */
export async function reusableReads(tx: Q, a: { firmId: string; kind: string; fileIds: readonly string[]; now?: Date }): Promise<Map<string, ReusedRead>> {
  const out = new Map<string, ReusedRead>();
  if (!a.fileIds.length) return out;
  const F = await tx.select({ id: files.id, sha: files.sha256 }).from(files).where(and(eq(files.firmId, a.firmId), inArray(files.id, [...a.fileIds])));
  const shas = [...new Set(F.map((f) => f.sha).filter((s) => SHA.test(s)))];
  const same = shas.length ? await tx.select({ id: files.id, sha: files.sha256 }).from(files).where(and(eq(files.firmId, a.firmId), inArray(files.sha256, shas))) : [];
  const keyOf = new Map<string, string>();
  for (const f of [...F, ...same]) keyOf.set(f.id, SHA.test(f.sha) ? f.sha : 'id:' + f.id);
  const D = await tx.select({ id: aiDocuments.id, fileId: aiDocuments.fileId, status: aiDocuments.status, options: aiDocuments.options, updatedAt: aiDocuments.updatedAt })
    .from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, a.firmId), eq(aiDocuments.kind, a.kind as never), inArray(aiDocuments.fileId, [...keyOf.keys()]), inArray(aiDocuments.status, ['done', 'saved', 'reading', 'queued'])))
    .orderBy(desc(aiDocuments.updatedAt));
  const now = (a.now ?? new Date()).getTime();
  const best = new Map<string, ReusedRead & { r: number }>();
  for (const d of D) {
    const o = (d.options ?? {}) as { extraFileIds?: unknown[]; cancelled?: boolean };
    if (o.extraFileIds?.length || o.cancelled) continue;
    if ((d.status === 'queued' || d.status === 'reading') && now - d.updatedAt.getTime() > READ_STALE_MS) continue;
    const k = keyOf.get(d.fileId!);
    if (!k) continue;
    const r = RANK[d.status] ?? 9;
    const b = best.get(k);
    if (!b || r < b.r) best.set(k, { id: d.id, status: d.status, r });
  }
  for (const id of a.fileIds) {
    const k = keyOf.get(id);
    const b = k ? best.get(k) : undefined;
    if (b) out.set(id, { id: b.id, status: b.status });
  }
  return out;
}

/** How far back finished reads are offered for import. */
export const PENDING_DAYS = 180;

export interface PendingRead { id: string; fileId: string; name: string; createdAt: Date }

/**
 * Finished reads of this kind that were never imported (status `done`, not dismissed), oldest first, plus how many
 * are still queued / reading. One per file content (the same PDF read twice is offered once).
 */
export async function pendingReads(tx: Q, a: { firmId: string; kind: string; limit?: number; now?: Date }): Promise<{ items: PendingRead[]; reading: number }> {
  const notDismissed = sql`coalesce((${aiDocuments.options} ->> 'dismissed')::boolean, false) = false`;
  // reads older than half a year are not offered any more (an abandoned read of an old period)
  const since = new Date((a.now ?? new Date()).getTime() - PENDING_DAYS * 86_400_000);
  const R = await tx.select({ id: aiDocuments.id, fileId: aiDocuments.fileId, name: files.name, sha: files.sha256, createdAt: aiDocuments.createdAt })
    .from(aiDocuments).innerJoin(files, eq(files.id, aiDocuments.fileId))
    .where(and(eq(aiDocuments.firmId, a.firmId), eq(aiDocuments.kind, a.kind as never), eq(aiDocuments.status, 'done'), isNotNull(aiDocuments.fileId), notDismissed, gte(aiDocuments.createdAt, since)))
    .orderBy(asc(aiDocuments.createdAt)).limit(a.limit ?? 500);
  const seen = new Set<string>();
  const items: PendingRead[] = [];
  for (const r of R) {
    const k = SHA.test(r.sha) ? r.sha : r.fileId!;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ id: r.id, fileId: r.fileId!, name: r.name, createdAt: r.createdAt });
  }
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, a.firmId), eq(aiDocuments.kind, a.kind as never), inArray(aiDocuments.status, ['queued', 'reading']), notDismissed))) as [{ n: number }];
  return { items, reading: n };
}

/** „Отфрли“: finished reads the user does not want to import leave the pending list (the read itself is kept). */
export async function dismissReads(tx: Pick<Tx, 'update'>, a: { firmId: string; ids: readonly string[] }): Promise<number> {
  const ok = a.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ok.length) return 0;
  const R = await tx.update(aiDocuments).set({ options: sql`${aiDocuments.options} || '{"dismissed":true}'::jsonb` })
    .where(and(eq(aiDocuments.firmId, a.firmId), inArray(aiDocuments.id, ok), eq(aiDocuments.status, 'done'))).returning({ id: aiDocuments.id });
  return R.length;
}

/** A dismissed read that is dropped again comes back to the pending list. */
export async function undismissReads(tx: Pick<Tx, 'update'>, a: { firmId: string; ids: readonly string[] }): Promise<void> {
  const ok = a.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ok.length) await tx.update(aiDocuments).set({ options: sql`${aiDocuments.options} - 'dismissed'` }).where(and(eq(aiDocuments.firmId, a.firmId), inArray(aiDocuments.id, ok)));
}
