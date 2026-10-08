/**
 * Local Postgres without Docker: PGlite served over the wire protocol on 127.0.0.1:54329.
 * Data persists in packages/db/.pglite. Dev only — production uses the postgres service in docker/compose.yml.
 *
 *   pnpm --filter @wise/db dev-server
 *   DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PGLITE_PORT ?? 54329);
const db = await PGlite.create(fileURLToPath(new URL('../.pglite', import.meta.url)));
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 20 });
await server.start();
console.log(`PGlite listening: postgres://postgres@127.0.0.1:${port}/postgres`);

const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
