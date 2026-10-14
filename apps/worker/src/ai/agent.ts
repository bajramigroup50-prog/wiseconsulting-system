/**
 * 🤖 WISE Робот — the agent loop (Anthropic tool use) over the typed tools of `@wise/db` robot.
 *
 * Cost control (same infrastructure as every other AI call, `./budget.ts`):
 *  - `aiBudgetGuard` before the first call AND before every further step (a long loop cannot run past the limit);
 *  - each model call is reserved in `ai_usage` (purpose `robot`) before it is made and settled with the real tokens;
 *  - default (Sonnet-class) tier; the deep tier only for „Длабока анализа“ (`effectiveTier`);
 *  - at most `ROBOT_MAX_STEPS` model calls per answer (the last one without tools, so the model must answer),
 *    `max_tokens` per call capped;
 *  - prompt caching: the system prompt and the tool definitions carry `cache_control` (shared prefix office-wide).
 *
 * Safety: the firm and year are in `ctx` (from the authenticated request) and never come from the model; every amount
 * in the final answer that no tool returned is listed in `unverified` (shown as a warning under the answer).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ROBOT_SYSTEM, robotContextLine, unverifiedNumbers } from '@wise/core/robot';
import { robotToolSpecs, runRobotTool, type RobotCtx, type RobotSource, type RobotToolCall, type Tx } from '@wise/db';
import { AI_MODELS, aiMessages, costUsd, type AiTier } from './client';
import { aiBudgetGuard, effectiveTier, estimateCost, estimateInputTokens, reserveAiCall, settleAiCall } from './budget';

export const ROBOT_MAX_STEPS = 8;
export const ROBOT_MAX_TOKENS = 1500;
export const ROBOT_MAX_TOKENS_DEEP = 3000;
/** Tool output sent back to the model (characters). */
const TOOL_OUT_MAX = 14_000;
/** Rough input tokens of the tool definitions (for the estimate). */
const TOOLS_EST_TOKENS = 3500;

export const ROBOT_CAP_MSG = `Достигнат е лимитот од ${ROBOT_MAX_STEPS} чекори за еден одговор – поставете попрецизно прашање.`;

export interface AgentArgs {
  db: Tx;
  ctx: RobotCtx;
  question: string;
  history?: readonly { role: 'user' | 'assistant'; text: string }[];
  deep?: boolean;
  /** `robot_messages.id` of the answer (ai_usage.ref_id). */
  refId?: string | null;
  maxSteps?: number;
}

export interface AgentResult {
  text: string;
  tools: RobotToolCall[];
  sources: RobotSource[];
  proposals: string[];
  unverified: string[];
  model: string;
  tier: AiTier;
  costUsd: number;
  steps: number;
  capped: boolean;
}

/** User / assistant turns must alternate and start with the user. */
function conversation(history: AgentArgs['history'], first: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const h of history ?? []) {
    if (!out.length && h.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === h.role) last.content = `${last.content as string}\n\n${h.text}`;
    else out.push({ role: h.role, content: h.text });
  }
  if (out.length && out[out.length - 1]!.role === 'user') out.pop();
  out.push({ role: 'user', content: first });
  return out;
}

const usageOf = (m: Anthropic.Message) => ({
  inputTokens: m.usage?.input_tokens ?? 0, outputTokens: m.usage?.output_tokens ?? 0,
  cacheReadTokens: m.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: m.usage?.cache_creation_input_tokens ?? 0,
});

export async function runRobotAgent(a: AgentArgs): Promise<AgentResult> {
  const api = aiMessages();
  const firmId = a.ctx.firm.id;
  const cfg = await aiBudgetGuard(a.db, firmId);
  const tier: AiTier = a.deep ? effectiveTier('complex', true, cfg) : 'default';
  const model = AI_MODELS[tier];
  const maxTokens = a.deep ? ROBOT_MAX_TOKENS_DEEP : ROBOT_MAX_TOKENS;
  const maxSteps = Math.max(1, Math.min(a.maxSteps ?? ROBOT_MAX_STEPS, ROBOT_MAX_STEPS));
  const specs = robotToolSpecs();
  const tools: Anthropic.Tool[] = specs.map((t, i) => ({ ...t, ...(i === specs.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) }) as Anthropic.Tool);
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: ROBOT_SYSTEM, cache_control: { type: 'ephemeral' } }];
  const first = `${robotContextLine({ firm: a.ctx.firm.name, year: a.ctx.year, today: a.ctx.today, vat: a.ctx.firm.vatRegistered })}\n\n${a.question}`;
  const messages = conversation(a.history, first);

  const calls: RobotToolCall[] = [];
  const sources = new Map<string, RobotSource>();
  const proposals: string[] = [];
  const toolTexts: string[] = [];
  let total = 0, steps = 0, text = '', capped = false;

  for (;;) {
    if (steps >= maxSteps) { capped = true; break; }
    if (steps > 0) await aiBudgetGuard(a.db, firmId);
    const last = steps === maxSteps - 1;
    const est = estimateCost(model, estimateInputTokens([], ROBOT_SYSTEM + JSON.stringify(messages)) + TOOLS_EST_TOKENS, maxTokens);
    const rid = await reserveAiCall(a.db, { firmId, userId: a.ctx.userId, purpose: 'robot', tier, model, refId: a.refId ?? null }, est);
    let msg: Anthropic.Message;
    try {
      msg = await api.create({
        model, max_tokens: maxTokens, system, tools, messages,
        // the last step may not call tools any more: the model must answer with what it has
        ...(last ? { tool_choice: { type: 'none' } as Anthropic.ToolChoice } : {}),
      });
    } catch (e) { await settleAiCall(a.db, rid, firmId, null, 0); throw e; }
    steps++;
    const u = usageOf(msg);
    const cost = costUsd(model, u);
    total += cost;
    await settleAiCall(a.db, rid, firmId, u, cost);
    if (msg.stop_reason === 'refusal') { text = 'Моделот одби да одговори на ова прашање.'; break; }
    const said = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (said) text = said;
    if (!uses.length) break;
    if (last) { capped = true; break; }
    messages.push({ role: 'assistant', content: msg.content as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of uses) {
      const t0 = Date.now();
      const out = await runRobotTool(a.ctx, tu.name, tu.input);
      calls.push({ name: tu.name, ok: out.ok, ms: Date.now() - t0, summary: out.summary.slice(0, 300) });
      for (const s of out.sources) sources.set(s.href, s);
      if (out.proposalId) proposals.push(out.proposalId);
      const body = JSON.stringify({ ok: out.ok, summary: out.summary, data: out.data ?? null, sources: out.sources });
      toolTexts.push(body);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: body.length > TOOL_OUT_MAX ? body.slice(0, TOOL_OUT_MAX) + '…(скратено)' : body, ...(out.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
  }

  if (capped) text = text ? `${text}\n\n⚠ ${ROBOT_CAP_MSG}` : ROBOT_CAP_MSG;
  if (!text) text = 'Нема одговор.';
  return {
    text, tools: calls, sources: [...sources.values()], proposals, unverified: unverifiedNumbers(text, toolTexts),
    model, tier, costUsd: total, steps, capped,
  };
}
