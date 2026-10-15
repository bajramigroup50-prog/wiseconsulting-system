/**
 * AI budget and cost queries (`app_settings` key `aiBudget`, `ai_usage`, `ai_documents`). The rules (levels, messages,
 * projection, aggregation) are in `@wise/core/ai/cost`; the worker pauses AI at 100 % (apps/worker/src/ai/budget.ts),
 * the owner sees the report and sets the limits in „💲 AI трошок“ (apps/web/app/(app)/aiTrosok).
 */
import { and, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { AI_BUDGET_KEY, aiBudgetClean, budgetState, skopjeMonthStart, type AiBudgetCfg, type BudgetState, type DocAggRow, type UsageAggRow } from '@wise/core/ai/cost';
import { ymAdd, todaySkopje } from '@wise/core/office/dates';
import { aiDocuments, aiUsage, appSettings } from './schema/index';
import type { Tx } from './audit';
import { DEMO_AI_OFF_MSG, DEMO_AI_PURPOSE } from '@wise/core/demo';
import { demoFirmIds, getDemoSettings, isDemoFirmId } from './demo/filters';

type Q = Pick<Tx, 'select' | 'insert' | 'update'>;

export const curMonth = (now = new Date()) => todaySkopje(now).slice(0, 7);

export async function getAiBudget(tx: Q): Promise<AiBudgetCfg> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, AI_BUDGET_KEY)).limit(1);
  return aiBudgetClean(r?.v);
}

/** Merge a change into the stored budget (the owner's form, the worker's alert). */
export async function putAiBudget(tx: Q, p: Partial<AiBudgetCfg>, userId: string | null = null): Promise<AiBudgetCfg> {
  const value = { ...(await getAiBudget(tx)), ...p };
  await tx.insert(appSettings).values({ key: AI_BUDGET_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
  return value;
}

const range = (month: string) => and(gte(aiUsage.at, skopjeMonthStart(month)), lt(aiUsage.at, skopjeMonthStart(ymAdd(month, 1))));

/** USD spent on AI in a month (office-wide, or one firm). Reserved (in-flight) calls count too. */
export async function aiSpend(tx: Q, month: string, firmId?: string | null): Promise<number> {
  const [r] = await tx.select({ c: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` }).from(aiUsage)
    .where(firmId ? and(range(month), eq(aiUsage.firmId, firmId)) : range(month));
  return Number(r?.c ?? 0);
}

/** Budget state for an AI call of a firm (null = office-wide call). */
export async function aiBudgetStatus(tx: Q, firmId: string | null, month = curMonth(), cfg?: AiBudgetCfg): Promise<BudgetState & { cfg: AiBudgetCfg }> {
  const c = cfg ?? await getAiBudget(tx);
  // 🎭 a demo firm: AI off unless the owner allowed it, then only under the separate demo monthly cap
  if (firmId && await isDemoFirmId(tx, firmId)) return { ...(await demoAiState(tx, month)), cfg: c };
  const spent = await aiSpend(tx, month);
  const firmSpent = firmId && c.firms[firmId] != null ? await aiSpend(tx, month, firmId) : 0;
  return { ...budgetState(c, month, spent, firmId, firmSpent), cfg: c };
}

/**
 * After a call: when the office (or the firm) crosses 80 % / 100 % for the first time this month, remember it in
 * `aiBudget.alert` (the owner's top-bar badge and the report show it). Returns the newly reached level or null.
 */
export async function noteAiBudgetAlert(tx: Q, firmId: string | null, month = curMonth()): Promise<80 | 100 | null> {
  const s = await aiBudgetStatus(tx, firmId, month);
  const office = s.level, firm = s.firmLevel;
  const level = Math.max(office, firm) as 0 | 80 | 100;
  if (!level) return null;
  const prev = s.cfg.alert?.month === month ? s.cfg.alert.level : 0;
  if (level <= prev) return null;
  const byFirm = firm > office;
  await putAiBudget(tx, { alert: { month, level, at: new Date().toISOString(), spent: byFirm ? s.firmSpent : s.spent, limit: (byFirm ? s.firmLimit : s.limit) ?? 0, firmId: byFirm ? firmId : null } });
  return level;
}

/**
 * Cost log of a month grouped by firm / purpose / model. `firmIds`: only these firms; `o.exclude`: everything but
 * these firms (office-wide rows without a firm stay) — the real office's report leaves the 🎭 demo firms out.
 */
export async function aiUsageAgg(tx: Q, month: string, firmIds?: readonly string[] | null, o: { exclude?: readonly string[] } = {}): Promise<UsageAggRow[]> {
  const R = await tx.select({
    firmId: aiUsage.firmId, purpose: aiUsage.purpose, model: aiUsage.model,
    calls: sql<number>`count(*)::int`, docs: sql<number>`count(distinct coalesce(${aiUsage.refId}, ${aiUsage.id}::text))::int`,
    inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`, outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`, cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
    costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`,
  }).from(aiUsage).where(and(
    range(month), firmIds ? (firmIds.length ? inArray(aiUsage.firmId, [...firmIds]) : sql`false`) : undefined,
    o.exclude?.length ? or(isNull(aiUsage.firmId), notInArray(aiUsage.firmId, [...o.exclude])) : undefined,
    // 🎭 with `exclude` (the real office's report): also the demo calls whose firm is gone (purpose `demo:…`)
    o.exclude ? sql`${aiUsage.purpose} not like 'demo%'` : undefined,
  ))
    .groupBy(aiUsage.firmId, aiUsage.purpose, aiUsage.model);
  return R.map((r) => ({ ...r, calls: Number(r.calls), docs: Number(r.docs), inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), cacheReadTokens: Number(r.cacheReadTokens), cacheWriteTokens: Number(r.cacheWriteTokens), costUsd: Number(r.costUsd) }));
}

/** Reads of a month grouped by firm / kind: free (`noai` / `ubl`), AI, reused from an earlier read, failed. */
export async function aiDocAgg(tx: Q, month: string, firmIds?: readonly string[] | null, o: { exclude?: readonly string[] } = {}): Promise<DocAggRow[]> {
  const d0 = skopjeMonthStart(month), d1 = skopjeMonthStart(ymAdd(month, 1));
  const free = sql`${aiDocuments.model} in ('noai', 'ubl')`;
  const cached = sql`(${aiDocuments.options} ->> 'cachedFrom') is not null`;
  const R = await tx.select({
    firmId: aiDocuments.firmId, kind: aiDocuments.kind,
    total: sql<number>`count(*) filter (where ${aiDocuments.model} is not null)::int`,
    free: sql<number>`count(*) filter (where ${free})::int`,
    ai: sql<number>`count(*) filter (where ${aiDocuments.model} is not null and not ${free} and not ${cached})::int`,
    cached: sql<number>`count(*) filter (where ${cached})::int`,
    failed: sql<number>`count(*) filter (where ${aiDocuments.status} = 'error')::int`,
  }).from(aiDocuments)
    .where(and(gte(aiDocuments.createdAt, d0), lt(aiDocuments.createdAt, d1), firmIds ? (firmIds.length ? inArray(aiDocuments.firmId, [...firmIds]) : sql`false`) : undefined,
      o.exclude?.length ? or(isNull(aiDocuments.firmId), notInArray(aiDocuments.firmId, [...o.exclude])) : undefined))
    .groupBy(aiDocuments.firmId, aiDocuments.kind);
  return R.map((r) => ({ ...r, kind: String(r.kind), total: Number(r.total), free: Number(r.free), ai: Number(r.ai), cached: Number(r.cached), failed: Number(r.failed) }));
}

/** USD spent on AI for demo firms in a month (the calls tagged `demo:<purpose>` — kept across the nightly reset — or of a current demo firm). */
export async function demoAiSpend(tx: Q, month = curMonth()): Promise<number> {
  const ids = await demoFirmIds(tx, { all: true });
  const tagged = sql`${aiUsage.purpose} like ${DEMO_AI_PURPOSE + ':%'}`;
  const [r] = await tx.select({ c: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` }).from(aiUsage)
    .where(and(range(month), ids.length ? or(tagged, inArray(aiUsage.firmId, ids)) : tagged));
  return Number(r?.c ?? 0);
}

/** Budget state of an AI call for a demo firm: paused when demo AI is off (default) or the demo cap is reached. */
export async function demoAiState(tx: Q, month = curMonth()): Promise<BudgetState> {
  const d = await getDemoSettings(tx);
  const spent = await demoAiSpend(tx, month);
  const st = budgetState({ monthlyUsd: d.aiLimitUsd, firms: {} }, month, spent, null, 0);
  return d.ai ? st : { ...st, paused: true, msg: DEMO_AI_OFF_MSG };
}
