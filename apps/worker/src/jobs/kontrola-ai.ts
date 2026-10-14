/**
 * „💲 AI правна анализа“ of an inspection case (`kontrola.ai`, started by the office from „📑 Контроли и решенија“).
 *
 * The prompt carries the case only (act, findings, our recalculated amounts, the evidence summary, the cited articles)
 * plus the relevant texts of the program's law store — the tax review rules (`LR_RULES`, article + rule), the legal
 * remedies of the act and the law changes found by the daily law robot (`law_changes`). No ЕДБ / ЕМБС / address and no
 * staff names go out. Sonnet by default, Opus only on „🔍 Детално“ (`deep`); the budget guard, the `ai_usage`
 * reservation / settlement and the monthly limit are those of `askText`.
 *
 * The answer is checked (`parseKontrolaAi`): every article the model cites that is not in the store is tagged
 * „треба да се провери“. The result is stored as a new version of the case (model + cost) and applies nothing:
 * the user reviews it and accepts or discards it.
 */
import { desc } from 'drizzle-orm';
import { kontrolaAiPrompt, kontrolaLawContext, parseKontrolaAi } from '@wise/core/compliance';
import { LR_RULES } from '@wise/core/law';
import { failKontrolaAi, kontrolaAiState, lawChanges, loadKontrolaCase, saveKontrolaAiResult, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { aiConfigured } from '../ai/client';

export interface KontrolaAiJob { kid: string; firmId: string; reqId: string; userId?: string | null; deep?: boolean }

export async function runKontrolaAi(db: Tx, j: KontrolaAiJob): Promise<string | null> {
  try {
    if (!aiConfigured()) throw new Error('AI не е достапен: на серверот не е поставен ANTHROPIC_API_KEY.');
    const c = await loadKontrolaCase(db, j.firmId, j.kid);
    if (!c) return null;
    if (kontrolaAiState(c.k)?.reqId !== j.reqId) return null; // a newer request replaced this one
    const L = await db.select({ id: lawChanges.id, title: lawChanges.title, what: lawChanges.what, date: lawChanges.date, from: lawChanges.from, verified: lawChanges.verified })
      .from(lawChanges).orderBy(desc(lawChanges.date), desc(lawChanges.createdAt)).limit(400);
    const ctx = kontrolaLawContext({ auth: c.input.auth, doc: c.input.doc, findings: c.input.items.map((it) => it.f), rules: LR_RULES, changes: L });
    const r = await askText({
      db, prompt: kontrolaAiPrompt(c.input, ctx), tier: j.deep ? 'complex' : 'default', deep: !!j.deep, purpose: 'kontrolaAi',
      refId: j.kid, userId: j.userId ?? null, firmId: j.firmId, maxTokens: j.deep ? 12_000 : 8_000,
    });
    const analysis = parseKontrolaAi(r.text, ctx, c.input.items.map((it) => it.f.no));
    return await db.transaction((tx) => saveKontrolaAiResult(tx, j.firmId, j.kid, { reqId: j.reqId, analysis, model: r.model, costUsd: r.costUsd, userId: j.userId ?? null }));
  } catch (e) {
    await failKontrolaAi(db, j.firmId, j.kid, j.reqId, (e as Error).message || String(e)).catch(() => undefined);
    return null;
  }
}

export const kontrolaAi = defineJob<KontrolaAiJob>({
  name: 'kontrola.ai',
  queue: { retryLimit: 0, expireInSeconds: 15 * 60 },
  async run(data, { db }) {
    if (data?.kid && data.firmId && data.reqId) await runKontrolaAi(db as unknown as Tx, data);
  },
});
