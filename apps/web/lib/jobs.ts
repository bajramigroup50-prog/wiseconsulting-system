import 'server-only';
/** Enqueue background jobs for `apps/worker` (pg-boss in the same Postgres). */
import { PgBoss } from 'pg-boss';

let boss: Promise<PgBoss> | undefined;
const created = new Set<string>();

function getBoss(): Promise<PgBoss> {
  boss ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const b = new PgBoss(url);
    b.on('error', (e) => console.error('[pg-boss]', e));
    await b.start();
    return b;
  })();
  return boss;
}

/** Send a job; the queue is created on first use (the worker creates it too). */
export async function enqueue(name: string, data: object): Promise<void> {
  const b = await getBoss();
  if (!created.has(name)) {
    if (!(await b.getQueue(name))) await b.createQueue(name);
    created.add(name);
  }
  await b.send(name, data);
}
