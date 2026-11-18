/**
 * 📣 Објави на мрежи (`social.post`): the robot's next PUBLIC law news item → a WISE card (PNG) + caption → the office's
 * Facebook page and Instagram. Cron 09:00 and 15:00 (Skopje): with „1 дневно“ only one post a day. `{ lawId }` posts
 * that item now (📣 Објави сега on the screen). Reads only `law_changes` – never anything of the firms.
 */
import { readFile } from 'node:fs/promises';
import { todaySkopje } from '@wise/core/office';
import { CARD_H, CARD_W, caption, cardHtml, socialPage, webAsNews, webCaption, webNewsItems, type SocialNews, type SocialPage, type SocialSettings, type WebNews } from '@wise/core/social/post';
import { claimSocialPost, claimWebPost, getSocialSettings, nextSocialNews, nextWebNews, openSecret, patchSocialSettings, recordSocialPost, recordWebPost, seedWebNews, socialNewsById, socialPostsToday, type DB } from '@wise/db';
import { defineJob } from '../job';
import { htmlToPng } from '../pdf/render';
import { objectKey, publicGetUrl, s3Store } from '../storage';
import { fbPhotoPost, igImagePost } from '../social/graph';

export interface SocialDeps {
  fetch?: typeof fetch;
  png?: (html: string) => Promise<Uint8Array>;
  upload?: (png: Uint8Array) => Promise<string>;
  wait?: (ms: number) => Promise<void>;
  /** The website's news (`news.json`); default: the file the host cron writes (`SITE_NEWS_FILE`). */
  webNews?: () => Promise<unknown>;
}

/** Store the card and give Meta a public link to it. */
async function uploadCard(png: Uint8Array): Promise<string> {
  const key = objectKey(null, 'png');
  await s3Store.put(key, png, 'image/png');
  return publicGetUrl(key);
}

export async function runSocialPost(db: DB, data: { lawId?: string } | null, log: (m: string) => void, deps: SocialDeps = {}): Promise<string> {
  const s = await getSocialSettings(db);
  const page = socialPage(s);
  const token = page ? openSecret(page.token) : null;
  if (!page || !token) return 'not connected';
  const manual = !!data?.lawId;
  if (!manual) {
    if (!s.auto) return 'auto off';
    if ((await socialPostsToday(db)) >= s.perDay) return 'daily limit';
  }
  const n = manual ? await socialNewsById(db, data!.lawId!) : await nextSocialNews(db, s.since);
  if (!n) return 'nothing new';
  // never twice: a second „Објави сега“ click (or the cron meeting a click) finds it claimed / posted
  if (!(await claimSocialPost(db, n.id))) return 'already posted';
  const r = await publishCard(s, page, token, n, caption(n), deps);
  await recordSocialPost(db, { lawId: n.id, ...r });
  log(`social: ${r.status} „${n.title.slice(0, 60)}“${r.error ? ' – ' + r.error : ''}`);
  return r.status;
}

/** The card (PNG) + caption → the page's Facebook and (when linked) Instagram. */
async function publishCard(s: SocialSettings, page: SocialPage, token: string, n: SocialNews, text: string, deps: SocialDeps) {
  const today = todaySkopje();
  let fbId: string | null = null, ig: { id: string; link: string | null } | null = null;
  const errs: string[] = [];
  try {
    const png = await (deps.png ?? ((h) => htmlToPng(h, { width: CARD_W, height: CARD_H })))(cardHtml(n, { logo: s.logo, today }));
    const f = deps.fetch ?? fetch;
    try { fbId = await fbPhotoPost(f, { pageId: page.id, token, png, caption: text }); } catch (e) { errs.push('Facebook: ' + (e as Error).message); }
    if (page.igId) {
      try {
        const url = await (deps.upload ?? uploadCard)(png);
        ig = await igImagePost(f, { igId: page.igId, token, imageUrl: url, caption: text, wait: deps.wait });
      } catch (e) { errs.push('Instagram: ' + (e as Error).message); }
    }
  } catch (e) { errs.push((e as Error).message); }
  const status: 'posted' | 'partial' | 'failed' = errs.length === 0 ? 'posted' : fbId || ig ? 'partial' : 'failed';
  return { status, fbPostId: fbId, igMediaId: ig?.id ?? null, igLink: ig?.link ?? null, error: errs.join(' · ') || null };
}

async function siteNewsFile(): Promise<unknown> {
  const f = process.env.SITE_NEWS_FILE || '/srv/site-data/news.json';
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; }
}

/**
 * 📣 The public website's news (`news.json`: УЈП, Министерство за финансии, …) → the page, fully automatic when „web“ is
 * on: one item per run (the newest not yet posted), at most `webPerDay` a day. On switching on, everything already on
 * the site is marked seen – only news that appear afterwards go out. Reads only the public news file.
 */
export async function runSocialWeb(db: DB, log: (m: string) => void, deps: SocialDeps = {}): Promise<string> {
  const s = await getSocialSettings(db);
  const page = socialPage(s);
  const token = page ? openSecret(page.token) : null;
  if (!page || !token) return 'not connected';
  if (!s.web) return 'web off';
  const items: WebNews[] = webNewsItems(await (deps.webNews ?? siteNewsFile)());
  if (!items.length) return 'no news file';
  if (!s.webSeeded || s.webSeeded !== s.webSince) {
    await seedWebNews(db, items);
    const at = s.webSince ?? new Date().toISOString();
    await patchSocialSettings(db, { webSince: at, webSeeded: at }, null);
    log(`social.web: ${items.length} existing news marked seen`);
    return 'seeded';
  }
  if ((await socialPostsToday(db, true)) >= s.webPerDay) return 'daily limit';
  const w = await nextWebNews(db, items);
  if (!w) return 'nothing new';
  if (!(await claimWebPost(db, w))) return 'already posted';
  const r = await publishCard(s, page, token, webAsNews(w), webCaption(w), deps);
  await recordWebPost(db, w.url, r);
  log(`social.web: ${r.status} „${w.title.slice(0, 60)}“${r.error ? ' – ' + r.error : ''}`);
  return r.status;
}

export const socialWeb = defineJob({
  name: 'social.web',
  // the site's news file is refreshed at :10 every 2 h (06–20) → one post at :40, 08:40 … 20:40 (Skopje)
  cron: '40 8-20/2 * * *',
  queue: { retryLimit: 0 },
  async run(_data, ctx) { await runSocialWeb(ctx.db, ctx.log); },
});

export const socialPost = defineJob<{ lawId?: string }>({
  name: 'social.post',
  cron: '0 9,15 * * *',
  queue: { retryLimit: 0 },
  async run(data, ctx) { await runSocialPost(ctx.db, data, ctx.log); },
});
