/**
 * 💬 WhatsApp (official WhatsApp Business Cloud API, Meta Graph) – the pure rules shared by the web, the worker and
 * the tests: phone numbers (E.164 without „+“, Macedonian numbers by default), who a sender is (firm / contact /
 * client user / partner / CRM), the 24-hour customer-service window and the approved templates, the rate limit, and
 * the parsing of Meta's webhook body. No network and no secrets here (Graph calls: `./graph`, signature: `./sig`).
 */

export const WA_JOB_MEDIA = 'wa.media';
export const WA_SOURCE = 'whatsapp';
/** The 24-hour customer-service window after the client's last message: free text / documents only inside it. */
export const WA_WINDOW_MS = 24 * 3600_000;

/* ------------------------------------------------------------------ phone numbers */

/**
 * A phone as WhatsApp's `wa_id`: digits only, with the country code. „070 123 456“ / „+389 70 123 456“ /
 * „00389 70…“ → „38970123456“. A number without a country code gets `cc` (389). '' when it cannot be a phone.
 */
export function waPhone(raw: string | null | undefined, cc = '389'): string {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (d.length <= 8) d = cc + d;
  d = d.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? d : '';
}

/** Every phone written in one field („070 111 222 / 02 3 111 222; 071…“). */
export function waPhones(raw: string | null | undefined, cc = '389'): string[] {
  return [...new Set(String(raw ?? '').split(/[,;/|\n]+|\s{2,}/).map((x) => waPhone(x, cc)).filter(Boolean))];
}

/** „+389 70 123 456“ for the screen. */
export function waShow(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.startsWith('389') && d.length === 11) return `+389 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d ? '+' + d : '';
}

/* ------------------------------------------------------------------ who is the sender */

export type WaMatchHow = 'learned' | 'contact' | 'firm' | 'user' | 'partner' | 'crm';
/** One phone known in WISE and the firm it belongs to. */
export interface WaKnown { phone: string; firmId: string; how: Exclude<WaMatchHow, 'learned'>; name?: string | null }
export type WaMatch =
  | { firmId: string; how: WaMatchHow; name: string | null }
  | { firmId: null; candidates: string[]; name: string | null };

/** The strength of each source: a learned sender, then the firm's own contacts / phone, then the rest. */
const RANK: Record<Exclude<WaMatchHow, 'learned'>, number> = { contact: 1, firm: 1, user: 1, partner: 2, crm: 3 };

/**
 * The firm of a sender. A phone the office already assigned (`learned`) wins. Otherwise the best-ranked source; when
 * the best rank points to more than one firm, nothing is certain → the „unassigned“ inbox with the candidates.
 */
export function waMatch(phone: string, known: readonly WaKnown[], learned: Readonly<Record<string, string>> = {}): WaMatch {
  const p = waPhone(phone);
  if (!p) return { firmId: null, candidates: [], name: null };
  if (learned[p]) return { firmId: learned[p]!, how: 'learned', name: known.find((k) => k.phone === p && k.firmId === learned[p])?.name ?? null };
  const K = known.filter((k) => k.phone === p);
  if (!K.length) return { firmId: null, candidates: [], name: null };
  const best = Math.min(...K.map((k) => RANK[k.how]));
  const top = K.filter((k) => RANK[k.how] === best);
  const F = [...new Set(top.map((k) => k.firmId))];
  const name = top.find((k) => k.name)?.name ?? null;
  if (F.length === 1) return { firmId: F[0]!, how: top[0]!.how, name };
  return { firmId: null, candidates: [...new Set(K.map((k) => k.firmId))], name };
}

/* ------------------------------------------------------------------ settings and templates */

/** What a template is used for: the sending screens pick a template by this. */
export const WA_PURPOSES = {
  rok: '📅 Потсетник за рок',
  inst: '🏛 Институции (рок / решение)',
  opomena: '⏰ Опомена за неплатен долг',
  faktura: '🧾 Фактура (PDF)',
  plata: '💶 Платен лист (PDF)',
  dokument: '📎 Документ (PDF)',
  opsto: '💬 Општа порака',
} as const;
export type WaPurpose = keyof typeof WA_PURPOSES;
export const isWaPurpose = (x: unknown): x is WaPurpose => typeof x === 'string' && x in WA_PURPOSES;

/**
 * The variables a sending screen can fill (`{{1}}`, `{{2}}`… of the template are these, in the template's order).
 * The template text itself is approved in WhatsApp Manager; WISE only needs the name, the language and the order.
 */
export const WA_VARS = {
  firma: 'Фирма', ime: 'Име на примачот', rok: 'Рок / датум', opis: 'Опис (обврска, документ)', iznos: 'Износ',
  broj: 'Број на документ', period: 'Период', kancelarija: 'Канцеларија', tekst: 'Слободен текст',
} as const;
export type WaVar = keyof typeof WA_VARS;

export type WaLang = 'mk' | 'sq';
export interface WaTemplate {
  /** the template name in WhatsApp Manager (lower case, digits, „_“) */
  name: string;
  lang: WaLang;
  purpose: WaPurpose;
  /** body variables in order ({{1}}, {{2}}…) */
  vars: WaVar[];
  /** the template has a DOCUMENT header: the PDF goes with the template itself */
  doc: boolean;
}

/** Meta's language codes for the template languages. */
export const WA_LANG_CODE: Record<WaLang, string> = { mk: 'mk', sq: 'sq' };

export interface WaSettings {
  on: boolean;
  phoneNumberId: string;
  wabaId: string;
  /** sealed (`sealSecret`), never shown */
  appSecret: string | null;
  token: string | null;
  /** our own random string for Meta's webhook handshake (shown: it is pasted into Meta, not a Meta secret) */
  verifyToken: string;
  templates: WaTemplate[];
  perMinute: number;
  perDay: number;
  /** last „test message“ / connection check */
  lastTest?: { at: string; ok: boolean; msg: string } | null;
  updatedAt?: string | null;
}

export const WA_DEFAULTS: WaSettings = { on: false, phoneNumberId: '', wabaId: '', appSecret: null, token: null, verifyToken: '', templates: [], perMinute: 20, perDay: 300 };

const TPL_NAME = /^[a-z0-9_]{1,512}$/;

export function waTemplateNorm(t: Partial<WaTemplate> | null | undefined): WaTemplate | null {
  const name = String(t?.name ?? '').trim().toLowerCase();
  if (!TPL_NAME.test(name)) return null;
  const lang: WaLang = t?.lang === 'sq' ? 'sq' : 'mk';
  const purpose = isWaPurpose(t?.purpose) ? t!.purpose : 'opsto';
  const vars = (Array.isArray(t?.vars) ? t!.vars : []).filter((v): v is WaVar => typeof v === 'string' && v in WA_VARS).slice(0, 10);
  return { name, lang, purpose, vars, doc: !!t?.doc };
}

export function waSettingsNorm(v: Partial<WaSettings> | null | undefined): WaSettings {
  const s = { ...WA_DEFAULTS, ...(v ?? {}) };
  const num = (x: unknown, d: number, max: number) => { const n = Number(x); return Number.isInteger(n) && n >= 1 && n <= max ? n : d; };
  return {
    ...s,
    on: !!s.on,
    phoneNumberId: String(s.phoneNumberId ?? '').replace(/\D/g, ''),
    wabaId: String(s.wabaId ?? '').replace(/\D/g, ''),
    templates: (Array.isArray(s.templates) ? s.templates : []).map(waTemplateNorm).filter((t): t is WaTemplate => !!t),
    perMinute: num(s.perMinute, WA_DEFAULTS.perMinute, 80),
    perDay: num(s.perDay, WA_DEFAULTS.perDay, 5000),
  };
}

/** Everything needed to send is there (the on switch is separate). */
export const waConfigured = (s: Pick<WaSettings, 'phoneNumberId' | 'token' | 'appSecret'>) => !!(s.phoneNumberId && s.token && s.appSecret);
export const waActive = (s: WaSettings) => s.on && waConfigured(s);

/* ------------------------------------------------------------------ the 24-hour rule */

export const waWindowOpen = (lastIn: Date | string | null | undefined, now = new Date()): boolean => {
  if (!lastIn) return false;
  const t = new Date(lastIn).getTime();
  return Number.isFinite(t) && now.getTime() - t < WA_WINDOW_MS && t <= now.getTime() + 60_000;
};

export type WaPlan =
  | { kind: 'free' }
  | { kind: 'template'; tpl: WaTemplate; params: string[] }
  | { error: string };

/**
 * How a message may go out. Inside the 24-hour window: free text (and documents). Outside it: only an approved
 * template of this purpose — in the wanted language, else in the other one — with every variable filled; a PDF goes
 * outside the window only with a template that has a document header.
 */
export function waPlan(a: {
  lastIn: Date | string | null | undefined; now?: Date; purpose: WaPurpose; lang?: WaLang;
  templates: readonly WaTemplate[]; vars?: Partial<Record<WaVar, string | number | null | undefined>>; hasDoc?: boolean; freeOnly?: boolean;
}): WaPlan {
  if (waWindowOpen(a.lastIn, a.now)) return { kind: 'free' };
  if (a.freeOnly) return { error: 'Клиентот не пишал во последните 24 часа – слободна порака не е дозволена. Испратете одобрен шаблон.' };
  const lang = a.lang ?? 'mk';
  const T = a.templates.filter((t) => t.purpose === a.purpose && (!a.hasDoc || t.doc));
  const tpl = T.find((t) => t.lang === lang) ?? T[0];
  if (!tpl) {
    return { error: `Надвор од 24-часовниот прозорец може само одобрен шаблон, а нема шаблон за „${WA_PURPOSES[a.purpose]}“${a.hasDoc ? ' со документ (PDF)' : ''}. Додајте го во 💬 WhatsApp → Шаблони.` };
  }
  const params: string[] = [];
  for (const v of tpl.vars) {
    const x = a.vars?.[v];
    const s = x == null ? '' : String(x).replace(/\s*\n\s*/g, ' ').replace(/\s{4,}/g, '   ').trim();
    if (!s) return { error: `Шаблонот „${tpl.name}“ бара „${WA_VARS[v]}“ – не е пополнето.` };
    params.push(s.slice(0, 1024));
  }
  return { kind: 'template', tpl, params };
}

/* ------------------------------------------------------------------ rate limit */

/**
 * Sends allowed now, given the times of the office's recent sends (any order): at most `perMinute` in the last
 * minute and `perDay` in the last 24 h. Returns the refusal text, or null when it may go.
 */
export function waRateRefusal(recent: readonly (Date | string)[], s: Pick<WaSettings, 'perMinute' | 'perDay'>, now = new Date(), adding = 1): string | null {
  const t = now.getTime();
  const T = recent.map((d) => new Date(d).getTime());
  const m = T.filter((x) => t - x < 60_000).length;
  const d = T.filter((x) => t - x < 864e5).length;
  if (m + adding > s.perMinute) return `Премногу пораки во минута (најмногу ${s.perMinute}). Почекајте малку.`;
  if (d + adding > s.perDay) return `Дневната граница е достигната (${s.perDay} пораки за 24 часа).`;
  return null;
}

/* ------------------------------------------------------------------ Graph payloads */

export function waTextPayload(to: string, body: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } };
}
export function waDocPayload(to: string, mediaId: string, filename: string, caption?: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document', document: { id: mediaId, filename: filename.slice(0, 240), ...(caption ? { caption: caption.slice(0, 1024) } : {}) } };
}
export function waTemplatePayload(to: string, tpl: WaTemplate, params: readonly string[], doc?: { mediaId: string; filename: string }) {
  const components: unknown[] = [];
  if (tpl.doc && doc) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: doc.mediaId, filename: doc.filename.slice(0, 240) } }] });
  if (params.length) components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) });
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: tpl.name, language: { code: WA_LANG_CODE[tpl.lang] }, ...(components.length ? { components } : {}) } };
}

/* ------------------------------------------------------------------ webhook */

export interface WaInMedia { id: string; mime: string; filename: string | null; caption: string | null; sha256: string | null }
export interface WaInMessage {
  waId: string; from: string; name: string | null; at: Date; type: string;
  text: string | null; media: WaInMedia | null; context: string | null;
}
export interface WaStatus { waId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: Date; to: string; error: string | null }
export interface WaWebhook { phoneNumberId: string | null; messages: WaInMessage[]; statuses: WaStatus[] }

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const at = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date(); };
const MEDIA = ['image', 'document', 'audio', 'video', 'sticker'] as const;

/** Meta's `whatsapp_business_account` webhook body → the messages and status changes (anything else is ignored). */
export function waParseWebhook(body: unknown): WaWebhook {
  const out: WaWebhook = { phoneNumberId: null, messages: [], statuses: [] };
  const b = body as J;
  if (!b || b.object !== 'whatsapp_business_account' || !Array.isArray(b.entry)) return out;
  for (const e of b.entry as J[]) {
    for (const c of (Array.isArray(e?.changes) ? e.changes : []) as J[]) {
      if (c?.field !== 'messages') continue;
      const v = (c.value ?? {}) as J;
      out.phoneNumberId ??= v.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      const names = new Map<string, string>(((v.contacts ?? []) as J[]).map((k) => [String(k?.wa_id ?? ''), String(k?.profile?.name ?? '')]));
      for (const m of (Array.isArray(v.messages) ? v.messages : []) as J[]) {
        const from = waPhone('+' + String(m?.from ?? ''));
        if (!m?.id || !from) continue;
        const type = String(m.type ?? 'unknown');
        const mt = MEDIA.find((k) => k === type);
        const md = mt ? (m[mt] as J | undefined) : undefined;
        const text = type === 'text' ? String(m.text?.body ?? '')
          : type === 'button' ? String(m.button?.text ?? '')
          : type === 'interactive' ? String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '')
          : type === 'location' ? `📍 ${m.location?.latitude},${m.location?.longitude}${m.location?.name ? ' ' + m.location.name : ''}`
          : md?.caption ? String(md.caption) : null;
        out.messages.push({
          waId: String(m.id), from, name: names.get(String(m.from)) || null, at: at(m.timestamp), type,
          text: text || null, context: m.context?.id ? String(m.context.id) : null,
          media: md?.id ? { id: String(md.id), mime: String(md.mime_type ?? 'application/octet-stream'), filename: md.filename ? String(md.filename) : null, caption: md.caption ? String(md.caption) : null, sha256: md.sha256 ? String(md.sha256) : null } : null,
        });
      }
      for (const s of (Array.isArray(v.statuses) ? v.statuses : []) as J[]) {
        const st = String(s?.status ?? '');
        if (!s?.id || !['sent', 'delivered', 'read', 'failed'].includes(st)) continue;
        const err = Array.isArray(s.errors) && s.errors[0] ? `${s.errors[0].code ?? ''} ${s.errors[0].title ?? s.errors[0].message ?? ''}`.trim() : null;
        out.statuses.push({ waId: String(s.id), status: st as WaStatus['status'], at: at(s.timestamp), to: waPhone('+' + String(s.recipient_id ?? '')), error: err });
      }
    }
  }
  return out;
}

/** A status never goes back (a late „sent“ after „read“ is ignored); „failed“ always wins. */
const ORDER: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 9 };
export const waStatusNewer = (old: string | null | undefined, nu: string) => (ORDER[nu] ?? 0) > (ORDER[old ?? ''] ?? -1);

/** The kinds of incoming files that go to „📥 Пристигнати документи“ (and the AI reading). */
export const waDocWanted = (m: WaInMedia, type: string) =>
  type === 'document' ? /pdf|image\/|msword|officedocument|spreadsheet|excel|text\/|xml|zip/i.test(m.mime) : type === 'image';

export const waExt = (mime: string, filename: string | null): string => {
  const f = /\.([a-z0-9]{1,8})$/i.exec(filename ?? '')?.[1];
  if (f) return f.toLowerCase();
  const M: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/plain': 'txt', 'text/xml': 'xml', 'application/xml': 'xml', 'application/zip': 'zip' };
  return M[mime.split(';')[0]!.trim().toLowerCase()] ?? 'bin';
};
