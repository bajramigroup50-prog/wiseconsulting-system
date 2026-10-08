/**
 * Anthropic client for document reading (replaces legacy `S.sample` / `sampleDoc`). Shared AI infrastructure —
 * other phases call `readDocument` (read-document.ts) instead of building their own client.
 *
 * Tiers (legacy `modelTier`): quick → Haiku, default → Sonnet, complex → Opus.
 * Without `ANTHROPIC_API_KEY` every call fails with `AiUnavailableError` (a clear Macedonian message, no retries).
 */
import Anthropic from '@anthropic-ai/sdk';

export type AiTier = 'quick' | 'default' | 'complex';

export const AI_MODELS: Record<AiTier, string> = {
  quick: 'claude-haiku-5-5',
  default: 'claude-sonnet-5-5',
  complex: 'claude-opus-5-5',
};

/** USD per 1M tokens: input, output, cache read, cache write (5 min). */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
};

export interface AiUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

export function costUsd(model: string, u: AiUsage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (u.inputTokens * p[0] + u.outputTokens * p[1] + u.cacheReadTokens * p[2] + u.cacheWriteTokens * p[3]) / 1e6;
}

export class AiUnavailableError extends Error {
  constructor(message = 'Автоматското читање не е достапно: на серверот не е поставен ANTHROPIC_API_KEY. Внесете ги податоците рачно или побарајте од администраторот да го постави клучот.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** The subset of the SDK the readers use (lets tests inject a fake). */
export interface MessagesApi {
  create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

let override: MessagesApi | null = null;
let client: Anthropic | null = null;

/** Tests: inject a fake `messages` API (pass null to reset). */
export function setAiClient(m: MessagesApi | null): void { override = m; }

export function aiMessages(): MessagesApi {
  if (override) return override;
  if (!process.env.ANTHROPIC_API_KEY) throw new AiUnavailableError();
  client ??= new Anthropic({ maxRetries: 3, timeout: 5 * 60_000 });
  return client.messages;
}

export const aiConfigured = () => !!override || !!process.env.ANTHROPIC_API_KEY;
