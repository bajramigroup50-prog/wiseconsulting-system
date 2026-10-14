/**
 * ⚖ Правен асистент — the stored law corpus (shared helper: the law assistant, the robot's text sync and other
 * modules such as „Контроли и решенија“ reuse it).
 *
 *  - `storeLawText`      segment a consolidated text into articles and store it as a new version (skipped when the
 *                        same text is already stored);
 *  - `searchLawArticles` full-text search (Postgres `simple` index over the lower-cased text, prefix terms, ranked),
 *                        plus exact „чл. N“ references from the question, in the version that applies on a date;
 *  - `getLawArticle` / `lawArticleVersions` / `lawVersions` / `lawCorpusStatus`;
 *  - `lawFirmFacts`      the firm's summary facts for a period (totals and the largest documents — no line detail).
 *
 * Free: no model call anywhere.
 */
import { and, asc, between, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  articleRefs, LAW_CORPUS, lawSearchNorm, lawTerms, lawTextHash, lawTsQuery, segmentArticles, versionAt, versionFrom, type CtxArticle, type LawFacts,
} from '@wise/core/law';
import type { Tx } from './audit';
import { loadLedgerLines } from './ledger-queries';
import { lawReview } from './lawrep';
import { invoiceLines, invoices, lawArticles, lawTexts, payrollRuns, purchases, type Firm, type LawTextRow } from './schema/index';

export interface LawHit extends CtxArticle {
  textId: string;
  title: string;
  rank: number;
  /** How it was found: exact article reference or text search. */
  via: 'ref' | 'fts';
}

export type LawVersion = Pick<LawTextRow, 'id' | 'law' | 'title' | 'asOf' | 'effectiveFrom' | 'sourceUrl' | 'fetchedAt' | 'articles' | 'source' | 'gazette'>;

const vcols = { id: lawTexts.id, law: lawTexts.law, title: lawTexts.title, asOf: lawTexts.asOf, effectiveFrom: lawTexts.effectiveFrom, sourceUrl: lawTexts.sourceUrl, fetchedAt: lawTexts.fetchedAt, articles: lawTexts.articles, source: lawTexts.source, gazette: lawTexts.gazette };

/** Stored versions of a law, oldest first. */
export async function lawVersions(db: Tx, law: string): Promise<LawVersion[]> {
  const V = await db.select(vcols).from(lawTexts).where(eq(lawTexts.law, law));
  return V.sort((a, b) => vKey(a).localeCompare(vKey(b)));
}
const vKey = (v: LawVersion) => versionFrom({ ...v, fetchedAt: v.fetchedAt.toISOString() }) + v.fetchedAt.toISOString();
const vLite = (v: LawVersion) => ({ ...v, fetchedAt: v.fetchedAt.toISOString() });

/** The version of each law that applies on `date` (no date → the newest). */
export async function lawTextsAt(db: Tx, laws: readonly string[] | null, date?: string | null): Promise<Map<string, LawVersion>> {
  const V = await db.select(vcols).from(lawTexts).where(laws?.length ? inArray(lawTexts.law, [...laws]) : sql`true`);
  const by = new Map<string, LawVersion[]>();
  for (const v of V) (by.get(v.law) ?? by.set(v.law, []).get(v.law)!).push(v);
  const out = new Map<string, LawVersion>();
  for (const [law, L] of by) {
    L.sort((a, b) => vKey(a).localeCompare(vKey(b)));
    const pick = date ? versionAt(L.map(vLite), date) : null;
    const v = pick ? L.find((x) => x.id === pick.id)! : date ? null : L[L.length - 1]!;
    if (v) out.set(law, v);
  }
  return out;
}

export interface StoreLawTextIn {
  law: string; title: string; text: string; sourceUrl?: string | null; asOf?: string | null; effectiveFrom?: string | null;
  gazette?: string[]; source?: 'robot' | 'link' | 'manual'; userId?: string | null; fetchedAt?: Date;
}

/** Store a consolidated text as a new version. `{ isNew: false }` when the same text is already stored for the law. */
export async function storeLawText(db: Tx, x: StoreLawTextIn): Promise<{ id: string; articles: number; isNew: boolean }> {
  const A = segmentArticles(x.text);
  if (!A.length) throw new Error('Во текстот не се најдени членови („Член 1“, „Член 2“, …).');
  const hash = lawTextHash(x.text);
  const [old] = await db.select({ id: lawTexts.id, articles: lawTexts.articles }).from(lawTexts).where(and(eq(lawTexts.law, x.law), eq(lawTexts.hash, hash))).limit(1);
  if (old) return { id: old.id, articles: old.articles, isNew: false };
  const [t] = await db.insert(lawTexts).values({
    law: x.law, title: x.title.slice(0, 500), asOf: x.asOf ?? null, effectiveFrom: x.effectiveFrom ?? null, gazette: x.gazette ?? [], sourceUrl: x.sourceUrl ?? null,
    fetchedAt: x.fetchedAt ?? new Date(), hash, articles: A.length, source: x.source ?? 'robot', createdBy: x.userId ?? null,
  }).returning({ id: lawTexts.id });
  for (let i = 0; i < A.length; i += 200) {
    await db.insert(lawArticles).values(A.slice(i, i + 200).map((a) => ({
      textId: t!.id, law: x.law, no: a.no, num: a.num, ord: a.ord, heading: a.heading, body: a.body, norm: lawSearchNorm(`${a.heading ?? ''} ${a.body}`),
    })));
  }
  return { id: t!.id, articles: A.length, isNew: true };
}

type ArtRow = { id: string; textId: string; law: string; no: string; heading: string | null; body: string };
const hit = (a: ArtRow, v: LawVersion, rank: number, via: LawHit['via']): LawHit => ({
  id: a.id, textId: a.textId, law: a.law, no: a.no, heading: a.heading, body: a.body, asOf: v.asOf, effectiveFrom: v.effectiveFrom, sourceUrl: v.sourceUrl, title: v.title, rank, via,
});
const acols = { id: lawArticles.id, textId: lawArticles.textId, law: lawArticles.law, no: lawArticles.no, heading: lawArticles.heading, body: lawArticles.body };

export interface LawSearchOpts {
  /** Restrict to these laws (`LAW_CORPUS` keys). */
  laws?: readonly string[] | null;
  /** Version that applies on this date (default: the newest stored version). */
  date?: string | null;
  limit?: number;
}

/**
 * Articles for a question: exact references first („чл. 14 ЗДДВ“ / „член 14“ in the selected laws), then the
 * full-text matches ranked by how many terms they contain. Only the version applicable on `date` is searched.
 */
export async function searchLawArticles(db: Tx, q: string, o: LawSearchOpts = {}): Promise<LawHit[]> {
  const limit = o.limit ?? 12;
  const V = await lawTextsAt(db, o.laws ?? null, o.date);
  if (!V.size) return [];
  const byText = new Map([...V.values()].map((v) => [v.id, v]));
  const ids = [...byText.keys()];
  const out: LawHit[] = [];
  const seen = new Set<string>();
  for (const r of articleRefs(q)) {
    const tids = r.law ? ids.filter((id) => byText.get(id)!.law === r.law) : ids;
    if (!tids.length) continue;
    const R = await db.select(acols).from(lawArticles).where(and(inArray(lawArticles.textId, tids), eq(lawArticles.no, r.art)));
    for (const a of R) if (!seen.has(a.id)) { seen.add(a.id); out.push(hit(a, byText.get(a.textId)!, 1000, 'ref')); }
  }
  const tq = lawTsQuery(lawTerms(q));
  if (tq && out.length < limit) {
    const rank = sql<number>`ts_rank(to_tsvector('simple', ${lawArticles.norm}), to_tsquery('simple', ${tq}))`;
    const R = await db.select({ ...acols, rank }).from(lawArticles)
      .where(and(inArray(lawArticles.textId, ids), sql`to_tsvector('simple', ${lawArticles.norm}) @@ to_tsquery('simple', ${tq})`))
      .orderBy(desc(rank), asc(lawArticles.ord)).limit(limit * 2);
    for (const a of R) if (!seen.has(a.id) && out.length < limit) { seen.add(a.id); out.push(hit(a, byText.get(a.textId)!, Number(a.rank), 'fts')); }
  }
  return out.slice(0, limit);
}

/** One article of a law (the version applicable on `date`, else the newest). */
export async function getLawArticle(db: Tx, law: string, no: string, date?: string | null): Promise<LawHit | null> {
  const v = (await lawTextsAt(db, [law], date)).get(law);
  if (!v) return null;
  const [a] = await db.select(acols).from(lawArticles).where(and(eq(lawArticles.textId, v.id), eq(lawArticles.no, no))).limit(1);
  return a ? hit(a, v, 1000, 'ref') : null;
}

/** The article in every stored version of its law (oldest first; versions without that article are skipped). */
export async function lawArticleVersions(db: Tx, law: string, no: string): Promise<LawHit[]> {
  const V = await lawVersions(db, law);
  if (!V.length) return [];
  const R = await db.select(acols).from(lawArticles).where(and(inArray(lawArticles.textId, V.map((v) => v.id)), eq(lawArticles.no, no)));
  return V.flatMap((v) => R.filter((a) => a.textId === v.id).map((a) => hit(a, v, 0, 'ref')));
}

/** Does the store hold this article in any version? `law = '*'` → in any law. */
export async function lawArticleExists(db: Tx, law: string, no: string): Promise<boolean> {
  const [x] = await db.select({ id: lawArticles.id }).from(lawArticles).where(law === '*' ? eq(lawArticles.no, no) : and(eq(lawArticles.law, law), eq(lawArticles.no, no))).limit(1);
  return !!x;
}

export interface LawCorpusRow { law: string; abbr: string; name: string; versions: number; latest: LawVersion | null; auto: boolean; home: string }

/** Every corpus law with its stored versions (for the „Корпус“ tab and the „corpus is thin“ notice). */
export async function lawCorpusStatus(db: Tx): Promise<LawCorpusRow[]> {
  const V = await db.select(vcols).from(lawTexts);
  return LAW_CORPUS.map((l) => {
    const L = V.filter((v) => v.law === l.k).sort((a, b) => vKey(a).localeCompare(vKey(b)));
    return { law: l.k, abbr: l.abbr, name: l.n, versions: L.length, latest: L[L.length - 1] ?? null, auto: l.src.length > 0, home: l.home };
  });
}

/* ---------------- the firm's facts ---------------- */

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Summary facts of a firm for [from, to]: sales by VAT rate and advances, purchases (cash / 32-а / no deduction /
 * import), payroll totals, cash-box payments, the 8 largest documents and the preliminary tax-review findings of the
 * year(s) in the period. Read-only.
 */
export async function lawFirmFacts(db: Tx, firm: Firm, from: string, to: string, today: string): Promise<LawFacts> {
  const st = (firm.settings ?? {}) as { kasaCash?: string; inspProf?: { kasaMax?: number }; kasaMax?: number };
  const [S, SL, P, PR, L] = await Promise.all([
    db.select({ id: invoices.id, number: invoices.number, date: invoices.date, base: invoices.base, vat: invoices.vat, total: invoices.total, advance: invoices.advance, kind: invoices.kind })
      .from(invoices).where(and(eq(invoices.firmId, firm.id), between(invoices.date, from, to), eq(invoices.status, 'posted'))),
    db.select({ rate: invoiceLines.rate, base: sql<string>`sum(${invoiceLines.qty} * ${invoiceLines.price} * (1 - ${invoiceLines.disc} / 100))` })
      .from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(eq(invoices.firmId, firm.id), between(invoices.date, from, to), eq(invoices.status, 'posted'))).groupBy(invoiceLines.rate),
    db.select({ number: purchases.number, date: purchases.date, base: purchases.base, vat: purchases.vat, total: purchases.total, cash: purchases.cash, art32: purchases.art32, noDed: purchases.noDed, imp: purchases.imp })
      .from(purchases).where(and(eq(purchases.firmId, firm.id), between(purchases.date, from, to))),
    db.select({ month: payrollRuns.month, totals: payrollRuns.totals }).from(payrollRuns)
      .where(and(eq(payrollRuns.firmId, firm.id), eq(payrollRuns.status, 'posted'), between(payrollRuns.date, from, to))),
    loadLedgerLines(db, firm.id, from, to),
  ]);
  const sum = <T>(L: readonly T[], f: (x: T) => unknown) => r2(L.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const adv = S.filter((x) => x.advance);
  const kasa = st.kasaCash ?? '1020';
  const max = Number(st.inspProf?.kasaMax ?? st.kasaMax ?? 0) || 0;
  const cashOut = L.filter((l) => l.kind !== 'close' && l.kind !== 'open' && l.account === kasa && l.credit > 0);
  const docs = [
    ...S.map((x) => ({ kind: 'Излезна фактура', no: x.number, date: x.date, total: Number(x.total) })),
    ...P.map((x) => ({ kind: 'Влезна фактура', no: x.number, date: x.date, total: Number(x.total) })),
  ].sort((a, b) => b.total - a.total).slice(0, 8);
  const facts: LawFacts = {
    firm: { name: firm.name, edb: firm.edb, vat: firm.vatRegistered, vatPeriod: firm.vatPeriod },
    period: { from, to },
    sales: {
      count: S.length, base: sum(S, (x) => x.base), vat: sum(S, (x) => x.vat),
      byRate: Object.fromEntries(SL.filter((r) => Math.abs(Number(r.base)) > 0.004).map((r) => [String(r.rate), r2(Number(r.base))])),
      advances: { count: adv.length, base: sum(adv, (x) => x.base), vat: sum(adv, (x) => x.vat) },
    },
    purchases: {
      count: P.length, base: sum(P, (x) => x.base), vat: sum(P, (x) => x.vat),
      cash: { count: P.filter((x) => x.cash).length, total: sum(P.filter((x) => x.cash), (x) => x.total) },
      art32: P.filter((x) => x.art32).length, noDed: P.filter((x) => x.noDed).length, imp: P.filter((x) => x.imp).length,
    },
    payroll: PR.length ? {
      months: PR.length, gross: sum(PR, (x) => x.totals.gross), net: sum(PR, (x) => x.totals.net), contr: sum(PR, (x) => x.totals.contr),
      tax: sum(PR, (x) => x.totals.tax), emps: Math.max(0, ...PR.map((x) => Number(x.totals.emps) || 0)),
    } : undefined,
    cashOut: { count: cashOut.length, total: sum(cashOut, (l) => l.credit), over: max ? cashOut.filter((l) => l.credit > max).length : 0 },
    docs,
  };
  const review: NonNullable<LawFacts['review']> = [];
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    try {
      const X = await lawReview(db, firm, y, today);
      for (const f of X.R) if (f.s !== 'ok') review.push({ law: f.r.law === 'zdld' ? 'zpdd' : f.r.law, art: f.r.art, t: f.r.t, s: f.s, txt: `${y}: ${f.txt}` });
    } catch { /* the review needs a complete ledger; facts stay without it */ }
  }
  if (review.length) facts.review = review.slice(0, 30);
  return facts;
}
