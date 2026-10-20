'use server';
/**
 * 📣 Објави на мрежи – owner only, audited. Connect: the owner pastes the Meta app id / secret and a user token from
 * Graph API Explorer; the server turns it into a long-lived token and the page tokens (they do not expire), sealed.
 */
import { revalidatePath } from 'next/cache';
import { GRAPH, type SocialSettings } from '@wise/core/social/post';
import { audit, getSocialSettings, markSocialDeleted, openSecret, patchSocialSettings, sealSecret, socialPosts } from '@wise/db';
import { eq } from 'drizzle-orm';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

const PATH = '/drustveni';

async function owner(): Promise<{ id: string } | RowResult> {
  const u = await requireUser();
  if (isDemoUser(u)) return { error: DEMO_OFF_MSG };
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  return u;
}
const isErr = (x: unknown): x is RowResult => !!x && typeof x === 'object' && 'error' in x;

async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(j.error?.message || `Meta ${r.status}`);
  return j;
}

export async function socialConnect(_p: RowResult, f: FormData): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  const s = await getSocialSettings(db());
  const appId = String(f.get('appId') ?? '').trim();
  const secretIn = String(f.get('appSecret') ?? '').trim();
  const userToken = String(f.get('userToken') ?? '').trim();
  if (!/^\d{5,25}$/.test(appId)) return { error: 'App ID: само бројки (Meta for Developers → WISE Robot → App settings → Basic).' };
  const secret = secretIn || openSecret(s.appSecret);
  if (!secret) return { error: 'Внесете App Secret (App settings → Basic → App secret → Show).' };
  if (!userToken) return { error: 'Внесете го токенот од Graph API Explorer.' };
  try {
    const ll = await graph<{ access_token: string }>(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(userToken)}`);
    const acc = await graph<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(ll.access_token)}`);
    const pages: SocialSettings['pages'] = (acc.data ?? []).map((p) => ({
      id: p.id, name: p.name, igId: p.instagram_business_account?.id ?? null, igName: p.instagram_business_account?.username ?? null, token: sealSecret(p.access_token),
    }));
    if (!pages.length) return { error: 'Токенот не гледа ниту една страница. Во Graph API Explorer одберете ја страницата „Wise Cónsulting“ и дозволите pages_*.' };
    const keep = pages.find((p) => p.id === s.pageId) ?? pages.find((p) => /wise/i.test(p.name) && p.igId) ?? pages.find((p) => p.igId) ?? pages[0]!;
    await db().transaction(async (tx) => {
      await patchSocialSettings(tx, { appId, appSecret: sealSecret(secret), pages, pageId: keep.id, connectedAt: new Date().toISOString() }, u.id);
      await audit(tx, { userId: u.id, action: 'socialConnect', entityType: 'app_settings', entityId: 'social', data: { pages: pages.map((p) => ({ id: p.id, name: p.name, ig: p.igName })) } });
    });
    revalidatePath(PATH);
    return { ok: `Поврзано: ${keep.name}${keep.igName ? ' + Instagram @' + keep.igName : ' (страницата нема поврзан Instagram)'}.` };
  } catch (e) {
    return { error: 'Meta: ' + ((e as Error).message || 'грешка') };
  }
}

export async function socialPrefs(_p: RowResult, f: FormData): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  const s = await getSocialSettings(db());
  const pageId = String(f.get('pageId') ?? '');
  const auto = f.get('auto') === 'on';
  const perDay = f.get('perDay') === '2' ? 2 : 1;
  const p: Partial<SocialSettings> = { auto, perDay, ...(s.pages.some((x) => x.id === pageId) ? { pageId } : {}) };
  // switching on posts only news found from now on – never the old backlog
  if (auto && !s.auto) p.since = new Date().toISOString();
  const logo = f.get('logo');
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 300_000) return { error: 'Логото е преголемо (најмногу 300 KB).' };
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(logo.type)) return { error: 'Логото: PNG, JPG, SVG или WEBP.' };
    p.logo = `data:${logo.type};base64,${Buffer.from(await logo.arrayBuffer()).toString('base64')}`;
  }
  if (f.get('logoReset') === 'on') p.logo = null;
  await db().transaction(async (tx) => {
    await patchSocialSettings(tx, p, u.id);
    await audit(tx, { userId: u.id, action: 'socialPrefs', entityType: 'app_settings', entityId: 'social', data: { auto, perDay, pageId: p.pageId ?? s.pageId, logo: p.logo === undefined ? 'same' : p.logo ? 'new' : 'wise' } });
  });
  revalidatePath(PATH);
  return { ok: auto ? `Автоматско објавување: вклучено (${perDay} дневно, 09:00${perDay === 2 ? ' и 15:00' : ''}).` : 'Автоматско објавување: исклучено.' };
}

export async function socialPostNow(lawId: string): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  if (!isUuid(lawId)) return { error: 'Непозната новост.' };
  await enqueue('social.post', { lawId });
  await audit(db(), { userId: u.id, action: 'socialPostNow', entityType: 'law_changes', entityId: lawId });
  return { ok: 'Се објавува – за минута освежете ја страницата.' };
}

/** Delete the Facebook post (Instagram posts are deleted in the Instagram app – the API cannot). */
export async function socialDelete(id: string): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  if (!isUuid(id)) return { error: 'Непозната објава.' };
  const [r] = await db().select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1);
  if (!r) return { error: 'Непозната објава.' };
  const s = await getSocialSettings(db());
  const page = s.pages.find((p) => p.id === s.pageId);
  const token = page ? openSecret(page.token) : null;
  if (r.fbPostId && token) {
    try { await graph(`${GRAPH}/${r.fbPostId}?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' }); } catch (e) { return { error: 'Facebook: ' + (e as Error).message }; }
  }
  await db().transaction(async (tx) => {
    await markSocialDeleted(tx, id);
    await audit(tx, { userId: u.id, action: 'socialDelete', entityType: 'social_posts', entityId: id });
  });
  revalidatePath(PATH);
  return { ok: r.igLink ? 'Избришано од Facebook. Instagram: избришете ја рачно во апликацијата (Meta не дозволува бришење преку програм).' : 'Избришано од Facebook.' };
}

export async function socialDisconnect(): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  await db().transaction(async (tx) => {
    await patchSocialSettings(tx, { pages: [], pageId: null, auto: false, connectedAt: null }, u.id);
    await audit(tx, { userId: u.id, action: 'socialDisconnect', entityType: 'app_settings', entityId: 'social' });
  });
  revalidatePath(PATH);
  return { ok: 'Исклучено – WISE повеќе не може да објавува.' };
}
