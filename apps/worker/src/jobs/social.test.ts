import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { patchSocialSettings, schema, sealSecret, socialPostList, type DB } from '@wise/db';
import { runSocialPost } from './social';

process.env.S3_SECRET_KEY ||= 'test-secret';
const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;

/** Records the Graph calls and answers like Meta does. */
function meta() {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u.replace(/access_token=[^&]+/, 'access_token=…')}`);
    const j = u.includes('/photos') ? { id: 'ph1', post_id: 'PAGE_1' }
      : u.endsWith('/media') ? { id: 'cont1' }
      : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
      : u.endsWith('/media_publish') ? { id: 'ig1' }
      : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/p/x/' } : {};
    return new Response(JSON.stringify(j), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}
const deps = (f: typeof fetch) => ({ fetch: f, png: async () => new Uint8Array([1, 2, 3]), upload: async () => 'https://files.example/card.png', wait: async () => {} });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
}, 60_000);

describe('social.post', () => {
  it('does nothing until connected and switched on', async () => {
    const m = meta();
    expect(await runSocialPost(db, null, () => {}, deps(m.f))).toBe('not connected');
    await patchSocialSettings(db, { pages: [{ id: 'PAGE', name: 'Wise Cónsulting', igId: 'IG', igName: 'wiseconsulting1', token: sealSecret('tok') }], pageId: 'PAGE' }, null);
    expect(await runSocialPost(db, null, () => {}, deps(m.f))).toBe('auto off');
    expect(m.calls).toEqual([]);
  });

  it('posts only news found after switching on, once, to Facebook and Instagram; one a day', async () => {
    await pg.insert(schema.lawChanges).values({ key: 'old', inst: 'UJP', title: 'Стара новост', date: '2026-10-01', createdAt: new Date('2026-10-01T08:00:00Z') });
    await patchSocialSettings(db, { auto: true, perDay: 1, since: '2026-10-10T00:00:00Z' }, null);
    const m = meta();
    expect(await runSocialPost(db, null, () => {}, deps(m.f))).toBe('nothing new');
    await pg.insert(schema.lawChanges).values({ key: 'new', inst: 'UJP', title: 'Нов рок за ДДВ-04', what: 'Рокот се поместува.', urls: ['https://www.ujp.gov.mk/x'], date: '2026-10-20' });
    expect(await runSocialPost(db, null, () => {}, deps(m.f))).toBe('posted');
    expect(m.calls.some((c) => c.startsWith('POST') && c.includes('/PAGE/photos'))).toBe(true);
    expect(m.calls.some((c) => c.includes('/IG/media_publish'))).toBe(true);
    const [p] = await socialPostList(db);
    expect(p).toMatchObject({ status: 'posted', fbPostId: 'PAGE_1', igLink: 'https://www.instagram.com/p/x/', title: 'Нов рок за ДДВ-04' });
    // the daily limit
    // without a source link or not confirmed: never posted
    await pg.insert(schema.lawChanges).values({ key: 'nosrc', inst: 'UJP', title: 'Без извор', date: '2026-10-20' });
    await pg.insert(schema.lawChanges).values({ key: 'unver', inst: 'UJP', title: 'Да се потврди', urls: ['https://x.mk/1'], verified: false, date: '2026-10-20' });
    await pg.insert(schema.lawChanges).values({ key: 'new2', inst: 'SV', title: 'Втора новост', urls: ['https://www.slvesnik.com.mk/2'], date: '2026-10-20' });
    expect(await runSocialPost(db, null, () => {}, deps(meta().f))).toBe('daily limit');
  });

  it('a failing Instagram still keeps the Facebook post (partial)', async () => {
    await patchSocialSettings(db, { perDay: 2 }, null);
    const calls: string[] = [];
    const f = (async (url: string | URL | Request) => {
      const u = String(url); calls.push(u);
      if (u.includes('/photos')) return new Response(JSON.stringify({ id: 'p2', post_id: 'PAGE_2' }));
      return new Response(JSON.stringify({ error: { message: 'Invalid image' } }), { status: 400 });
    }) as typeof fetch;
    expect(await runSocialPost(db, null, () => {}, deps(f))).toBe('partial');
    const [p] = await socialPostList(db);
    expect(p).toMatchObject({ status: 'partial', fbPostId: 'PAGE_2', title: 'Втора новост' });
    expect(p!.error).toContain('Instagram: Invalid image');
  });
});
