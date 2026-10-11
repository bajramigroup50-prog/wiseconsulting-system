/**
 * Workflow-test harness: the real server actions and page loaders run against a migrated PGlite database with a
 * real session (users + sessions rows, the `wc_sess` cookie). Only the Next request context is replaced:
 *
 *   vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
 *   vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
 *   vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
 *
 * `signIn(role, firms)` creates a user + session; `useFirm(id)` sets the firm cookie like the firm picker.
 */
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, seedReference } from '@wise/db';

export const pg = drizzle(new PGlite(), { schema });
export type PgDb = typeof pg;
// Modules that call `getDb()` from `@wise/db` directly (proxy, kl-views) need, inline in the test file:
//   vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
(globalThis as { __wisePg?: unknown }).__wisePg = pg;

let ready: Promise<void> | null = null;
/** Migrate + seed once per test file. */
export const setupDb = () => (ready ??= (async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
})());

export const dbModule = { db: () => pg };

/* ---------- request context ---------- */
export const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (a: string | { name: string; value: string }, v?: string) => { if (typeof a === 'string') jar.set(a, String(v ?? '')); else jar.set(a.name, a.value); },
  delete: (name: string | { name: string }) => { jar.delete(typeof name === 'string' ? name : name.name); },
};
export const headersModule = {
  cookies: async () => cookieStore,
  headers: async () => new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' }),
  draftMode: async () => ({ isEnabled: false }),
};
export const revalidated: string[] = [];
export const cacheModule = {
  revalidatePath: (p: string) => { revalidated.push(p); },
  revalidateTag: () => {},
  unstable_cache: <T>(f: T) => f,
  refresh: () => {},
  updateTag: () => {},
};

/** A signed-in user (role, firm access) with a live session cookie. Returns the user id. */
export async function signIn(role: string, opts: { firms?: string[]; allFirms?: boolean; username?: string } = {}): Promise<string> {
  const username = opts.username ?? `${role}-${randomBytes(3).toString('hex')}`;
  const [u] = await pg.insert(schema.users).values({
    username, name: username, role: role as never, allFirms: opts.allFirms ?? role === 'admin', passwordHash: 'x', mustChangePassword: false,
  }).returning();
  if (opts.firms?.length) await pg.insert(schema.userFirms).values(opts.firms.map((firmId) => ({ userId: u!.id, firmId })));
  const token = randomBytes(24).toString('base64url');
  await pg.insert(schema.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId: u!.id, expiresAt: new Date(Date.now() + 864e5) });
  jar.set('wc_sess', token);
  return u!.id;
}

export const useFirm = (id: string) => { jar.set('wc_fid', id); };
export const useYear = (y: number) => { jar.set('wc_year', String(y)); };

/** FormData from a plain object (arrays → repeated keys). */
export function form(o: Record<string, string | number | boolean | File | (string | File)[] | undefined | null>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === false) continue;
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.append(k, v === true ? 'on' : v instanceof File ? v : String(v));
  }
  return f;
}

/** Runs a server action that may end in `redirect()`: returns the result or `{ redirect: url }`. */
export async function act<T>(p: Promise<T>): Promise<T | { redirect: string }> {
  try { return await p; } catch (e) {
    const d = (e as { digest?: string }).digest;
    if (typeof d === 'string' && d.startsWith('NEXT_REDIRECT')) return { redirect: d.split(';')[2] ?? '' };
    throw e;
  }
}

export const r2 = (v: number) => Math.round(v * 100) / 100;
