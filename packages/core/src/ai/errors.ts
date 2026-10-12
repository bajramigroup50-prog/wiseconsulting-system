/**
 * AI provider errors → short code + clear Macedonian message (the raw English text of the API stays available as
 * `detail` for the administrator). Used by the worker when a read fails and by the screens that list failed reads,
 * which show the free (non-AI) import paths next to the row.
 *
 *   credit     API credit exhausted („Your credit balance is too low …“)
 *   auth       invalid / revoked API key, no permission
 *   rate       rate limit (429)
 *   overloaded provider overloaded / temporary server error (529, 5xx)
 *   timeout    request timed out / connection lost
 *   nokey      no API key on the server
 *   off        AI reading switched off in Систем (the free reader could not read this file)
 *   noai       read without AI failed (scanned image, unknown layout)
 *   budget     the monthly AI limit (office or firm) is reached – AI paused, free readers continue (`./cost.ts`)
 */
export type AiErrCode = 'credit' | 'auth' | 'rate' | 'overloaded' | 'timeout' | 'nokey' | 'off' | 'noai' | 'budget' | 'other';

export interface AiErrInfo { code: AiErrCode; msg: string; detail: string }

const FREE = 'Додека чекате, увезете од Excel/CSV/XML или преку 🔄 Конвертор на датотеки.';

export const AI_ERR_MSG: Record<AiErrCode, string> = {
  credit: 'AI-кредитот е потрошен – дополнете на console.anthropic.com → Billing, па кликнете ↻ Повторно. ' + FREE,
  auth: 'AI-клучот не е важечки или е одбиен – администраторот треба да постави нов ANTHROPIC_API_KEY на серверот. ' + FREE,
  rate: 'Премногу AI-барања во кратко време – почекајте минута-две, па кликнете ↻ Повторно.',
  overloaded: 'AI-услугата е моментално преоптоварена – обидете се повторно за неколку минути (↻ Повторно).',
  timeout: 'AI-читањето траеше предолго или врската прекина – кликнете ↻ Повторно.',
  nokey: 'AI-читањето не е поставено на серверот (нема ANTHROPIC_API_KEY). ' + FREE,
  off: 'AI-читањето е исклучено (Систем › AI читање). ' + FREE,
  noai: 'Документот не може да се прочита без AI. ' + FREE,
  budget: 'Месечниот лимит за AI е достигнат – AI-читањето е паузирано (Систем › 💲 AI трошок). ' + FREE,
  other: 'AI-читањето не успеа. Кликнете ↻ Повторно. ' + FREE,
};

/** Codes for which the free import paths are the useful next step. */
export const AI_ERR_FREE: ReadonlySet<AiErrCode> = new Set(['credit', 'auth', 'nokey', 'off', 'noai', 'budget', 'other']);
/** Codes that mean „AI is not usable at all right now“ — later reads go to the free readers until a retry succeeds. */
export const AI_ERR_BLOCKING: ReadonlySet<AiErrCode> = new Set(['credit', 'auth']);

const str = (e: unknown): string => {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
};

/** Classify an error thrown by the Anthropic SDK (or its stored text). Returns null for non-provider errors. */
export function aiProviderError(e: unknown): AiErrInfo | null {
  const detail = str(e).slice(0, 2000);
  const status = typeof e === 'object' && e && 'status' in e ? Number((e as { status?: unknown }).status) : NaN;
  const name = e instanceof Error ? e.name : '';
  const t = detail.toLowerCase();
  let code: AiErrCode | null = null;
  if (/credit balance|billing|insufficient.?credit|purchase credits/.test(t)) code = 'credit';
  else if (status === 401 || status === 403 || /authentication_error|permission_error|invalid x-api-key|invalid api key|api key/.test(t)) code = 'auth';
  else if (status === 429 || /rate_limit|rate limit|too many requests/.test(t)) code = 'rate';
  else if (status === 529 || status === 500 || status === 502 || status === 503 || /overloaded|internal server error|api_error|service unavailable/.test(t)) code = 'overloaded';
  else if (/timeout|timed out|etimedout|econnreset|socket hang up|connection error|fetch failed|apiconnection/.test(t + ' ' + name.toLowerCase())) code = 'timeout';
  if (!code) return null;
  return { code, msg: AI_ERR_MSG[code], detail };
}

/** Code of a stored error text (rows written before the code was stored, or by older workers). */
export function aiErrCodeOf(msg: string | null | undefined, stored?: unknown): AiErrCode | null {
  if (typeof stored === 'string' && stored in AI_ERR_MSG) return stored as AiErrCode;
  const s = String(msg ?? '');
  if (!s) return null;
  for (const [k, v] of Object.entries(AI_ERR_MSG)) if (s === v) return k as AiErrCode;
  if (/^Автоматското читање не е достапно/.test(s)) return 'nokey';
  return aiProviderError(s)?.code ?? null;
}

/** Friendly text of a stored error: raw provider JSON is never shown to the user. */
export function aiErrText(msg: string | null | undefined, stored?: unknown): string {
  const c = aiErrCodeOf(msg, stored);
  const s = String(msg ?? '');
  if (c && /^\d{3}\s|\{"type":"error"|error":\{/.test(s)) return AI_ERR_MSG[c];
  return s;
}
