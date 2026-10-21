/**
 * 📣 Објави на мрежи (`social.post`): the robot's next PUBLIC law news item → a WISE card (PNG) + caption → the office's
 * Facebook page and Instagram. Cron 09:00 and 15:00 (Skopje): with „1 дневно“ only one post a day. `{ lawId }` posts
 * that item now (📣 Објави сега on the screen). Reads only `law_changes` – never anything of the firms.
 */
import { todaySkopje } from '@wise/core/office';
import { CARD_H, CARD_W, caption, cardHtml, socialPage } from '@wise/core/social/post';
import { claimSocialPost, getSocialSettings, nextSocialNews, openSecret, recordSocialPost, socialNewsById, socialPostsToday, type DB } from '@wise/db';
import { defineJob } from '../job';
import { htmlToPng } from '../pdf/render';
import { objectKey, publicGetUrl, s3Store } from '../storage';
import { fbPhotoPost, igImagePost } from '../social/graph';

export interface SocialDeps {
  fetch?: typeof fetch;
  png?: (html: string) => Promise<Uint8Array>;
  upload?: (png: Uint8Array) => Promise<string>;
  wait?: (ms: number) => Promise<void>;
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
  const today = todaySkopje();
  const text = caption(n);
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
  const status = errs.length === 0 ? 'posted' : fbId || ig ? 'partial' : 'failed';
  await recordSocialPost(db, { lawId: n.id, status, fbPostId: fbId, igMediaId: ig?.id ?? null, igLink: ig?.link ?? null, error: errs.join(' · ') || null });
  log(`social: ${status} „${n.title.slice(0, 60)}“${errs.length ? ' – ' + errs.join(' · ') : ''}`);
  return status;
}

export const socialPost = defineJob<{ lawId?: string }>({
  name: 'social.post',
  cron: '0 9,15 * * *',
  queue: { retryLimit: 0 },
  async run(data, ctx) { await runSocialPost(ctx.db, data, ctx.log); },
});
