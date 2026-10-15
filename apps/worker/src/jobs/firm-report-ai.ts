/**
 * „💲 AI анализа“ of the office owner's „🗂 Целосен извештај за фирма“ (`firm-report.ai`, started from the report).
 *
 * The web stores the payload with the request (`app_settings` `firmIzvAi:<firm>:<year>`): ONLY the report's numbers and
 * its findings, scrubbed of the firm / partner / employee / colleague names and of identifiers (`frAiPayload`), plus the
 * stored law texts of the cited articles. Nothing else is read here. `askText` applies the monthly AI limit (a paused
 * budget → no call, the error is shown) and logs `ai_usage` (purpose `firmReport`). Every article the answer cites
 * outside the given context is tagged „[треба да се провери]“ (`frAiCheck`).
 */
import { FIRM_REPORT_AI_JOB, frAiCheck, frAiPrompt, type FrAiPayload } from '@wise/core/office/firm-report';
import { firmReportAiState, putFirmReportAiState, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { AiBudgetError } from '../ai/budget';
import { aiConfigured } from '../ai/client';

export interface FirmReportAiJob { firmId: string; year: number; reqId: string }

export async function runFirmReportAi(db: Tx, j: FirmReportAiJob): Promise<boolean> {
  const s = await firmReportAiState(db, j.firmId, j.year);
  if (!s || s.reqId !== j.reqId || s.status !== 'queued' || !s.payload) return false;
  try {
    if (!aiConfigured()) throw new Error('AI не е достапен: на серверот не е поставен ANTHROPIC_API_KEY.');
    const payload = s.payload as FrAiPayload;
    const r = await askText({
      db, prompt: frAiPrompt(payload), tier: 'default', purpose: 'firmReport', refId: j.firmId, userId: s.userId, firmId: j.firmId, maxTokens: 2500,
    });
    const c = frAiCheck(r.text, payload);
    // a newer request replaced this one while the model was writing
    if ((await firmReportAiState(db, j.firmId, j.year))?.reqId !== j.reqId) return false;
    await putFirmReportAiState(db, { ...s, status: 'done', text: c.text, unverified: c.unverified, model: r.model, costUsd: r.costUsd, at: new Date().toISOString(), error: null, payload: undefined });
    return true;
  } catch (e) {
    const msg = e instanceof AiBudgetError ? `AI е паузиран: ${e.message}` : (e as Error).message || String(e);
    await putFirmReportAiState(db, { ...s, status: 'error', error: msg, at: new Date().toISOString(), payload: undefined }).catch(() => undefined);
    return false;
  }
}

export const firmReportAi = defineJob<FirmReportAiJob>({
  name: FIRM_REPORT_AI_JOB,
  queue: { retryLimit: 0, expireInSeconds: 10 * 60 },
  async run(data, { db }) {
    if (data?.firmId && data.year && data.reqId) await runFirmReportAi(db as unknown as Tx, data);
  },
});
