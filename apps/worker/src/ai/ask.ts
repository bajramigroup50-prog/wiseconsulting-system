/**
 * Plain-text answer from the model (legacy `S.sample(prompt)` without a document) — used by the law assistant
 * (`law.ask`). Logged in `ai_usage` like the document reads.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { aiUsage, type Tx } from '@wise/db';
import { AI_MODELS, aiMessages, costUsd, type AiTier } from './client';
import { AiReadError } from './read-document';

export async function askText(a: { db: Tx; prompt: string; tier?: AiTier; purpose: string; refId?: string | null; userId?: string | null; firmId?: string | null; maxTokens?: number }): Promise<{ text: string; model: string }> {
  const tier = a.tier ?? 'default';
  const model = AI_MODELS[tier];
  const msg = await aiMessages().create({ model, max_tokens: a.maxTokens ?? 4000, messages: [{ role: 'user', content: a.prompt }] });
  const usage = {
    inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
    cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
  };
  await a.db.insert(aiUsage).values({ firmId: a.firmId ?? null, userId: a.userId ?? null, purpose: a.purpose, tier, model, ...usage, costUsd: costUsd(model, usage).toFixed(6), refId: a.refId ?? null });
  if (msg.stop_reason === 'refusal') throw new AiReadError('Моделот одби да одговори.');
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new AiReadError('Нема одговор.');
  return { text, model };
}
