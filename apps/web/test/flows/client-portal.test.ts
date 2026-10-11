/**
 * Workflow 9 — client portal: a `klient` user of a firm sees only the sections the office switched on (menu), the
 * global route guard (`proxy.ts`) sends every other page back to 🏠 and refuses office API calls, and `/api/files/:id`
 * serves a client only their own uploads, the firm images and files of the opened sections.
 */
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9339';
process.env.S3_ACCESS_KEY ??= 'test';
process.env.S3_SECRET_KEY ??= 'testtesttest';

const { proxy } = await import('@/proxy');
const { klNav } = await import('@/lib/kl-nav');
const { navFlat } = await import('@/lib/nav');
const filesRoute = await import('@/app/api/files/[id]/route');

let firmId = '', other = '', klientId = '';
const F: Record<string, string> = {};

const req = (path: string) => new NextRequest(new URL(path, 'http://localhost'), { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
async function verdict(path: string): Promise<string> {
  const r = await proxy(req(path));
  if (r.headers.get('x-middleware-next')) return 'next';
  if (r.status === 403) return '403';
  return new URL(r.headers.get('location')!).pathname;
}

async function file(name: string, firm: string, by: string | null, link?: { entityType: string; role?: string }) {
  const [f] = await pg.insert(schema.files).values({ firmId: firm, bucketKey: `firms/${firm}/2026/${name}`, name, mime: 'application/pdf', size: 10, sha256: name, status: 'ready', uploadedBy: by }).returning();
  if (link) await pg.insert(schema.fileLinks).values({ fileId: f!.id, entityType: link.entityType, entityId: 'x', role: link.role ?? 'attachment' });
  return f!.id;
}
const get = async (id: string) => (await filesRoute.GET(new Request(`http://localhost/api/files/${id}`), { params: Promise.resolve({ id }) })).status;

beforeAll(async () => {
  await setupDb();
  const [a, b] = await pg.insert(schema.firms).values([
    { name: 'КЛИЕНТ ДООЕЛ', settings: { kl: { on: { izlez: true, vlez: false, dash: false } } } },
    { name: 'ДРУГ КЛИЕНТ ДОО', settings: {} },
  ]).returning();
  firmId = a!.id; other = b!.id;
  // office files of the firm (uploaded by an office user)
  const office = await signIn('acc', { allFirms: true });
  F.inv = await file('faktura.pdf', firmId, office, { entityType: 'invoice' });
  F.pur = await file('vlezna.pdf', firmId, office, { entityType: 'purchase' });
  F.nal = await file('nalog.pdf', firmId, office, { entityType: 'journal' });
  F.logo = await file('logo.png', firmId, office);
  await pg.update(schema.firms).set({ settings: { kl: { on: { izlez: true, vlez: false, dash: false } }, logo: F.logo } }).where(eq(schema.firms.id, firmId));
  F.otherFirm = await file('tuga.pdf', other, office, { entityType: 'invoice' });
  klientId = await signIn('klient', { firms: [firmId] });
  useFirm(firmId);
  F.mine = await file('moja.pdf', firmId, klientId);
}, 120_000);

describe('flow 9 — client portal', () => {
  it('the client menu has only the sections the office switched on', async () => {
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    const ids = (await klNav(f!)).flatMap(([, items]) => navFlat(items).map(([id]) => id));
    expect(ids).toContain('klHome');
    expect(ids).toContain('izlez');
    expect(ids).not.toContain('vlez');
    expect(ids).not.toContain('nalozi');
    expect(ids).not.toContain('klDash');
  });

  it('the route guard keeps the client in the portal', async () => {
    expect(await verdict('/')).toBe('/klHome');
    expect(await verdict('/klHome')).toBe('next');
    expect(await verdict('/izlez')).toBe('next');
    expect(await verdict('/nalozi')).toBe('/klHome');
    expect(await verdict('/vlez')).toBe('/klHome');
    expect(await verdict('/print/nalog/1')).toBe('/klHome');
    expect(await verdict('/print/doc/1')).toBe('next'); // an issued invoice's print (izlez on)
    expect(await verdict('/api/files/abc')).toBe('next');
    expect(await verdict('/api/jobs')).toBe('403');
  });

  it('file access: own uploads, firm images and files of the opened sections only', async () => {
    expect(await get(F.mine!)).toBe(302);
    expect(await get(F.logo!)).toBe(302);
    expect(await get(F.inv!)).toBe(302);
    expect(await get(F.pur!)).toBe(404); // vlez is off
    expect(await get(F.nal!)).toBe(404); // office record
    expect(await get(F.otherFirm!)).toBe(404); // another firm
  });

  it('office users are not narrowed', async () => {
    await signIn('acc', { allFirms: true });
    expect(await verdict('/nalozi')).toBe('next');
    expect(await get(F.nal!)).toBe(302);
  });
});
