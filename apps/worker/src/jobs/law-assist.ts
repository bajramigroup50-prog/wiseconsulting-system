/**
 * ⚖ Правен асистент (AI) — one saved case (`law_cases`), job `law.case`.
 *
 *  1. retrieval (free): the articles of the stored law texts for the question (exact „чл. N“ references + full-text),
 *     in the version that applies on the case date / period end; the robot's law changes about the same laws;
 *  2. free comparisons: law ↔ law (best matching articles side by side), version ↔ version (word diff of the article
 *     with the version dates and which applies), our treatment ↔ the law (tax-review rules + the period's facts);
 *  3. the model (`askText`, Sonnet; Opus only with „🔍 Детално“), for a question always, for a comparison only when
 *     asked („🤖 AI заклучок“): JSON answer → `guardCitations` — a citation of an article that is not in the store is
 *     removed and listed as „треба да се провери“, a quote not found in the stored text is replaced by the stored text;
 *  4. model and cost (sum of the case's `ai_usage` rows) stored on the case.
 * Without AI (no key, monthly limit reached) the free parts are still saved with the reason.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  diffTable, guardCitations, LAW_BY_KEY, lawAnswerShape, lawAssistPrompt, lawDiff, lawLang, lawsInText, lawVsLawTable, parseJsonLoose, treatmentTable, versionAt,
  type CtxArticle, type LawCaseKind, type LawChangeCtx, type LawFacts, type LawTable,
} from '@wise/core/law';
import { todaySkopje } from '@wise/core/office';
import { aiUsage, firms, getLawArticle, lawArticleVersions, lawCases, lawChanges, lawFirmFacts, searchLawArticles, type LawHit, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { aiConfigured } from '../ai/client';

export interface LawCaseParams { laws?: string[]; law?: string; art?: string; v1?: string; v2?: string; date?: string; deep?: boolean; ai?: boolean }

const compact = (a: LawHit) => ({ id: a.id, textId: a.textId, law: a.law, no: a.no, heading: a.heading, body: a.body.slice(0, 6000), asOf: a.asOf, effectiveFrom: a.effectiveFrom, sourceUrl: a.sourceUrl, title: a.title, via: a.via });

async function relatedChanges(db: Tx, laws: readonly string[]): Promise<LawChangeCtx[]> {
  if (!laws.length) return [];
  const L = await db.select().from(lawChanges).orderBy(desc(lawChanges.date), desc(lawChanges.createdAt)).limit(150);
  return L.filter((x) => laws.some((k) => { const e = LAW_BY_KEY[k]; return !!e && (e.kw.test(`${x.title} ${x.what ?? ''}`) || `${x.title} ${x.what ?? ''}`.includes(e.abbr)); }))
    .slice(0, 10).map((x) => ({ title: x.title, what: x.what, from: x.from, to: x.to, date: x.date, urls: x.urls }));
}

export async function runLawCase(db: Tx, id: string, today = todaySkopje()): Promise<void> {
  const [c] = await db.select().from(lawCases).where(eq(lawCases.id, id)).limit(1);
  if (!c || c.status !== 'queued') return;
  const p = (c.params ?? {}) as LawCaseParams;
  const kind = c.kind as LawCaseKind;
  const date = p.date ?? c.periodTo ?? today;
  const result: Record<string, unknown> = { date };
  try {
    const firm = c.firmId ? (await db.select().from(firms).where(eq(firms.id, c.firmId)).limit(1))[0] ?? null : null;
    const qLaws = p.laws?.length ? p.laws : lawsInText(c.question);
    let arts: LawHit[] = [];
    let facts: LawFacts | null = null;
    let table: LawTable | null = null;
    let extra = '';

    if (firm && c.periodFrom && c.periodTo && (kind === 'treat' || kind === 'ask')) {
      facts = await lawFirmFacts(db, firm, c.periodFrom, c.periodTo, today);
      result.facts = facts;
    }
    if (kind === 'ask' || kind === 'treat') {
      arts = await searchLawArticles(db, c.question, { laws: qLaws.length ? qLaws : null, date, limit: p.deep ? 20 : 12 });
      if (!arts.length && qLaws.length) arts = await searchLawArticles(db, c.question, { date, limit: p.deep ? 20 : 12 });
      if (kind === 'treat') {
        if (!facts) throw new Error('Изберете фирма и период за споредба на третманот.');
        table = treatmentTable(facts);
      }
    } else if (kind === 'law') {
      const [A, B] = p.laws ?? [];
      if (!A || !B) throw new Error('Изберете два прописа.');
      const [a, b] = await Promise.all([A, B].map((l) => searchLawArticles(db, c.question, { laws: [l], date, limit: 6 })));
      arts = [...a!, ...b!];
      table = lawVsLawTable({ law: A, arts: a! }, { law: B, arts: b! });
      result.missing = [A, B].filter((_, i) => ![a, b][i]!.length);
    } else if (kind === 'ver') {
      if (!p.law || !p.art) throw new Error('Изберете закон и член.');
      const V = await lawArticleVersions(db, p.law, p.art);
      if (!V.length) throw new Error(`${LAW_BY_KEY[p.law]?.abbr ?? p.law} чл. ${p.art} го нема во базата.`);
      const x = (p.v1 && V.find((v) => v.textId === p.v1)) || V[V.length - 2] || V[0]!;
      const y = (p.v2 && V.find((v) => v.textId === p.v2)) || V[V.length - 1]!;
      const D = lawDiff(x.body, y.body);
      const applies = versionAt(V.map((v) => ({ id: v.textId, asOf: v.asOf, effectiveFrom: v.effectiveFrom ?? null })), date);
      result.diff = D;
      result.versions = [x, y].map((v) => ({ textId: v.textId, title: v.title, asOf: v.asOf, effectiveFrom: v.effectiveFrom, sourceUrl: v.sourceUrl }));
      result.applies = applies?.id ?? null;
      result.single = V.length < 2;
      table = diffTable(D);
      arts = x.textId === y.textId ? [x] : [x, y];
      extra = `ВЕРЗИИ: А) ${x.asOf ?? '?'}${x.effectiveFrom ? ' (важи од ' + x.effectiveFrom + ')' : ''}; Б) ${y.asOf ?? '?'}${y.effectiveFrom ? ' (важи од ' + y.effectiveFrom + ')' : ''}. За датумот ${date} се применува: ${applies ? (applies.id === x.textId ? 'А' : applies.id === y.textId ? 'Б' : 'друга верзија') : 'нема зачувана верзија за тој датум'}.\nИЗМЕНА (избришано → додадено):\n${table.rows.map((r) => `- „${r[0]}“ → „${r[1]}“`).join('\n') || '(нема разлика во текстот)'}`;
    }
    result.articles = arts.map(compact);
    if (table) result.table = table;
    const laws = [...new Set([...qLaws, ...arts.map((a) => a.law), ...(p.law ? [p.law] : [])])];
    const changes = await relatedChanges(db, laws);
    if (changes.length) result.changes = changes;

    // the model: always for a question, on request for the comparisons
    const wantAi = kind === 'ask' || p.ai === true;
    let model: string | null = null;
    if (wantAi) {
      if (!aiConfigured()) result.aiError = 'AI не е достапен (на серверот не е поставен ANTHROPIC_API_KEY) – прикажани се само пронајдените членови и бесплатните споредби.';
      else {
        try {
          const ctx: CtxArticle[] = arts;
          const prompt = lawAssistPrompt({ kind, question: c.question, today, articles: ctx, facts, changes, laws: p.laws, extra: extra || undefined, maxArticleChars: p.deep ? 5000 : 2500 });
          const r = await askText({ db, prompt, tier: p.deep ? 'complex' : 'default', deep: !!p.deep, purpose: 'lawAssist', refId: id, userId: c.userId, firmId: c.firmId, maxTokens: p.deep ? 8000 : 4000 });
          model = r.model;
          const shaped = lawAnswerShape(parseJsonLoose(r.text), r.text, lawLang(c.question));
          // every article the answer names, looked up in the store (any law the answer or the context uses)
          const M = new Map<string, CtxArticle>(arts.map((a) => [`${a.law}|${a.no}`, a]));
          const want = new Set<string>();
          for (const x of shaped.reasoning.flatMap((r0) => r0.cites)) want.add(`${x.law}|${x.art}`);
          const prose = [shaped.short, shaped.conclusion, ...shaped.reasoning.map((r0) => r0.text), ...shaped.exceptions].join('\n');
          const allLaws = new Set([...laws, ...shaped.reasoning.flatMap((r0) => r0.cites.map((x) => x.law))]);
          for (const m of prose.matchAll(/(?:чл(?:ен)?\.?|neni)\s*(\d{1,4}(?:-[а-шa-z])?)/gi)) for (const l of allLaws) want.add(`${l}|${m[1]!.toLowerCase()}`);
          for (const k of want) {
            if (M.has(k)) continue;
            const [l, n] = k.split('|') as [string, string];
            if (!LAW_BY_KEY[l]) continue;
            const a = await getLawArticle(db, l, n, date) ?? await getLawArticle(db, l, n);
            if (a) M.set(k, a);
          }
          const known = (law: string, art: string) => (law === '*' ? [...M.values()].find((a) => a.no === art) ?? null : M.get(`${law}|${art}`) ?? null);
          const g = guardCitations(shaped, known);
          result.ai = g.answer;
          result.guard = { removed: g.removed, fixed: g.fixed, stray: g.stray };
        } catch (e) {
          result.aiError = (e as Error).message || String(e);
        }
      }
    }
    const [u] = await db.select({ s: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` }).from(aiUsage).where(and(eq(aiUsage.refId, id), eq(aiUsage.purpose, 'lawAssist')));
    const noFree = kind === 'ask' && !result.ai && !arts.length;
    await db.update(lawCases).set({
      status: noFree && result.aiError ? 'error' : 'done', result, model, costUsd: String(u?.s ?? '0'), error: (result.aiError as string | undefined) ?? null,
    }).where(eq(lawCases.id, id));
  } catch (e) {
    await db.update(lawCases).set({ status: 'error', result, error: (e as Error).message || String(e) }).where(eq(lawCases.id, id));
  }
}

export const lawCase = defineJob<{ id: string }>({
  name: 'law.case',
  async run(data, { db }) {
    if (data?.id) await runLawCase(db, data.id);
  },
});
