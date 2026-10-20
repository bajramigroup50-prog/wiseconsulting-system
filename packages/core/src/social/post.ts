/**
 * 📣 Објави на мрежи: the robot's PUBLIC law news (`law_changes`, found on УЈП / Службен весник / … pages) posted to the
 * office's Facebook page and Instagram — a 1080×1350 card with the WISE logo + a caption with the official source.
 * Only those public items ever go out: nothing of the firms, the books or people (the job reads `law_changes` only).
 */
import { LAW_IMP, LAW_INST } from '../law/robot';

/** Graph API version used by the worker and the connect screen. */
export const GRAPH = 'https://graph.facebook.com/v23.0';

/** Permissions the page token needs (Graph API Explorer → „Generate Access Token“). */
export const SOCIAL_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management', 'instagram_basic', 'instagram_content_publish'] as const;

/** The public fields of one law item that a post may use — and nothing else. */
export interface SocialNews {
  inst: string;
  title: string;
  what?: string | null;
  who?: string | null;
  impact?: readonly string[] | null;
  date?: string | null;
  from?: string | null;
  urls?: readonly string[] | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

/** The WISE mark when no logo was uploaded (gold „wise“ in a frame, „consulting“ under it, on black). */
export const WISE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="28" fill="#111"/><rect x="34" y="62" width="132" height="52" rx="4" fill="none" stroke="#C9A24A" stroke-width="4"/><text x="100" y="101" text-anchor="middle" font-family="Georgia,serif" font-size="38" letter-spacing="6" fill="#C9A24A">wise</text><text x="100" y="140" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" letter-spacing="5" fill="#C9A24A">consulting</text></svg>`;
export const WISE_LOGO_DATA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(WISE_LOGO_SVG);

export const CARD_W = 1080;
export const CARD_H = 1350;

/** The card (self-contained HTML: no network — the logo is a data: URL). */
export function cardHtml(n: SocialNews, o: { logo?: string | null; today: string }): string {
  const inst = LAW_INST[n.inst] ?? n.inst;
  const title = cut(n.title.trim(), 150);
  const what = cut(String(n.what ?? '').trim(), 260);
  const from = dmy(n.from);
  const t = title.length > 90 ? 52 : title.length > 55 ? 62 : 72;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0}
body{width:${CARD_W}px;height:${CARD_H}px;background:#0C3F34;color:#EEF5F1;font-family:'DejaVu Sans','Liberation Sans',Arial,sans-serif;position:relative;overflow:hidden}
.ring{position:absolute;border-radius:50%;border:2px solid rgba(143,211,185,.18)}
.wrap{position:absolute;inset:0;padding:84px 84px 72px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.logo{width:132px;height:132px;border-radius:24px;overflow:hidden;background:#111;display:flex;align-items:center;justify-content:center}
.logo img{width:100%;height:100%;object-fit:contain}
.tag{font-size:30px;font-weight:700;letter-spacing:4px;color:#0C3F34;background:#8FD3B9;padding:14px 26px;border-radius:999px}
.inst{margin-top:84px;font-size:40px;font-weight:700;letter-spacing:3px;color:#8FD3B9;text-transform:uppercase}
h1{margin:22px 0 0;font-size:${t}px;line-height:1.12;color:#fff;font-weight:700}
.what{margin-top:40px;font-size:36px;line-height:1.4;color:#CFE4DA}
.from{margin-top:36px;display:inline-block;font-size:32px;font-weight:700;color:#0C3F34;background:#F3D98B;padding:12px 24px;border-radius:12px}
.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;font-size:28px;color:#A9C9BC;border-top:2px solid rgba(143,211,185,.25);padding-top:28px}
.foot b{color:#fff;font-size:32px;letter-spacing:2px}
</style></head><body>
<div class="ring" style="right:-200px;top:-200px;width:640px;height:640px"></div>
<div class="ring" style="left:-260px;bottom:-300px;width:760px;height:760px"></div>
<div class="wrap">
<div class="top"><div class="logo"><img src="${esc(o.logo || WISE_LOGO_DATA)}" alt=""></div><div class="tag">🔔 НОВОСТ</div></div>
<div class="inst">${esc(inst)}</div>
<h1>${esc(title)}</h1>
${what ? `<div class="what">${esc(what)}</div>` : ''}
${from ? `<div><span class="from">Важи од ${esc(from)}</span></div>` : ''}
<div class="foot"><div><b>WISE CONSULTING</b><br>wiseconsulting.com.mk</div><div>${esc(dmy(n.date) || dmy(o.today))}</div></div>
</div></body></html>`;
}

/** Instagram / Facebook caption (≤ 2 200 characters, Instagram's limit). */
export function caption(n: SocialNews): string {
  const inst = LAW_INST[n.inst] ?? n.inst;
  const imp = (n.impact ?? []).map((k) => LAW_IMP[k]).filter(Boolean);
  const L = [
    `🔔 ${inst}: ${n.title.trim()}`,
    n.what ? '\n' + String(n.what).trim() : '',
    n.who ? `\n👥 Се однесува на: ${String(n.who).trim()}` : imp.length ? `\n👥 Се однесува на: ${imp.join(', ')}` : '',
    n.from ? `📅 Важи од: ${dmy(n.from)}` : '',
    n.urls?.[0] ? `🔗 Извор: ${n.urls[0]}` : '',
    '\nЗа прашања – WISE CONSULTING, вашата сметководствена канцеларија.',
    '#WISEconsulting #сметководство #УЈП #даноци #Македонија',
  ].filter(Boolean);
  return cut(L.join('\n'), 2200);
}

export interface SocialPage { id: string; name: string; igId: string | null; igName: string | null }

/** Office settings (`app_settings` key `social`); tokens / secret are sealed (`@wise/db` social). */
export interface SocialSettings {
  appId: string;
  /** Sealed app secret. */
  appSecret: string | null;
  /** Pages the last connect found (with sealed page tokens). */
  pages: (SocialPage & { token: string })[];
  pageId: string | null;
  /** Post automatically (the worker, 09:00 and with 2 per day also 15:00). */
  auto: boolean;
  perDay: 1 | 2;
  /** Only news found after this moment (switching on never posts the old backlog). */
  since: string | null;
  /** Uploaded logo (data: URL, ≤ 300 KB); null = the WISE mark. */
  logo: string | null;
  connectedAt: string | null;
}

export const SOCIAL_DEFAULTS: SocialSettings = { appId: '', appSecret: null, pages: [], pageId: null, auto: false, perDay: 1, since: null, logo: null, connectedAt: null };

export function socialNormalize(v: Partial<SocialSettings> | null | undefined): SocialSettings {
  const x = { ...SOCIAL_DEFAULTS, ...(v ?? {}) };
  return { ...x, pages: Array.isArray(x.pages) ? x.pages : [], perDay: x.perDay === 2 ? 2 : 1, auto: !!x.auto };
}

/** The page posts go to (the chosen one, else the only one with Instagram). */
export const socialPage = (s: SocialSettings) => s.pages.find((p) => p.id === s.pageId) ?? (s.pages.length === 1 ? s.pages[0] : undefined);
