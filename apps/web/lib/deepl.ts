import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { appSettings } from '@wise/db';
import { todaySkopje } from '@wise/core/office/dates';
import { db } from './db';

/**
 * 🌐 DeepL translation (text + documents). The key comes from the server env `DEEPL_API_KEY` (docker/compose.yml →
 * web); a free key ends with `:fx` and talks to api-free.deepl.com. The key is never logged or sent to the browser.
 * Characters used are counted per month in `app_settings` key `deeplUsage` ({ 'YYYY-MM': chars }).
 */
export const DEEPL_NO_KEY = 'Внесете DeepL клуч во поставките на серверот (DEEPL_API_KEY).';
export const DEEPL_FREE_LIMIT = 500_000;

/** Target languages offered in WISE (DeepL codes). */
export const DEEPL_LANGS = { MK: 'македонски', SQ: 'албански', EN: 'англиски', DE: 'германски' } as const;
export type DeeplLang = keyof typeof DEEPL_LANGS;
export const isDeeplLang = (v: unknown): v is DeeplLang => typeof v === 'string' && v in DEEPL_LANGS;
/** DeepL wants a regional English as the target. */
const target = (l: DeeplLang) => (l === 'EN' ? 'EN-GB' : l);

/** Document types DeepL translates. */
export const DEEPL_DOC_EXT = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'htm', 'html'];
export const deeplDocOk = (name: string) => DEEPL_DOC_EXT.includes((/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase());

const key = () => (process.env.DEEPL_API_KEY ?? '').trim();
export const deeplConfigured = () => !!key();
const base = () => (key().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
const auth = () => ({ Authorization: `DeepL-Auth-Key ${key()}` });

export class DeeplError extends Error {}

/** A readable Macedonian message for a DeepL HTTP error (never echoes the key). */
async function fail(r: Response): Promise<never> {
  let msg = '';
  try { msg = String(((await r.json()) as { message?: string }).message ?? ''); } catch { /* not JSON */ }
  const t = r.status === 403 ? 'DeepL го одби клучот (403) – проверете го DEEPL_API_KEY.'
    : r.status === 456 ? 'Месечниот лимит на знаци во DeepL е потрошен (456).'
      : r.status === 429 ? 'DeepL: премногу барања – обидете се пак за минута.'
        : `DeepL грешка ${r.status}${msg ? ': ' + msg : ''}`;
  throw new DeeplError(t);
}

async function call(path: string, init: RequestInit): Promise<Response> {
  if (!deeplConfigured()) throw new DeeplError(DEEPL_NO_KEY);
  const r = await fetch(base() + path, { ...init, headers: { ...auth(), ...(init.headers ?? {}) }, cache: 'no-store' });
  if (!r.ok) await fail(r);
  return r;
}

const USAGE_KEY = 'deeplUsage';
const month = () => todaySkopje().slice(0, 7);

/** Add characters to this month's counter. */
export async function noteDeeplChars(n: number): Promise<void> {
  if (!(n > 0)) return;
  const m = month();
  await db().insert(appSettings).values({ key: USAGE_KEY, value: { [m]: n } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`${appSettings.value} || jsonb_build_object(${m}::text, coalesce((${appSettings.value} ->> ${m}::text)::bigint, 0) + ${n}::bigint)` },
    });
}

/** Characters counted by WISE per month (newest first). */
export async function deeplMonths(): Promise<{ month: string; chars: number }[]> {
  const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, USAGE_KEY)).limit(1);
  const v = (r?.v ?? {}) as Record<string, number>;
  return Object.entries(v).map(([month, chars]) => ({ month, chars: Number(chars) || 0 })).sort((a, b) => b.month.localeCompare(a.month));
}

/** DeepL's own counter for the billing period (null when no key / unreachable). */
export async function deeplUsage(): Promise<{ count: number; limit: number } | null> {
  if (!deeplConfigured()) return null;
  try {
    const j = (await (await call('/v2/usage', { method: 'GET' })).json()) as { character_count?: number; character_limit?: number };
    return { count: Number(j.character_count) || 0, limit: Number(j.character_limit) || DEEPL_FREE_LIMIT };
  } catch { return null; }
}

/** Translate texts (keeps order; empty strings stay empty). `source` omitted = auto-detect. */
export async function deeplText(texts: readonly string[], to: DeeplLang, source?: DeeplLang): Promise<{ texts: string[]; detected: string | null }> {
  const idx = texts.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  const out = texts.map(() => '');
  let detected: string | null = null;
  // DeepL takes up to 50 texts per request
  for (let s = 0; s < idx.length; s += 50) {
    const part = idx.slice(s, s + 50);
    const body = { text: part.map((i) => texts[i]!), target_lang: target(to), ...(source ? { source_lang: source } : {}), show_billed_characters: true };
    const j = (await (await call('/v2/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()) as
      { translations: { text: string; detected_source_language?: string; billed_characters?: number }[] };
    let billed = 0;
    j.translations.forEach((t, k) => {
      out[part[k]!] = t.text;
      billed += t.billed_characters ?? texts[part[k]!]!.length;
      detected ??= t.detected_source_language ?? null;
    });
    await noteDeeplChars(billed);
  }
  return { texts: out, detected };
}

/**
 * Translate a document: upload, poll the status (≤ `maxMs`), download. Returns the translated bytes and the characters
 * DeepL billed (a document is billed at least 50.000 characters on the DeepL plans).
 */
export async function deeplDocument(bytes: Uint8Array, name: string, to: DeeplLang, maxMs = 240_000): Promise<{ bytes: Uint8Array; billed: number }> {
  const fd = new FormData();
  fd.append('target_lang', target(to));
  fd.append('file', new Blob([bytes as BlobPart]), name);
  const up = (await (await call('/v2/document', { method: 'POST', body: fd })).json()) as { document_id: string; document_key: string };
  const ref = JSON.stringify({ document_key: up.document_key });
  const json = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ref };
  const t0 = Date.now();
  for (;;) {
    const s = (await (await call(`/v2/document/${up.document_id}`, json)).json()) as { status: string; seconds_remaining?: number; billed_characters?: number; error_message?: string };
    if (s.status === 'done') {
      const res = await call(`/v2/document/${up.document_id}/result`, json);
      const billed = Number(s.billed_characters) || 0;
      await noteDeeplChars(billed);
      return { bytes: new Uint8Array(await res.arrayBuffer()), billed };
    }
    if (s.status === 'error') throw new DeeplError('DeepL не го преведе документот' + (s.error_message ? ': ' + s.error_message : '.'));
    if (Date.now() - t0 > maxMs) throw new DeeplError('DeepL сè уште преведува – обидете се повторно за неколку минути.');
    await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(1500, (s.seconds_remaining ?? 2) * 1000))));
  }
}

/** File name of a translation: „договор.pdf“ → „договор (MK).pdf“. */
export const translatedName = (name: string, to: DeeplLang) => {
  const m = /^(.*?)(\.[a-z0-9]{1,8})?$/i.exec(name)!;
  return `${m[1]} (${to})${m[2] ?? ''}`;
};

export const deeplErr = (e: unknown) => (e instanceof DeeplError ? e.message : 'Преводот не успеа.');
