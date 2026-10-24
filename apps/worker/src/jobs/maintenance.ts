import { and, eq, inArray, lt } from 'drizzle-orm';
import { autoMergePartnerDupsSafe, files, firms, sessions, type DB } from '@wise/db';
import { defineJob } from '../job';
import { removeObject } from '../storage';

/**
 * Upload registrations never confirmed within a day: their storage object (the browser's PUT may have landed without
 * the confirm) is deleted first, then the row (FIX: only the rows were deleted, the objects stayed in the bucket for
 * ever). A row whose object could not be deleted stays for the next night.
 */
export async function dropAbandonedUploads(db: DB, now = new Date()): Promise<{ removed: number; failed: number }> {
  const rows = await db.select({ id: files.id, key: files.bucketKey }).from(files)
    .where(and(eq(files.status, 'pending'), lt(files.createdAt, new Date(now.getTime() - 864e5))));
  const gone: string[] = [];
  let failed = 0;
  for (const r of rows) {
    try {
      if (r.key) await removeObject(r.key);
      gone.push(r.id);
    } catch { failed++; }
  }
  for (let i = 0; i < gone.length; i += 500) await db.delete(files).where(and(inArray(files.id, gone.slice(i, i + 500)), eq(files.status, 'pending')));
  return { removed: gone.length, failed };
}

/**
 * Nightly: drop expired sessions and upload registrations that were never confirmed; „Автоматски спојувај сигурни
 * дупликати“ — the certain duplicate partners of every active firm with the setting on are merged (`@wise/db`
 * `autoMergePartnerDups`: locked periods refused, konto totals checked, audited as automatic).
 */
export const maintenance = defineJob({
  name: 'maintenance',
  cron: '15 3 * * *',
  async run(_data, { db, log }) {
    const now = new Date();
    const s = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
    const f = await dropAbandonedUploads(db, now);
    log(`expired sessions: ${s.length}, abandoned uploads: ${f.removed}${f.failed ? ` (${f.failed} objects not deleted – kept for the next night)` : ''}`);
    let merged = 0, groups = 0, skipped = 0;
    for (const x of await db.select({ id: firms.id }).from(firms).where(eq(firms.active, true))) {
      const r = await autoMergePartnerDupsSafe(db, x.id);
      if ('error' in r) { log(`partner auto-merge ${x.id}: ${r.error}`); continue; }
      merged += r.merged; groups += r.groups; skipped += r.skipped.length;
    }
    log(`partner auto-merge: ${groups} groups, ${merged} partners merged, ${skipped} refused`);
  },
});
