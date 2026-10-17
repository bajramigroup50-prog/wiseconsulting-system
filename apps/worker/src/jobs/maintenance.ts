import { and, eq, lt } from 'drizzle-orm';
import { autoMergePartnerDupsSafe, files, firms, sessions } from '@wise/db';
import { defineJob } from '../job';

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
    const f = await db.delete(files)
      .where(and(eq(files.status, 'pending'), lt(files.createdAt, new Date(now.getTime() - 864e5))))
      .returning({ id: files.id });
    log(`expired sessions: ${s.length}, abandoned uploads: ${f.length}`);
    let merged = 0, groups = 0, skipped = 0;
    for (const x of await db.select({ id: firms.id }).from(firms).where(eq(firms.active, true))) {
      const r = await autoMergePartnerDupsSafe(db, x.id);
      if ('error' in r) { log(`partner auto-merge ${x.id}: ${r.error}`); continue; }
      merged += r.merged; groups += r.groups; skipped += r.skipped.length;
    }
    log(`partner auto-merge: ${groups} groups, ${merged} partners merged, ${skipped} refused`);
  },
});
