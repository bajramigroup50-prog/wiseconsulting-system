/**
 * pg-boss worker: AI document reading, OCR, PDFs, e-mail and scheduled jobs (added per phase).
 * The queue lives in the same Postgres (schema `pgboss`).
 */
import { PgBoss } from 'pg-boss';
import { getDb } from '@wise/db';
import { JOBS } from './jobs/index';
import { closeBrowser } from './pdf/render';
import { pgbossJobs, requeueStaleReads } from './requeue';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const boss = new PgBoss(url);
boss.on('error', (e) => console.error('[pg-boss]', e));
await boss.start();

const db = getDb(url);
const send = (name: string, data: object) => boss.send(name, data);
for (const j of JOBS) {
  const log = (m: string) => console.log(`[${j.name}] ${m}`);
  await boss.createQueue(j.name, j.queue);
  // createQueue leaves an existing queue as it was: the options are applied again
  if (j.queue) await boss.updateQueue(j.name, j.queue);
  if (j.cron) await boss.schedule(j.name, j.cron, null, { tz: 'Europe/Skopje' });
  await boss.work(j.name, { localConcurrency: j.concurrency ?? 1 }, async (jobs) => {
    for (const job of jobs) await j.run(job.data, { db, log, send });
  });
}
// reads interrupted by the previous worker (deploy / crash) are queued again instead of staying „се чита…“ forever
try {
  await requeueStaleReads(db, {
    jobs: (name, key) => pgbossJobs(db, name, key),
    send, cancel: (name, ids) => boss.cancel(name, ids),
    log: (m) => console.log(m),
  });
} catch (e) { console.error('[requeue]', e); }
console.log(`worker started: ${JOBS.map((j) => j.name).join(', ')}`);

const stop = async () => { await boss.stop({ graceful: true }); await closeBrowser(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
