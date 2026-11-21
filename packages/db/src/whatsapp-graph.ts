/**
 * 💬 The few WhatsApp Cloud API (Meta Graph) calls WISE makes, with the HTTP client injected (`fetch` by default, a
 * mock in tests and in local development). The base URL is `WA_GRAPH_BASE` (default Graph v21.0), so a local mock
 * can stand in for Meta. The token is passed per call and never logged.
 */
export const WA_GRAPH_DEFAULT = 'https://graph.facebook.com/v21.0';
export const waGraphBase = () => (process.env.WA_GRAPH_BASE || WA_GRAPH_DEFAULT).replace(/\/+$/, '');

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class WaGraphError extends Error {
  override name = 'WaGraphError';
  constructor(message: string, readonly status: number, readonly code: number | null) { super(message); }
}

async function call<T>(f: Fetch, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const r = await f(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!r.ok || j?.error) throw new WaGraphError(j?.error?.error_user_msg || j?.error?.message || `Meta ${r.status}`, r.status, j?.error?.code ?? null);
  return j;
}

export interface WaGraph {
  /** POST /{phone-number-id}/messages → the message id (`wamid…`). */
  send(payload: object): Promise<string>;
  /** POST /{phone-number-id}/media (multipart) → the media id. */
  upload(bytes: Uint8Array, mime: string, filename: string): Promise<string>;
  /** GET /{media-id} → url, then the bytes with the token. */
  download(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }>;
  /** GET /{phone-number-id} – the connection check (display number, verified name). */
  phoneInfo(): Promise<{ display: string; name: string; quality: string | null }>;
}

export function waGraph(o: { phoneNumberId: string; token: string; fetch?: Fetch; base?: string }): WaGraph {
  const f: Fetch = o.fetch ?? ((u, i) => fetch(u, { ...i, cache: 'no-store' } as RequestInit));
  const base = (o.base ?? waGraphBase()).replace(/\/+$/, '');
  const pn = encodeURIComponent(o.phoneNumberId);
  return {
    async send(payload) {
      const j = await call<{ messages?: { id: string }[] }>(f, `${base}/${pn}/messages`, o.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const id = j.messages?.[0]?.id;
      if (!id) throw new WaGraphError('Meta не врати број на пораката.', 200, null);
      return id;
    },
    async upload(bytes, mime, filename) {
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('type', mime);
      fd.append('file', new Blob([Buffer.from(bytes)], { type: mime }), filename);
      const j = await call<{ id?: string }>(f, `${base}/${pn}/media`, o.token, { method: 'POST', body: fd });
      if (!j.id) throw new WaGraphError('Meta не го прими документот.', 200, null);
      return j.id;
    },
    async download(mediaId) {
      const m = await call<{ url?: string; mime_type?: string; file_size?: number }>(f, `${base}/${encodeURIComponent(mediaId)}`, o.token);
      if (!m.url) throw new WaGraphError('Meta не врати линк до датотеката.', 200, null);
      // only Meta's own https media host (a local mock base may be plain http)
      if (base.startsWith('https://') && !/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//i.test(m.url)) throw new WaGraphError('Неочекуван линк до датотеката.', 200, null);
      if ((m.file_size ?? 0) > 100 * 1024 * 1024) throw new WaGraphError('Датотеката е поголема од 100 MB.', 200, null);
      const r = await f(m.url, { headers: { authorization: `Bearer ${o.token}` } });
      if (!r.ok) throw new WaGraphError(`Преземањето не успеа (${r.status}).`, r.status, null);
      return { bytes: new Uint8Array(await r.arrayBuffer()), mime: m.mime_type || r.headers.get('content-type') || 'application/octet-stream' };
    },
    async phoneInfo() {
      const j = await call<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(f, `${base}/${pn}?fields=display_phone_number,verified_name,quality_rating`, o.token);
      return { display: j.display_phone_number ?? '', name: j.verified_name ?? '', quality: j.quality_rating ?? null };
    },
  };
}
