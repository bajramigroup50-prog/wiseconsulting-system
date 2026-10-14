/**
 * `robot.ask` — answer one question of „🤖 WISE Робот“ (the web wrote the question and a queued answer row for the
 * user's authenticated firm / year and polls the row). The free router already ran in the web; here the agent loop
 * (`../ai/agent.ts`) answers with the model. No retries: a failed answer is shown with its reason, never paid twice.
 */
import { eq } from 'drizzle-orm';
import { aiBlockedMsg, aiProviderError, AI_ERR_BLOCKING } from '@wise/core/ai/errors';
import { ROBOT_AI_MSG } from '@wise/core/robot';
import { todaySkopje } from '@wise/core/office';
import { getAiSettings, noteAiFailure, robotFinish, robotFirmAccess, robotHistory, robotLinkProposals, robotMessages, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { AiUnavailableError, aiConfigured } from '../ai/client';
import { AiBudgetError } from '../ai/budget';
import { runRobotAgent } from '../ai/agent';

export const ROBOT_ASK = 'robot.ask';

export async function runRobotAsk(db: Tx, id: string, today = todaySkopje()): Promise<void> {
  const [m] = await db.select().from(robotMessages).where(eq(robotMessages.id, id)).limit(1);
  if (!m || m.role !== 'assistant' || m.status !== 'queued') return;
  await db.update(robotMessages).set({ status: 'running' }).where(eq(robotMessages.id, id));
  const fail = (text: string, code: string) => robotFinish(db, id, { text, status: 'error', error: code });
  try {
    const [q] = m.replyTo ? await db.select().from(robotMessages).where(eq(robotMessages.id, m.replyTo)).limit(1) : [];
    if (!q || q.userId !== m.userId || q.firmId !== m.firmId) return await fail('Прашањето не е пронајдено.', 'other');
    // the firm comes from the row the web wrote for the authenticated request — and access is checked again here
    const firm = await robotFirmAccess(db, m.userId, m.firmId);
    if (!firm) return await fail('Немате пристап до оваа фирма.', 'forbidden');
    const S = await getAiSettings(db);
    if (!S.enabled) return await fail(ROBOT_AI_MSG.off, 'off');
    if (S.lastFail) return await fail(aiBlockedMsg(S.lastFail.code, S.lastFail.at), S.lastFail.code);
    if (!aiConfigured()) return await fail(ROBOT_AI_MSG.nokey, 'nokey');
    const history = await robotHistory(db, m.userId, m.firmId, q.createdAt);
    const r = await runRobotAgent({ db, ctx: { db, firm, year: m.year, userId: m.userId, today }, question: q.text, history, deep: m.deep, refId: id });
    await robotLinkProposals(db, firm.id, r.proposals, id);
    await robotFinish(db, id, { text: r.text, tools: r.tools, sources: r.sources, unverified: r.unverified, model: r.model, costUsd: r.costUsd });
  } catch (e) {
    // the monthly limit: the existing pause message (Систем › 💲 AI трошок)
    if (e instanceof AiBudgetError) return void await fail(e.message, 'budget');
    if (e instanceof AiUnavailableError) return void await fail(ROBOT_AI_MSG.nokey, 'nokey');
    const p = aiProviderError(e);
    if (p && AI_ERR_BLOCKING.has(p.code)) await noteAiFailure(db, p.code, p.detail).catch(() => null);
    await fail(p ? ROBOT_AI_MSG[p.code as keyof typeof ROBOT_AI_MSG] ?? ROBOT_AI_MSG.other : ROBOT_AI_MSG.other, p?.code ?? 'other');
  }
}

export const robotAsk = defineJob<{ id: string }>({
  name: ROBOT_ASK,
  queue: { retryLimit: 0, expireInSeconds: 600 },
  async run(data, { db }) {
    if (data?.id) await runRobotAsk(db as unknown as Tx, data.id);
  },
});
