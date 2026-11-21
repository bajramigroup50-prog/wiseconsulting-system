/**
 * 💬 WhatsApp (official Cloud API) – the office settings (`app_settings` `whatsapp`: Phone Number ID, WABA ID, the
 * app secret and the access token SEALED with `sealSecret` like the bank-feed key, the on switch, the templates, the
 * limits), the conversation log (`wa_messages`), who a phone is (`waKnown` + `waLearned`), the „unassigned“ inbox and
 * incoming files into „📥 Пристигнати документи“ (`incoming_docs`, source `whatsapp`). The callers check permissions.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
import {
  WA_SOURCE, waPhone, waPhones, waSettingsNorm, waStatusNewer, waTemplateNorm,
  type WaInMessage, type WaKnown, type WaMatch, type WaSettings, type WaStatus, type WaTemplate,
} from '@wise/core/whatsapp/wa';
import { waNewVerifyToken } from './whatsapp-sig';
import { audit, type Tx } from './audit';
import { appSettings, crmLeads, files, firmContacts, firms, incomingDocs, partners, waMessages } from './schema/index';
import { openSecret, sealSecret } from './social';
import { waLearn, waLearned } from './whatsapp-learn';
import { assignIncomingFirm } from './incoming';

export { waLearn, waLearned, WA_SENDERS } from './whatsapp-learn';

type Q = Pick<Tx, 'select' | 'insert' | 'update'>;
export const WA_KEY = 'whatsapp';
export class WaError extends Error { override name = 'WaError'; }

/* ------------------------------------------------------------------ settings */

async function stored(tx: Pick<Tx, 'select'>): Promise<WaSettings> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, WA_KEY)).limit(1);
  return waSettingsNorm(r?.v as Partial<WaSettings> | undefined);
}
async function put(tx: Pick<Tx, 'insert'>, v: WaSettings, userId: string | null): Promise<void> {
  const value = { ...v, updatedAt: new Date().toISOString() };
  await tx.insert(appSettings).values({ key: WA_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId } });
}

/** The settings as a screen may see them: the secrets only as „set / not set“. */
export type WaPublic = Omit<WaSettings, 'appSecret' | 'token'> & { hasSecret: boolean; hasToken: boolean };
export async function waSettings(tx: Pick<Tx, 'select'>): Promise<WaPublic> {
  const { appSecret, token, ...s } = await stored(tx);
  return { ...s, hasSecret: !!appSecret, hasToken: !!token };
}

/** With the opened secrets (server / worker only; never sent to a browser). */
export async function waSecrets(tx: Pick<Tx, 'select'>): Promise<WaSettings & { secret: string | null; accessToken: string | null }> {
  const s = await stored(tx);
  return { ...s, secret: openSecret(s.appSecret), accessToken: openSecret(s.token) };
}

export interface WaInput {
  on: boolean; phoneNumberId: string; wabaId: string;
  /** empty = keep the stored one */
  appSecret?: string | null; token?: string | null;
  clearToken?: boolean; perMinute?: number | null; perDay?: number | null;
}

/** Save (owner). Secrets are sealed; an empty field keeps the stored value. Switching on needs everything set. */
export async function saveWaSettings(tx: Tx, a: WaInput, userId: string | null): Promise<WaPublic> {
  const old = await stored(tx);
  const pn = String(a.phoneNumberId ?? '').trim(), wb = String(a.wabaId ?? '').trim();
  if (pn && !/^\d{5,25}$/.test(pn)) throw new WaError('Phone Number ID: само бројки (WhatsApp Manager → API Setup).');
  if (wb && !/^\d{5,25}$/.test(wb)) throw new WaError('WhatsApp Business Account ID: само бројки.');
  const secret = String(a.appSecret ?? '').trim(), token = String(a.token ?? '').trim();
  if (secret && !/^[0-9a-f]{16,64}$/i.test(secret)) throw new WaError('App secret: 32 знаци (0-9, a-f) од App settings → Basic.');
  if (token && (token.length < 20 || /\s/.test(token))) throw new WaError('Токенот не е исправен (копирајте го целиот, без празни места).');
  const v: WaSettings = waSettingsNorm({
    ...old, on: a.on, phoneNumberId: pn, wabaId: wb,
    appSecret: secret ? sealSecret(secret) : old.appSecret,
    token: a.clearToken ? null : token ? sealSecret(token) : old.token,
    verifyToken: old.verifyToken || waNewVerifyToken(),
    perMinute: a.perMinute ?? old.perMinute, perDay: a.perDay ?? old.perDay,
  });
  if (v.on && !(v.phoneNumberId && v.appSecret && v.token)) throw new WaError('За вклучување пополнете Phone Number ID, App secret и токен.');
  await put(tx, v, userId);
  await audit(tx, { userId, firmId: null, action: 'waSettings', entityType: 'app_setting', entityId: WA_KEY, data: {
    on: v.on, phoneNumberId: v.phoneNumberId, wabaId: v.wabaId, secret: secret ? 'new' : v.appSecret ? 'same' : 'none',
    token: a.clearToken ? 'cleared' : token ? 'new' : v.token ? 'same' : 'none', perMinute: v.perMinute, perDay: v.perDay,
  } });
  return waSettings(tx);
}

/** The verify token for Meta's webhook form exists (created once, on the first visit of the settings page). */
export async function waEnsureVerifyToken(tx: Tx, userId: string | null, rotate = false): Promise<string> {
  const s = await stored(tx);
  if (s.verifyToken && !rotate) return s.verifyToken;
  const verifyToken = waNewVerifyToken();
  await put(tx, { ...s, verifyToken }, userId);
  if (rotate) await audit(tx, { userId, firmId: null, action: 'waVerifyRotate', entityType: 'app_setting', entityId: WA_KEY });
  return verifyToken;
}

export async function saveWaTemplates(tx: Tx, T: readonly Partial<WaTemplate>[], userId: string | null): Promise<WaTemplate[]> {
  const s = await stored(tx);
  const seen = new Set<string>();
  const templates = T.map(waTemplateNorm).filter((t): t is WaTemplate => !!t && !seen.has(t.name + '|' + t.lang) && !!seen.add(t.name + '|' + t.lang)).slice(0, 60);
  await put(tx, { ...s, templates }, userId);
  await audit(tx, { userId, firmId: null, action: 'waTemplates', entityType: 'app_setting', entityId: WA_KEY, data: { templates: templates.map((t) => `${t.name}/${t.lang}/${t.purpose}`) } });
  return templates;
}

export async function waTestResult(tx: Tx, ok: boolean, msg: string): Promise<void> {
  const s = await stored(tx);
  await put(tx, { ...s, lastTest: { at: new Date().toISOString(), ok, msg: msg.slice(0, 300) } }, null);
}

/* ------------------------------------------------------------------ who is who */

/** Every phone in WISE with its firm: the firm's phone, its saved contacts, its partners, CRM leads turned clients. */
export async function waKnown(tx: Pick<Tx, 'select'>): Promise<WaKnown[]> {
  const F = (await tx.select({ id: firms.id, name: firms.name, edb: firms.edb, phone: firms.phone, active: firms.active, settings: firms.settings }).from(firms))
    .filter((f) => f.active !== false && !isDemoFirm(f));
  const ids = new Set(F.map((f) => f.id));
  const out: WaKnown[] = [];
  for (const f of F) for (const p of waPhones(f.phone)) out.push({ phone: p, firmId: f.id, how: 'firm', name: f.name });
  for (const c of await tx.select({ firmId: firmContacts.firmId, name: firmContacts.name, phone: firmContacts.phone }).from(firmContacts).where(sql`coalesce(${firmContacts.phone}, '') <> ''`))
    if (ids.has(c.firmId)) for (const p of waPhones(c.phone)) out.push({ phone: p, firmId: c.firmId, how: 'contact', name: c.name });
  for (const c of await tx.select({ firmId: partners.firmId, name: partners.name, phone: partners.phone }).from(partners).where(sql`coalesce(${partners.phone}, '') <> ''`))
    if (ids.has(c.firmId)) for (const p of waPhones(c.phone)) out.push({ phone: p, firmId: c.firmId, how: 'partner', name: c.name });
  for (const c of await tx.select({ firmId: crmLeads.firmId, name: crmLeads.contact, company: crmLeads.company, phone: crmLeads.phone }).from(crmLeads).where(sql`${crmLeads.firmId} is not null and coalesce(${crmLeads.phone}, '') <> ''`))
    if (c.firmId && ids.has(c.firmId)) for (const p of waPhones(c.phone)) out.push({ phone: p, firmId: c.firmId, how: 'crm', name: c.name || c.company });
  return out;
}

/* ------------------------------------------------------------------ incoming */

/**
 * Store one incoming message (once: Meta may deliver the same webhook again). A media message keeps the media id in
 * `data.media` for the worker (`wa.media`). Returns the new row id, or null when it was already stored.
 */
export async function waRecordIn(tx: Q, m: WaInMessage, match: WaMatch): Promise<string | null> {
  const data: Record<string, unknown> = 'how' in match ? { how: match.how } : { candidates: match.candidates };
  if (m.media) data.media = m.media;
  if (m.context) data.replyTo = m.context;
  const [r] = await tx.insert(waMessages).values({
    firmId: match.firmId, phone: m.from, name: m.name ?? match.name, dir: 'in', waId: m.waId, kind: m.type,
    body: m.text, fileName: m.media?.filename ?? null, status: 'received', data, createdAt: m.at,
  }).onConflictDoNothing({ target: waMessages.waId }).returning({ id: waMessages.id });
  return r?.id ?? null;
}

/** A status update of an outgoing message (sent → delivered → read, or failed). */
export async function waApplyStatus(tx: Q, s: WaStatus): Promise<boolean> {
  const [r] = await tx.select({ id: waMessages.id, status: waMessages.status }).from(waMessages).where(and(eq(waMessages.waId, s.waId), eq(waMessages.dir, 'out'))).limit(1);
  if (!r || !waStatusNewer(r.status, s.status)) return false;
  await tx.update(waMessages).set({ status: s.status, statusAt: s.at, ...(s.error ? { error: s.error.slice(0, 500) } : {}) }).where(eq(waMessages.id, r.id));
  return true;
}

/** The incoming file of a message, stored (`files`), into „📥 Пристигнати документи“ of its firm (or of the office). */
export async function waIngestFile(tx: Tx, a: { msgId: string; fileId: string; name: string }): Promise<string> {
  const [m] = await tx.select().from(waMessages).where(eq(waMessages.id, a.msgId)).limit(1);
  if (!m) throw new WaError('Непозната порака.');
  const result = m.firmId ? null : 'WhatsApp: бројот не е препознаен – изберете фирма (бројот ќе се запамети).';
  const [row] = await tx.insert(incomingDocs).values({
    firmId: m.firmId, fileId: a.fileId, source: WA_SOURCE, what: (m.body || a.name).slice(0, 200), status: 'unread', result,
    detect: { wa: { from: m.phone, name: m.name, waId: m.waId, msgId: m.id } },
  }).returning({ id: incomingDocs.id });
  if (m.firmId) await tx.update(files).set({ firmId: m.firmId }).where(and(eq(files.id, a.fileId), isNull(files.firmId)));
  await tx.update(waMessages).set({ fileId: a.fileId, fileName: a.name, incomingDocId: row!.id, data: { ...m.data, media: undefined, stored: true } }).where(eq(waMessages.id, m.id));
  await audit(tx, { userId: null, firmId: m.firmId, action: 'waIncomingDoc', entityType: 'incoming_doc', entityId: row!.id, data: { phone: m.phone, name: a.name } });
  return row!.id;
}

export async function waMediaFailed(tx: Q, msgId: string, error: string): Promise<void> {
  await tx.update(waMessages).set({ error: error.slice(0, 500) }).where(eq(waMessages.id, msgId));
}

/**
 * The office picked the firm for a phone („Неразпоредени“): its unassigned messages and files move to the firm and
 * the phone is remembered. Returns how many messages moved.
 */
export async function waAssign(tx: Tx, a: { phone: string; firmId: string; userId: string }): Promise<number> {
  const p = waPhone(a.phone);
  if (!p) throw new WaError('Неисправен број.');
  const M = await tx.update(waMessages).set({ firmId: a.firmId }).where(and(eq(waMessages.phone, p), isNull(waMessages.firmId)))
    .returning({ id: waMessages.id, doc: waMessages.incomingDocId });
  for (const d of M) if (d.doc) {
    const [r] = await tx.select({ firmId: incomingDocs.firmId, status: incomingDocs.status }).from(incomingDocs).where(eq(incomingDocs.id, d.doc)).limit(1);
    if (r && r.firmId === null && r.status !== 'done') await assignIncomingFirm(tx, { id: d.doc, from: null, to: a.firmId, userId: a.userId }).catch(() => {});
  }
  await waLearn(tx, p, a.firmId, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'waAssign', entityType: 'wa_phone', entityId: p, data: { messages: M.length } });
  return M.length;
}

/* ------------------------------------------------------------------ outgoing */

/** The client's last message from this phone (the start of the 24-hour window). */
export async function waLastIn(tx: Pick<Tx, 'select'>, phone: string): Promise<Date | null> {
  const [r] = await tx.select({ at: sql<Date | null>`max(${waMessages.createdAt})` }).from(waMessages).where(and(eq(waMessages.phone, waPhone(phone)), eq(waMessages.dir, 'in')));
  return r?.at ? new Date(r.at) : null;
}

/** Times of the office's sends in the last 24 hours (the rate limit). */
export async function waRecentOut(tx: Pick<Tx, 'select'>, now = new Date()): Promise<Date[]> {
  const R = await tx.select({ at: waMessages.createdAt }).from(waMessages).where(and(eq(waMessages.dir, 'out'), gte(waMessages.createdAt, new Date(now.getTime() - 864e5))));
  return R.map((r) => r.at);
}

export interface WaOut {
  firmId: string | null; phone: string; kind: string; body?: string | null; waId?: string | null; status: 'sent' | 'failed';
  error?: string | null; template?: string | null; purpose?: string | null; fileId?: string | null; fileName?: string | null; userId: string | null;
}
/** Log one send (or failed try) and audit it. */
export async function waRecordOut(tx: Tx, o: WaOut): Promise<string> {
  const [r] = await tx.insert(waMessages).values({
    firmId: o.firmId, phone: waPhone(o.phone), dir: 'out', waId: o.waId ?? null, kind: o.kind, body: o.body ?? null, status: o.status,
    error: o.error ? o.error.slice(0, 500) : null, template: o.template ?? null, purpose: o.purpose ?? null, fileId: o.fileId ?? null, fileName: o.fileName ?? null,
    userId: o.userId, statusAt: new Date(),
  }).returning({ id: waMessages.id });
  await audit(tx, { userId: o.userId, firmId: o.firmId, action: o.status === 'sent' ? 'waSend' : 'waSendFailed', entityType: 'wa_message', entityId: r!.id, data: {
    phone: waPhone(o.phone), kind: o.kind, template: o.template ?? null, purpose: o.purpose ?? null, file: o.fileName ?? null, error: o.error ?? null,
  } });
  return r!.id;
}

/* ------------------------------------------------------------------ screens */

export async function waThread(tx: Pick<Tx, 'select'>, q: { firmId?: string; phone?: string; limit?: number }) {
  const w = q.phone ? eq(waMessages.phone, waPhone(q.phone)) : q.firmId ? eq(waMessages.firmId, q.firmId) : sql`false`;
  const R = await tx.select().from(waMessages).where(w).orderBy(desc(waMessages.createdAt)).limit(q.limit ?? 200);
  return R.reverse();
}

export interface WaConv { phone: string; firmId: string | null; firm: string | null; name: string | null; last: Date; lastBody: string | null; lastDir: string; unread: number; lastIn: Date | null }

/** One row per phone, the newest first (the office inbox); `unassigned` = only phones without a firm. */
export async function waConversations(tx: Pick<Tx, 'select'>, o: { unassigned?: boolean; firmIds?: readonly string[] | null; limit?: number } = {}): Promise<WaConv[]> {
  const R = await tx.select({
    phone: waMessages.phone,
    firmId: sql<string | null>`(array_agg(${waMessages.firmId} order by ${waMessages.createdAt} desc))[1]`,
    name: sql<string | null>`(array_agg(${waMessages.name} order by ${waMessages.createdAt} desc) filter (where ${waMessages.name} is not null))[1]`,
    last: sql<Date>`max(${waMessages.createdAt})`,
    lastBody: sql<string | null>`(array_agg(coalesce(${waMessages.body}, ${waMessages.fileName}, ${waMessages.template}, ${waMessages.kind}) order by ${waMessages.createdAt} desc))[1]`,
    lastDir: sql<string>`(array_agg(${waMessages.dir} order by ${waMessages.createdAt} desc))[1]`,
    unread: sql<number>`(count(*) filter (where ${waMessages.dir} = 'in' and ${waMessages.readAt} is null))::int`,
    lastIn: sql<Date | null>`max(${waMessages.createdAt}) filter (where ${waMessages.dir} = 'in')`,
  }).from(waMessages)
    .where(o.unassigned ? isNull(waMessages.firmId) : o.firmIds ? (o.firmIds.length ? inArray(waMessages.firmId, [...o.firmIds]) : sql`false`) : undefined)
    .groupBy(waMessages.phone).orderBy(sql`max(${waMessages.createdAt}) desc`).limit(o.limit ?? 200);
  const fid = [...new Set(R.map((r) => r.firmId).filter((x): x is string => !!x))];
  const names = new Map(fid.length ? (await tx.select({ id: firms.id, name: firms.name }).from(firms).where(inArray(firms.id, fid))).map((f) => [f.id, f.name]) : []);
  return R.map((r) => ({ ...r, firm: r.firmId ? names.get(r.firmId) ?? null : null, last: new Date(r.last), lastIn: r.lastIn ? new Date(r.lastIn) : null }));
}

export async function waMarkRead(tx: Pick<Tx, 'update'>, phone: string): Promise<void> {
  await tx.update(waMessages).set({ readAt: new Date() }).where(and(eq(waMessages.phone, waPhone(phone)), eq(waMessages.dir, 'in'), isNull(waMessages.readAt)));
}

export async function waUnreadCount(tx: Pick<Tx, 'select'>): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(waMessages).where(and(eq(waMessages.dir, 'in'), isNull(waMessages.readAt)));
  return r?.n ?? 0;
}

/** Messages whose media is still to be downloaded (a worker run that failed before). */
export async function waPendingMedia(tx: Pick<Tx, 'select'>, limit = 20) {
  return tx.select({ id: waMessages.id }).from(waMessages)
    .where(and(eq(waMessages.dir, 'in'), sql`${waMessages.data} ? 'media'`, isNull(waMessages.fileId), sql`${waMessages.createdAt} > now() - interval '30 days'`))
    .orderBy(asc(waMessages.createdAt)).limit(limit);
}
