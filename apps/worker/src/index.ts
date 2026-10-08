/**
 * pg-boss worker: AI document reading, OCR, PDFs, e-mail and scheduled jobs (added per phase).
 * The queue lives in the same Postgres (schema `pgboss`).
 */
import { PgBoss } from 'pg-boss';
import { getDb } from '@wise/db';
import { JOBS } from './jobs/index';
import { closeBrowser } from './pdf/render';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const boss = new PgBoss(url);
boss.on('error', (e) => console.error('[pg-boss]', e));
await boss.start();

const db = getDb(url);
for (const j of JOBS) {
  const log = (m: string) => console.log(`[${j.name}] ${m}`);
  await boss.createQueue(j.name);
  if (j.cron) await boss.schedule(j.name, j.cron, null, { tz: 'Europe/Skopje' });
  await boss.work(j.name, async (jobs) => {
    for (const job of jobs) await j.run(job.data, { db, log });
  });
}
console.log(`worker started: ${JOBS.map((j) => j.name).join(', ')}`);

const stop = async () => { await boss.stop({ graceful: true }); await closeBrowser(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
