/**
 * `ai.ping` — „🔎 Провери го AI-кредитот сега“ (Систем › 🤖 AI читање): one request of 1 output token with the cheapest
 * model. Success clears the remembered credit / key failure (`app_settings.ai.lastFail`) so the next reads use AI at
 * once; a credit / key failure is remembered again. The result is stored as `app_settings.ai.lastPing` (with the id of
 * the screen's request), which the screen waits for.
 *
 * The reader (`ai-read-document.ts`) also pings by itself when a read is blocked by a failure older than 2 minutes,
 * at most once per 2 minutes office-wide (`shouldAutoPing`), so a top-up is picked up without anybody clicking.
 */
import { AI_ERR_BLOCKING, AI_ERR_MSG, AI_PING_OK, aiProviderError, type AiErrCode } from '@wise/core/ai/errors';
import { clearAiFailure, noteAiFailure, noteAiPing, type AiSettings, type Tx } from '@wise/db';
import { AI_MODELS, aiConfigured, aiMessages, AiUnavailableError } from '../ai/client';
import { defineJob } from '../job';

export const AI_PING = 'ai.ping';
/** Automatic check: only for a failure older than this, and not more often than this. */
export const AUTO_PING_MS = 2 * 60_000;

export interface PingResult { ok: boolean; code: AiErrCode | null; msg: string }

/** Is an automatic check due for a read blocked by `S.lastFail`? */
export function shouldAutoPing(S: AiSettings, now = Date.now()): boolean {
  if (!S.enabled || !S.lastFail || !AI_ERR_BLOCKING.has(S.lastFail.code)) return false;
  if (now - Date.parse(S.lastFail.at) < AUTO_PING_MS) return false;
  return !S.lastPing || now - Date.parse(S.lastPing.at) >= AUTO_PING_MS;
}

/** One 1-token request; records the result (and clears / sets the office-wide failure). */
export async function runAiPing(db: Tx, opt: { id?: string | null; auto?: boolean } = {}): Promise<PingResult> {
  let r: PingResult;
  try {
    if (!aiConfigured()) throw new AiUnavailableError();
    await aiMessages().create({ model: AI_MODELS.quick, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    await clearAiFailure(db);
    r = { ok: true, code: null, msg: AI_PING_OK };
  } catch (e) {
    if (e instanceof AiUnavailableError) r = { ok: false, code: 'nokey', msg: AI_ERR_MSG.nokey };
    else {
      const p = aiProviderError(e);
      const code: AiErrCode = p?.code ?? 'other';
      if (p && AI_ERR_BLOCKING.has(p.code)) await noteAiFailure(db, p.code, p.detail);
      r = { ok: false, code, msg: AI_ERR_MSG[code] };
    }
  }
  await noteAiPing(db, { ok: r.ok, code: r.code, msg: r.msg, id: opt.id ?? null, auto: !!opt.auto });
  return r;
}

export const aiPing = defineJob<{ id?: string }>({
  name: AI_PING,
  async run(data, { db, log }) {
    const r = await runAiPing(db as unknown as Tx, { id: data?.id ?? null });
    log(`ai.ping: ${r.ok ? 'ok' : r.code}`);
  },
});
