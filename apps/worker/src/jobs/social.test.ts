import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { patchSocialSettings, schema, sealSecret, socialPostList, type DB } from '@wise/db';
import { webCaption } from '@wise/core/social/post';
import { runNewsSq, runSocialPost, runSocialRokovi, runSocialWeb } from './social';
import { monthDeadlines } from '@wise/core/social/rokovi';

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

  it('one news item is posted once, however many times „Објави сега“ is clicked', async () => {
    const [n] = await pg.insert(schema.lawChanges).values({ key: 'twice', inst: 'UJP', title: 'Двапати кликнато', urls: ['https://www.ujp.gov.mk/t'], date: '2026-10-21' }).returning({ id: schema.lawChanges.id });
    const m = meta();
    const [a, b] = await Promise.all([runSocialPost(db, { lawId: n!.id }, () => {}, deps(m.f)), runSocialPost(db, { lawId: n!.id }, () => {}, deps(m.f))]);
    expect([a, b].sort()).toEqual(['already posted', 'posted']);
    expect(m.calls.filter((c) => c.includes('/photos')).length).toBe(1);
    expect(await runSocialPost(db, { lawId: n!.id }, () => {}, deps(m.f))).toBe('already posted');
  });
});

describe('social.web (the website news)', () => {
  const file = (urls: string[]) => async () => ({ sources: [{ id: 'ujp', name: 'УЈП', items: urls.map((u, i) => ({ title: 'Вест ' + u, url: 'https://www.ujp.gov.mk/' + u, date: `2026-11-${String(10 + i).padStart(2, '0')}` })) }] });

  it('off until switched on; then the backlog is only marked seen, new items go out one per run, newest first, once', async () => {
    const m = meta();
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: file(['a', 'b']) })).toBe('web off');
    await patchSocialSettings(db, { web: true, webPerDay: 2, webSince: '2026-11-18T08:00:00Z', webSeeded: null }, null);
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: file(['a', 'b']) })).toBe('seeded');
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: file(['a', 'b']) })).toBe('nothing new');
    expect(m.calls).toEqual([]);
    const news = file(['a', 'b', 'c', 'd', 'e']);
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: news })).toBe('posted');
    const [p] = await socialPostList(db);
    expect(p).toMatchObject({ status: 'posted', title: 'Вест e', inst: 'УЈП', newsUrl: 'https://www.ujp.gov.mk/e' });
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: news })).toBe('posted');
    expect((await socialPostList(db))[0]).toMatchObject({ title: 'Вест d' });
    // the daily limit (2); the skipped backlog is not listed
    expect(await runSocialWeb(db, () => {}, { ...deps(m.f), webNews: news })).toBe('daily limit');
    expect((await socialPostList(db, 100)).some((x) => x.title === 'Вест a')).toBe(false);
    expect(m.calls.filter((c) => c.includes('/photos')).length).toBe(2);
  });
});

describe('news.sq (the website news in Albanian)', () => {
  const file = (urls: string[]) => async () => ({ sources: [{ id: 'finance', name: 'Министерство за финансии', items: urls.map((u, i) => ({ title: 'Вест ' + u, url: 'https://finance.gov.mk/' + u, date: `2026-11-${String(10 + i).padStart(2, '0')}` })) }] });
  const tr = (calls: string[][]) => async (t: string[]) => { calls.push(t); return t.map((x) => x.replace('Вест', 'Lajm')); };

  it('translates only the new titles, keeps the known ones and drops those gone from the site', async () => {
    const calls: string[][] = [];
    let saved: Record<string, string> | null = null;
    const r = await runNewsSq(() => {}, {
      webNews: file(['a', 'b']),
      sqTitles: async () => ({ 'https://finance.gov.mk/a': 'Lajm a (i vjetër)', 'https://finance.gov.mk/x': 'jo më' }),
      translate: tr(calls),
      saveSq: async (t) => { saved = t; },
    });
    expect(r).toBe('translated 1');
    expect(calls).toEqual([['Вест b']]);
    expect(saved).toEqual({ 'https://finance.gov.mk/a': 'Lajm a (i vjetër)', 'https://finance.gov.mk/b': 'Lajm b' });
  });

  it('does nothing without the AI or when everything is translated', async () => {
    expect(await runNewsSq(() => {}, { webNews: file(['a']), translate: null })).toBe('ai off');
    const save = async () => { throw new Error('must not save'); };
    expect(await runNewsSq(() => {}, { webNews: file(['a']), sqTitles: async () => ({ 'https://finance.gov.mk/a': 'Lajm a' }), translate: tr([]), saveSq: save })).toBe('up to date');
  });
});

describe('social.web in two languages', () => {
  it('puts the Albanian title in the caption and on the card; a failed translation still posts in Macedonian', async () => {
    const m = meta();
    let html = '';
    const d = { ...deps(m.f), png: async (h: string) => { html = h; return new Uint8Array([1]); } };
    const news = async () => ({ sources: [{ id: 'ujp', name: 'УЈП', items: [{ title: 'Нов рок за ДДВ-04', url: 'https://www.ujp.gov.mk/sq1', date: '2026-11-30' }, { title: 'Втора вест', url: 'https://www.ujp.gov.mk/sq2', date: '2026-11-29' }] }] });
    await patchSocialSettings(db, { webPerDay: 7 }, null);
    expect(await runSocialWeb(db, () => {}, { ...d, webNews: news, sqTitles: async () => ({}), translate: async () => ['Afat i ri për ДДВ-04'] })).toBe('posted');
    expect(html).toContain('Afat i ri për ДДВ-04');
    expect(webCaption({ inst: 'УЈП', title: 'Нов рок', url: 'https://www.ujp.gov.mk/sq1', date: null, titleSq: 'Afat i ri' })).toMatch(/🔔 УЈП: Нов рок\n\n🇦🇱 Afat i ri\n/);
    expect(await runSocialWeb(db, () => {}, { ...d, webNews: news, sqTitles: async () => ({}), translate: async () => { throw new Error('AI down'); } })).toBe('posted');
    expect(html).toContain('Втора вест');
    expect(html).not.toContain('Afat i ri');
  });
});

describe('social.rokovi (the month\'s tax deadlines)', () => {
  it('moves a deadline on a weekend / holiday to the next working day and adds the annual returns in March', () => {
    expect(monthDeadlines(2026, 12)).toEqual([{ key: 'mpin', date: '2026-12-10' }, { key: 'pay', date: '2026-12-15' }, { key: 'ddv', date: '2026-12-25' }]);
    // 10.01.2027 is a Sunday → Monday the 11th
    expect(monthDeadlines(2027, 1)[0]).toEqual({ key: 'mpin', date: '2027-01-11' });
    expect(monthDeadlines(2027, 3).map((r) => r.key)).toEqual(['mpin', 'pay', 'year', 'ddv']);
  });

  it('posts one bilingual card once a month, only with the website news on', async () => {
    const m = meta();
    let html = '';
    const d = { ...deps(m.f), png: async (h: string) => { html = h; return new Uint8Array([1]); }, today: '2026-12-01' };
    await patchSocialSettings(db, { web: false }, null);
    expect(await runSocialRokovi(db, () => {}, d)).toBe('web off');
    await patchSocialSettings(db, { web: true }, null);
    expect(await runSocialRokovi(db, () => {}, d)).toBe('posted');
    expect(html).toContain('Декември 2026');
    expect(html).toContain('Dhjetor 2026');
    expect(html).toContain('Deklarimi dhe pagesa e TVSH-së');
    expect(await runSocialRokovi(db, () => {}, d)).toBe('already posted');
  });
});
