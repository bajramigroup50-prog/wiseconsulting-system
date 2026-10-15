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

// `WISE_TEST_PGLITE_DIR`: a persistent PGlite data directory (the demo seed in test/demo fills the dev database).
export const pg = drizzle(new PGlite(process.env.WISE_TEST_PGLITE_DIR || undefined), { schema });
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
/** Options of the last `set` per cookie (`maxAge`, `expires`, `secure`…) — the session-cookie tests read them. */
export const cookieOpts = new Map<string, Record<string, unknown>>();
/** Extra request headers (none by default — e.g. the tab guard's `x-wise-firm` / `x-wise-year` + `cookie`). */
export const reqHeaders = new Map<string, string>();
/** The raw `Cookie:` header of the jar as it is now (what the browser sends with the request). */
export const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
/**
 * A request sent by a page rendered for this firm / year (the headers `components/firm-guard.tsx` adds), with the
 * cookies the browser has right now. `pageFor(null)` clears it (a request without the headers).
 */
export function pageFor(p: { firm?: string | null; year?: number } | null) {
  reqHeaders.clear();
  if (!p) return;
  if (p.firm) reqHeaders.set('x-wise-firm', p.firm);
  if (p.year) reqHeaders.set('x-wise-year', String(p.year));
  reqHeaders.set('cookie', cookieHeader());
}
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (a: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof a === 'string') { jar.set(a, String(v ?? '')); cookieOpts.set(a, o ?? {}); } else { jar.set(a.name, a.value); cookieOpts.set(a.name, { ...a }); }
  },
  delete: (name: string | { name: string }) => { const n = typeof name === 'string' ? name : name.name; jar.delete(n); cookieOpts.delete(n); },
};
export const headersModule = {
  cookies: async () => cookieStore,
  headers: async () => new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1', ...Object.fromEntries(reqHeaders) }),
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

/** A signed-in user (role, firm access, 🎭 `demo` sets `users.demo`) with a live session cookie. Returns the user id. */
export async function signIn(role: string, opts: { firms?: string[]; allFirms?: boolean; username?: string; demo?: boolean } = {}): Promise<string> {
  const username = opts.username ?? `${role}-${randomBytes(3).toString('hex')}`;
  const [u] = await pg.insert(schema.users).values({
    username, name: username, role: role as never, allFirms: opts.allFirms ?? role === 'admin', passwordHash: 'x', mustChangePassword: false, demo: opts.demo ?? false,
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
