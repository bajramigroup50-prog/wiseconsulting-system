/**
 * Plain-text answer from the model (legacy `S.sample(prompt)` without a document) — used by the law assistant
 * (`law.ask`). Logged in `ai_usage` like the document reads, under the same monthly limit (`./budget.ts`).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Tx } from '@wise/db';
import { AI_MODELS, aiMessages, costUsd, type AiTier } from './client';
import { AiReadError } from './read-document';
import { aiBudgetGuard, effectiveTier, estimateCost, estimateInputTokens, reserveAiCall, settleAiCall } from './budget';

export async function askText(a: { db: Tx; prompt: string; tier?: AiTier; purpose: string; refId?: string | null; userId?: string | null; firmId?: string | null; maxTokens?: number; deep?: boolean }): Promise<{ text: string; model: string; costUsd: number }> {
  const api = aiMessages();
  const cfg = await aiBudgetGuard(a.db, a.firmId ?? null);
  const tier = effectiveTier(a.tier ?? 'default', a.deep, cfg);
  const model = AI_MODELS[tier];
  const maxTokens = a.maxTokens ?? 4000;
  const rid = await reserveAiCall(a.db, { firmId: a.firmId ?? null, userId: a.userId, purpose: a.purpose, tier, model, refId: a.refId }, estimateCost(model, estimateInputTokens([], a.prompt), maxTokens));
  let msg: Anthropic.Message;
  try { msg = await api.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: a.prompt }] }); } catch (e) { await settleAiCall(a.db, rid, a.firmId ?? null, null, 0); throw e; }
  const usage = {
    inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
    cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
  };
  const cost = costUsd(model, usage);
  await settleAiCall(a.db, rid, a.firmId ?? null, usage, cost);
  if (msg.stop_reason === 'refusal') throw new AiReadError('Моделот одби да одговори.');
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new AiReadError('Нема одговор.');
  return { text, model, costUsd: cost };
}
