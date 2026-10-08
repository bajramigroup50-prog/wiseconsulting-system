import { and, eq, lt } from 'drizzle-orm';
import { files, sessions } from '@wise/db';
import { defineJob } from '../job';

/** Nightly: drop expired sessions and upload registrations that were never confirmed. */
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
  },
});
