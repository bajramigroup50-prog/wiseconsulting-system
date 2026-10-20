/**
 * Minimal Meta Graph API client for 📣 Објави на мрежи: a photo post on the Facebook page and an Instagram image post
 * (container → wait until FINISHED → publish). `fetch` is injectable for tests.
 */
import { GRAPH } from '@wise/core/social/post';

type F = typeof fetch;

export class GraphError extends Error {}

async function call<T>(f: F, url: string, init?: RequestInit): Promise<T> {
  const r = await f(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!r.ok || j.error) throw new GraphError(j.error?.message || `Graph ${r.status}`);
  return j;
}

const form = (o: Record<string, string>) => new URLSearchParams(o);

/** Photo + text on the page (the PNG is uploaded, no public URL needed). Returns the post id. */
export async function fbPhotoPost(f: F, p: { pageId: string; token: string; png: Uint8Array; caption: string }): Promise<string> {
  const fd = new FormData();
  fd.set('source', new Blob([p.png], { type: 'image/png' }), 'wise.png');
  fd.set('message', p.caption);
  fd.set('published', 'true');
  fd.set('access_token', p.token);
  const j = await call<{ id: string; post_id?: string }>(f, `${GRAPH}/${p.pageId}/photos`, { method: 'POST', body: fd });
  return j.post_id || j.id;
}

/** Instagram post from a public image URL. Returns the media id and its permalink. */
export async function igImagePost(f: F, p: { igId: string; token: string; imageUrl: string; caption: string; wait?: (ms: number) => Promise<void> }): Promise<{ id: string; link: string | null }> {
  const wait = p.wait ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const c = await call<{ id: string }>(f, `${GRAPH}/${p.igId}/media`, { method: 'POST', body: form({ image_url: p.imageUrl, caption: p.caption, access_token: p.token }) });
  for (let i = 0; i < 20; i++) {
    const s = await call<{ status_code?: string }>(f, `${GRAPH}/${c.id}?fields=status_code&access_token=${encodeURIComponent(p.token)}`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new GraphError('Instagram не ја прифати сликата (' + s.status_code + ').');
    await wait(3000);
  }
  const m = await call<{ id: string }>(f, `${GRAPH}/${p.igId}/media_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: p.token }) });
  const l = await call<{ permalink?: string }>(f, `${GRAPH}/${m.id}?fields=permalink&access_token=${encodeURIComponent(p.token)}`).catch(() => ({ permalink: undefined }));
  return { id: m.id, link: l.permalink ?? null };
}
