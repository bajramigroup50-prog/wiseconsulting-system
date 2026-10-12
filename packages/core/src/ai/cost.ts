/**
 * AI cost control (owner's „💲 AI трошок“): the office budget (`app_settings` key `aiBudget`), the 80 % / 100 % levels,
 * the month projection and the aggregation of the cost log (`ai_usage`) and the reads (`ai_documents`) into the
 * report per firm / document kind / model. Pure — the queries are in `@wise/db` (ai-budget.ts), the guard that pauses
 * AI at 100 % is in the worker (apps/worker/src/ai/budget.ts).
 *
 * Free readers (bank / trial balance / invoices / inspection acts with a text layer, Excel / CSV / XML) never count
 * against the budget: when AI is paused they keep working.
 */

export interface AiBudgetCfg {
  /** Monthly office limit in USD; null = no limit. */
  monthlyUsd: number | null;
  /** Optional per-firm monthly limits in USD (firm id → limit). */
  firms: Record<string, number>;
  /** Max pages of one PDF sent to AI in one read (a longer document is refused with a message). */
  maxPages: number;
  /** Opus (the most expensive model) only on an explicit „🔍 Детално читање“; otherwise Sonnet. */
  opusOnlyDeep: boolean;
  /** Last level notified to the owner this month (80 / 100), written by the worker when it is crossed. */
  alert: { month: string; level: 80 | 100; at: string; spent: number; limit: number; firmId: string | null } | null;
}

export const AI_BUDGET_DEFAULT_USD = 50;
export const AI_MAX_PAGES_DEFAULT = 30;
export const AI_BUDGET_KEY = 'aiBudget';

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** Stored value → settings (defaults: 50 USD, 30 pages, Opus only on the detailed read). */
export function aiBudgetClean(v: unknown): AiBudgetCfg {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const firms: Record<string, number> = {};
  if (o.firms && typeof o.firms === 'object') {
    for (const [k, x] of Object.entries(o.firms as Record<string, unknown>)) { const n = num(x); if (n != null && /^[0-9a-f-]{36}$/i.test(k)) firms[k] = n; }
  }
  const pages = num(o.maxPages);
  const a = o.alert as AiBudgetCfg['alert'];
  return {
    monthlyUsd: 'monthlyUsd' in o ? (o.monthlyUsd === null ? null : num(o.monthlyUsd) ?? AI_BUDGET_DEFAULT_USD) : AI_BUDGET_DEFAULT_USD,
    firms,
    maxPages: pages && pages >= 1 ? Math.min(500, Math.floor(pages)) : AI_MAX_PAGES_DEFAULT,
    opusOnlyDeep: o.opusOnlyDeep !== false,
    alert: a && typeof a === 'object' && typeof a.month === 'string' && (a.level === 80 || a.level === 100) ? a : null,
  };
}

/** 0 below 80 %, 80 from 80 %, 100 from the limit on. No limit → 0. */
export function budgetLevel(spent: number, limit: number | null | undefined): 0 | 80 | 100 {
  if (limit == null) return 0;
  if (limit <= 0) return 100;
  if (spent >= limit - 1e-9) return 100;
  if (spent >= limit * 0.8 - 1e-9) return 80;
  return 0;
}

export const pct = (spent: number, limit: number | null | undefined): number | null => (limit == null ? null : limit <= 0 ? 100 : Math.round((spent / limit) * 1000) / 10);

const usd = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2);

export interface BudgetState {
  month: string;
  limit: number | null; spent: number; level: 0 | 80 | 100;
  firmId: string | null; firmLimit: number | null; firmSpent: number; firmLevel: 0 | 80 | 100;
  /** AI is paused (office or firm limit reached); the free readers keep working. */
  paused: boolean;
  /** Clear message when paused / near the limit; empty otherwise. */
  msg: string;
}

export function budgetState(cfg: Pick<AiBudgetCfg, 'monthlyUsd' | 'firms'>, month: string, spent: number, firmId: string | null, firmSpent: number): BudgetState {
  const limit = cfg.monthlyUsd;
  const firmLimit = firmId ? cfg.firms[firmId] ?? null : null;
  const level = budgetLevel(spent, limit), firmLevel = budgetLevel(firmSpent, firmLimit);
  const paused = level === 100 || firmLevel === 100;
  const msg = level === 100
    ? `Месечниот лимит за AI (${usd(limit!)}) е достигнат – потрошено ${usd(spent)} во ${month}. AI-читањето е паузирано до крајот на месецот; Excel/CSV/XML и PDF со текст се читаат и понатаму без AI. Сопственикот може да го зголеми лимитот во Систем › 💲 AI трошок.`
    : firmLevel === 100
      ? `Лимитот за AI за оваа фирма (${usd(firmLimit!)}) е достигнат – потрошено ${usd(firmSpent)} во ${month}. AI-читањето за фирмата е паузирано; Excel/CSV/XML и PDF со текст се читаат и понатаму без AI. Сопственикот може да го зголеми лимитот во Систем › 💲 AI трошок.`
      : level === 80
        ? `Потрошени се ${pct(spent, limit)}% од месечниот лимит за AI (${usd(spent)} од ${usd(limit!)}).`
        : firmLevel === 80 ? `Фирмата потроши ${pct(firmSpent, firmLimit)}% од својот лимит за AI (${usd(firmSpent)} од ${usd(firmLimit!)}).` : '';
  return { month, limit, spent, level, firmId, firmLimit, firmSpent, firmLevel, paused, msg };
}

/** Days in a `YYYY-MM` month. */
export const monthDays = (m: string): number => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();

/** Linear projection of the month's spend from the days elapsed (`today` = `YYYY-MM-DD`); past months → the actual spend. */
export function monthProjection(spent: number, month: string, today: string): number {
  const cur = today.slice(0, 7);
  if (month < cur) return spent;
  if (month > cur) return 0;
  const d = Math.max(1, +today.slice(8, 10));
  return Math.round((spent / d) * monthDays(month) * 100) / 100;
}

/** UTC instant of 00:00 Europe/Skopje on the first of the month (DST-aware without a tz library). */
export function skopjeMonthStart(month: string): Date {
  const g = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, 1, 0, 0, 0));
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Skopje', hour: '2-digit', hourCycle: 'h23' }).format(g);
  // Skopje is UTC+1 / UTC+2: midnight UTC is 01:00 or 02:00 there
  return new Date(g.getTime() - h * 3600_000);
}

/** `ai_usage.purpose` → document kind (`purchase:split` → `purchase`). */
export const kindOfPurpose = (p: string): string => p.split(':')[0] || p;

export const KIND_LABEL: Record<string, string> = {
  purchase: 'Влезни фактури', sale: 'Излезни фактури', bank: 'Банкарски изводи', ob: 'Бруто биланс / почетна', kontrola: 'Записници од контрола',
  blg: 'Сметки (каса)', emp: 'Документи за вработени', fisk: 'Фискални извештаи', classify: 'Класификација (сандаче)', bom: 'Норматив (BOM)',
  cmp: 'Споредба на модели', imp: 'Увозни документи', scr: 'Поврати / одобренија', rec: 'Картица (усогласување)', bankcls: 'Книжење на изводи',
  vreg: 'Сообраќајни дозволи', rcdoc: 'Лични документи', rclic: 'Возачки дозволи', tk: 'Тековна состојба (ЦРМ)', zm: 'Завршни сметки',
  mpin: 'МПИН', law: 'Робот за закони', firmResh: 'Решение за фирма', ask: 'Прашања',
};

export interface UsageAggRow { firmId: string | null; purpose: string; model: string; calls: number; docs: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }
export interface DocAggRow { firmId: string; kind: string; total: number; free: number; ai: number; cached: number; failed: number }

export interface CostLine { key: string; label: string; reads: number; free: number; ai: number; cached: number; calls: number; tokensIn: number; tokensOut: number; costUsd: number; avgPerDoc: number | null }
export interface CostReport {
  month: string; total: CostLine; projection: number;
  byFirm: CostLine[]; byKind: CostLine[]; byModel: CostLine[];
}

const blank = (key: string, label: string): CostLine => ({ key, label, reads: 0, free: 0, ai: 0, cached: 0, calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgPerDoc: null });
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Aggregate the month: reads (free / AI / reused from the cache) from `ai_documents`, calls / tokens / USD from
 * `ai_usage`. Average cost per document = USD ÷ documents read with AI (null when none).
 */
export function costReport(month: string, today: string, usage: readonly UsageAggRow[], docs: readonly DocAggRow[], firmName: (id: string | null) => string): CostReport {
  const total = blank('total', 'Вкупно');
  const F = new Map<string, CostLine>(), K = new Map<string, CostLine>(), M = new Map<string, CostLine>();
  const get = (m: Map<string, CostLine>, key: string, label: string) => { let x = m.get(key); if (!x) m.set(key, (x = blank(key, label))); return x; };
  for (const d of docs) {
    for (const x of [total, get(F, d.firmId, firmName(d.firmId)), get(K, d.kind, KIND_LABEL[d.kind] ?? d.kind)]) {
      x.reads += d.total; x.free += d.free; x.ai += d.ai; x.cached += d.cached;
    }
  }
  for (const u of usage) {
    const k = kindOfPurpose(u.purpose);
    const fk = u.firmId ?? '-';
    for (const x of [total, get(F, fk, u.firmId ? firmName(u.firmId) : 'Канцеларија (без фирма)'), get(K, k, KIND_LABEL[k] ?? k), get(M, u.model, u.model)]) {
      x.calls += u.calls; x.tokensIn += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens; x.tokensOut += u.outputTokens; x.costUsd = r6(x.costUsd + u.costUsd);
    }
    // a model line counts the documents it read (distinct ref ids per group)
    get(M, u.model, u.model).ai += u.docs;
  }
  // AI calls without an `ai_documents` row (МПИН, law robot, …): their documents are the distinct ref ids
  for (const u of usage) {
    const k = kindOfPurpose(u.purpose);
    if (docs.some((d) => d.kind === k)) continue;
    for (const x of [total, get(K, k, KIND_LABEL[k] ?? k)]) { x.ai += u.docs; x.reads += u.docs; }
  }
  const fin = (x: CostLine) => { x.avgPerDoc = x.ai ? r6(x.costUsd / x.ai) : null; return x; };
  const sort = (m: Map<string, CostLine>) => [...m.values()].map(fin).sort((a, b) => b.costUsd - a.costUsd || b.reads - a.reads || a.label.localeCompare(b.label));
  fin(total);
  return { month, total, projection: monthProjection(total.costUsd, month, today), byFirm: sort(F), byKind: sort(K), byModel: sort(M) };
}
