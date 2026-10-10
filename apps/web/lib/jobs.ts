import 'server-only';
/**
 * Enqueue background jobs (pg-boss, same Postgres as the app) from server actions.
 * The web process only *sends*: no supervision, scheduling or migrations (the worker owns those).
 * This is the ONE job-sending helper of the web app: `lib/mail.ts` (`mail.send`), the AI reading jobs (`ai.read-document`),
 * `pdf.render` (below) and every other job go through `enqueue`. Do not create another pg-boss client.
 */
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import type { PdfFileLink } from '@wise/db';

let boss: Promise<PgBoss> | undefined;

function getBoss(): Promise<PgBoss> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  boss ??= (async () => {
    const b = new PgBoss({ connectionString: url, supervise: false, schedule: false, migrate: false, max: 2 });
    b.on('error', (e) => console.error('[pg-boss/web]', e));
    await b.start();
    return b;
  })().catch((e) => { boss = undefined; throw e; });
  return boss;
}

export async function enqueue(name: string, data: object): Promise<string | null> {
  const b = await getBoss();
  return b.send(name, data);
}

/**
 * `pdf.render` (worker, Chromium): returns the pre-allocated `files.id`; `/api/files/{id}` answers 404 until
 * the worker has stored the PDF.
 */
export async function renderPdf(p: { html: string; css?: string; title?: string; firmId?: string | null; userId?: string | null; landscape?: boolean; link?: PdfFileLink }): Promise<string> {
  const fileId = randomUUID();
  await enqueue('pdf.render', { ...p, fileId });
  return fileId;
}
