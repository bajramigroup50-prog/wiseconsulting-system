/**
 * UX Phase 3 — „Преглед за книжење“ (P2/P28) and the automatic payment ↔ invoice links (P3/P29).
 *
 * - {@link bookingReview}: ONE review of every unbooked statement line of the firm, across statements and years: the
 *   pass `reviewMatch` (reference / purpose → document, the existing `autoMatch`, FIFO over the partner's open
 *   documents) and, for what is left, the payment-code / text heuristic `suggestByCode` (own transfer, turnover,
 *   cash, POS, fee, public revenue, partner). Every line gets a confidence („сигурно“ / „веројатно“ / „рачно“) and
 *   a reason. Lines in a locked period / locked nalog are listed apart and never proposed. Nothing is written.
 * - {@link confirmReview}: „✓ Прокнижи ги сигурните“ / „✓ Прокнижи ги избраните“ — the review is RECOMPUTED here (the
 *   client only sends line ids) and the chosen lines are booked through the existing `bookStatementLines` (each
 *   statement re-posted once). Audited `bankReviewBook`.
 * - {@link proposeLinks}: after an import (and on „↻ Предложи врски“) the payments that match open documents get a
 *   PROPOSED link, stored on the line (`bank_lines.data.link`); {@link acceptLinks} / {@link rejectLinks} are the bulk
 *   „Поврзување“ actions. An accepted link is re-allocated against the CURRENT open amounts (capped, FIFO in the
 *   proposal's order), so document payments (`documentPayments`, read from the bank lines) and the open items stay
 *   exactly consistent.
 * - {@link afterImport}: proposals for the imported lines and, ONLY when the owner switched the step on
 *   (`firms.settings.autoSteps`, all off by default), the „сигурно“ links / lines are confirmed automatically.
 *
 * AI never runs here: {@link reviewAiStep} only says how many lines are left for the explicit „🤖 Предложи со AI“
 * button, what it would cost and whether the budget guard paused AI. AI never proposes amounts.
 */
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  autoSteps, BKPK_RE, isFxAccount, linkPayment, linkPaymentFx, openDocsFor, reviewConfidence, reviewMatch, reviewWhy,
  type BankRow, type DocType, type ReviewChange, type ReviewConf,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { aiBudgetStatus } from '../ai-budget';
import { aiUsage, bankLines, bankStatements, firms, type BankLine } from '../schema/index';
import { BankError, den, loadBankEnv, type BankEnv } from './context';
import { statementLockTest } from './konta-all';
import { matchContext } from './match';
import { postStatements } from './posting';
import { bookingPatch, toBankRow } from './rows';
import { AUTO_WHY, bookStatementLines, flagMissing, lineUnbooked, suggestByCode, type LineSuggestion } from './suggest';

const nf = (c: number) => {
  const s = (Math.abs(c) / 100).toFixed(2).split('.');
  return (c < 0 ? '-' : '') + s[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
};

export interface ReviewItem {
  lineId: string;
  statementId: string;
  statementNo: string | null;
  statementDate: string;
  /** Bank account name. */
  account: string;
  /** Foreign-currency account (opened in Девизни изводи). */
  fx: boolean;
  lineNo: number;
  date: string;
  /** Denars, signed (+ inflow). */
  amount: number;
  name: string;
  desc: string;
  /** Proposed counter konto ('' = none). */
  konto: string;
  partnerId?: string;
  newPartner?: string;
  /** Documents the payment closes (denars). */
  refs?: { label: string; amt: number }[];
  /** Unallocated part (denars) — an advance. */
  excess?: number;
  how: string;
  why: string;
  conf: ReviewConf;
  missing?: boolean;
  /** Locked period / nalog: never booked here. */
  locked?: string;
}

export interface BookingReview {
  items: ReviewItem[];
  counts: Record<ReviewConf, number>;
  /** Lines in a locked period / nalog (listed, not proposed). */
  locked: number;
  /** Lines nothing resolved — the only ones the AI step may read. */
  aiLines: string[];
}

interface Computed extends BookingReview { sugg: Map<string, LineSuggestion>; rows: Map<string, BankRow> }

const yearOf = (d: string) => Number(d.slice(0, 4));

async function computeReview(tx: Tx, firmId: string, o: { statementIds?: readonly string[]; env?: BankEnv } = {}): Promise<Computed> {
  const env = o.env ?? (await loadBankEnv(tx, firmId));
  const out: Computed = { items: [], counts: { sure: 0, likely: 0, manual: 0 }, locked: 0, aiLines: [], sugg: new Map(), rows: new Map() };
  if (o.statementIds && !o.statementIds.length) return out;
  const L = (await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), o.statementIds ? inArray(bankLines.statementId, [...o.statementIds]) : undefined))
    .orderBy(asc(bankLines.date), asc(bankLines.lineNo))).filter(lineUnbooked).filter((l) => Number(l.amount) || Number(l.amountCur ?? 0));
  if (!L.length) return out;
  const S = await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, firmId), inArray(bankStatements.id, [...new Set(L.map((l) => l.statementId))])));
  const stById = new Map(S.map((s) => [s.id, s]));
  const accName = new Map(env.accountRows.map((a) => [a.id, a.name]));
  const lockOf = await statementLockTest(tx, firmId);
  const lockBy = new Map(S.map((s) => [s.id, lockOf(s)]));

  // 1) the pass per business year (each year's context: its lines + every linked line)
  const changes = new Map<string, ReviewChange>();
  for (const y of [...new Set(L.map((l) => yearOf(l.date)))]) {
    const ids = new Set(L.filter((l) => yearOf(l.date) === y && !lockBy.get(l.statementId)).map((l) => l.id));
    if (!ids.size) continue;
    const ctx = await matchContext(tx, env, y);
    for (const [id, c] of reviewMatch(ctx, ids)) changes.set(id, c);
  }
  // 2) suggestions: the pass wins; the payment-code / text heuristic covers the rest
  for (const l of L) {
    if (lockBy.get(l.statementId)) continue;
    const c = changes.get(l.id);
    if (c && c.row.konto) {
      out.rows.set(l.id, c.row);
      out.sugg.set(l.id, {
        konto: c.row.konto, ...(c.row.partner ? { partnerId: c.row.partner } : {}), ...(c.newPartner ? { newPartner: c.newPartner } : {}),
        why: reviewWhy(c, nf) || AUTO_WHY[c.how] || c.how, how: c.how, ...(c.row.ref ? { refLabel: c.row.ref.label } : {}),
      });
      continue;
    }
    const s = suggestByCode({ amount: Math.round(Number(l.amount) * 100), desc: l.description, name: l.name, purpose: l.purpose, osnov: l.osnov, counterAccount: l.counterAccount, acct: l.bankAccountId, date: l.date }, env);
    if (l.konto && BKPK_RE.test(l.konto) && s.konto !== l.konto) {
      out.sugg.set(l.id, { konto: l.konto, ...(l.newPartner ? { newPartner: l.newPartner } : {}), why: l.newPartner ? `нов комитент „${l.newPartner}“` : 'изберете комитент', how: 'partner' });
    } else out.sugg.set(l.id, s);
  }
  await flagMissing(tx, firmId, out.sugg.values());
  // 3) the items with their confidence
  for (const l of L) {
    const st = stById.get(l.statementId)!;
    const base = {
      lineId: l.id, statementId: l.statementId, statementNo: st.number, statementDate: st.date, account: accName.get(l.bankAccountId) ?? '', fx: isFxAccount(env.accounts, l.bankAccountId), lineNo: l.lineNo,
      date: l.date, amount: Number(l.amount), name: l.name ?? '', desc: l.description,
    };
    const lk = lockBy.get(l.statementId);
    if (lk) {
      out.items.push({ ...base, konto: '', how: '', why: lk, conf: 'manual', locked: lk });
      out.locked++;
      continue;
    }
    const s = out.sugg.get(l.id)!;
    const c = changes.get(l.id);
    const partner = s.partnerId ?? (c?.row.partner || undefined);
    const conf = reviewConfidence({
      how: s.how, konto: s.konto, missing: s.missing, newPartner: s.newPartner, partnerOk: c?.partnerOk, excess: c?.excess,
      needsPartner: !!s.konto && BKPK_RE.test(s.konto) && !partner && !s.newPartner,
    });
    out.items.push({
      ...base, konto: s.konto, ...(partner ? { partnerId: partner } : {}), ...(s.newPartner ? { newPartner: s.newPartner } : {}),
      ...(c?.refs?.length ? { refs: c.refs.map((r) => ({ label: r.label, amt: den(r.amt) })) } : {}), ...(c?.excess ? { excess: den(c.excess) } : {}),
      how: s.how, why: s.why, conf, ...(s.missing ? { missing: true } : {}),
    });
    out.counts[conf]++;
    if (conf === 'manual' && !s.konto) out.aiLines.push(l.id);
  }
  return out;
}

/** The review of all unbooked lines of the firm (optionally only some statements). Nothing is written. */
export async function bookingReview(tx: Tx, firmId: string, o: { statementIds?: readonly string[] } = {}): Promise<BookingReview> {
  const { sugg: _s, rows: _r, ...R } = await computeReview(tx, firmId, o);
  return R;
}

export interface ReviewBookResult { booked: number; skipped: { lineId: string; lineNo: number; why: string }[]; statements: number; numbers: string[] }

/**
 * Book lines of the review: `onlySure` = „✓ Прокнижи ги сигурните“, `lineIds` = „✓ Прокнижи ги избраните“ (never a
 * „рачно“ or locked line). Recomputed here; posted through `bookStatementLines` (each statement once).
 */
export async function confirmReview(tx: Tx, a: {
  firmId: string; userId: string | null; lineIds?: readonly string[]; onlySure?: boolean; statementIds?: readonly string[]; auto?: boolean;
}): Promise<ReviewBookResult> {
  const R = await computeReview(tx, a.firmId, { statementIds: a.statementIds });
  const want = a.lineIds ? new Set(a.lineIds) : null;
  const pick = R.items.filter((i) => !i.locked && i.conf !== 'manual' && (!a.onlySure || i.conf === 'sure') && (!want || want.has(i.lineId)));
  if (!pick.length) return { booked: 0, skipped: [], statements: 0, numbers: [] };
  const st = [...new Set(pick.map((i) => i.statementId))];
  const r = await bookStatementLines(tx, {
    firmId: a.firmId, userId: a.userId, statementIds: st, onlyLines: pick.map((i) => i.lineId), pre: { sugg: R.sugg, rows: R.rows },
    auditAction: 'bankReviewBook', auditData: { mode: a.onlySure ? 'sure' : 'selected', auto: !!a.auto, conf: Object.fromEntries((['sure', 'likely'] as const).map((c) => [c, pick.filter((i) => i.conf === c).length])) },
  });
  const numbers = [...new Set([...r.posted.values()].map((x) => x.number).filter((x): x is string => !!x))];
  return { booked: r.booked, skipped: r.skipped, statements: st.length, numbers };
}

/* ---------------- payment ↔ invoice links (P3/P29) ---------------- */

export interface LinkProposal {
  refs: { type: DocType; id: string; label: string; amt: number }[];
  partnerId?: string | null;
  how: string;
  conf: ReviewConf;
  why: string;
  /** Denars not allocated (advance). */
  excess?: number;
  at: string;
  rejected?: boolean;
  by?: string | null;
}

/** Line a link may be proposed for: no document yet, not split / POS / own / conversion, on no konto or a partner konto. */
const linkable = (l: BankLine) => !l.refId && !(l.split && l.split.length) && !l.pos && !l.own && !l.conv && !!Number(l.amount) && (!l.konto || BKPK_RE.test(l.konto));
const linkOf = (l: Pick<BankLine, 'data'>): LinkProposal | null => ((l.data ?? {}) as { link?: LinkProposal }).link ?? null;
const sameDocs = (a: LinkProposal, b: LinkProposal) => a.refs.map((r) => r.id).join() === b.refs.map((r) => r.id).join();

/**
 * Propose links for the given lines (or every linkable line of `year`) and store them on the lines. A rejected
 * proposal stays rejected while it names the same documents; a line that no longer matches loses its pending proposal.
 */
export async function proposeLinks(tx: Tx, a: { firmId: string; userId: string | null; lineIds?: readonly string[]; year?: number }): Promise<(LinkProposal & { lineId: string })[]> {
  const L = (await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId),
    a.lineIds ? (a.lineIds.length ? inArray(bankLines.id, [...a.lineIds]) : sql`false`) : sql`${bankLines.date} between ${a.year + '-01-01'} and ${a.year + '-12-31'}`)))
    .filter(linkable);
  if (!L.length) return [];
  const env = await loadBankEnv(tx, a.firmId);
  const lockOf = await statementLockTest(tx, a.firmId);
  const S = await tx.select({ id: bankStatements.id, date: bankStatements.date }).from(bankStatements).where(inArray(bankStatements.id, [...new Set(L.map((l) => l.statementId))]));
  const locked = new Set(S.filter((s) => lockOf(s)).map((s) => s.id));
  const at = new Date().toISOString();
  const out: (LinkProposal & { lineId: string })[] = [];
  for (const y of [...new Set(L.map((l) => yearOf(l.date)))]) {
    const ly = L.filter((l) => yearOf(l.date) === y && !locked.has(l.statementId));
    if (!ly.length) continue;
    const ctx = await matchContext(tx, env, y);
    const C = reviewMatch(ctx, new Set(ly.map((l) => l.id)));
    for (const l of ly) {
      const c = C.get(l.id);
      const old = linkOf(l);
      let next: LinkProposal | null = null;
      if (c?.row.ref && c.refs?.length) {
        next = {
          refs: c.refs.map((r) => ({ type: r.type, id: r.id, label: r.label, amt: den(r.amt) })), partnerId: c.row.partner ?? null, how: c.how,
          conf: reviewConfidence({ how: c.how, konto: c.row.konto ?? '', partnerOk: c.partnerOk, excess: c.excess, newPartner: c.newPartner }),
          why: reviewWhy(c, nf), ...(c.excess ? { excess: den(c.excess) } : {}), at,
        };
        if (old?.rejected && sameDocs(old, next)) continue;
      }
      if (!next && (!old || old.rejected)) continue;
      const data = { ...((l.data ?? {}) as Record<string, unknown>) };
      if (next) data.link = next;
      else delete data.link;
      await tx.update(bankLines).set({ data }).where(eq(bankLines.id, l.id));
      if (next) out.push({ ...next, lineId: l.id });
    }
  }
  if (out.length) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankLinkPropose', entityType: 'bank_lines', data: { n: out.length, sure: out.filter((p) => p.conf === 'sure').length } });
  return out;
}

export interface LinkRow {
  lineId: string; statementId: string; date: string; amount: number; name: string; desc: string; partnerId: string | null;
  /** Already booked on a customer / supplier konto (an advance without a document). */
  onPartner: boolean;
  proposal: LinkProposal;
}

/** Pending proposals of the year (the „Поврзување“ tab), oldest first, plus the number of rejected ones. */
export async function linkProposals(tx: Tx, firmId: string, year: number): Promise<{ rows: LinkRow[]; rejected: number }> {
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), sql`${bankLines.data} ? 'link'`,
    sql`${bankLines.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).orderBy(asc(bankLines.date), asc(bankLines.lineNo));
  const rows: LinkRow[] = [];
  let rejected = 0;
  for (const l of L) {
    const p = linkOf(l);
    if (!p || !linkable(l)) continue;
    if (p.rejected) { rejected++; continue; }
    rows.push({ lineId: l.id, statementId: l.statementId, date: l.date, amount: Number(l.amount), name: l.name ?? '', desc: l.description, partnerId: l.partnerId, onPartner: !!l.konto, proposal: p });
  }
  return { rows, rejected };
}

export interface AcceptLinksResult { linked: number; skipped: { lineId: string; why: string }[]; statements: number }

/**
 * Accept proposed links (bulk). Each line is linked to its proposal's documents re-allocated against the CURRENT open
 * amounts (oldest / proposal order first, capped; the rest an advance). Lines in a locked period, already linked or
 * whose documents are paid meanwhile are skipped with the reason. Each touched statement is re-posted once.
 */
export async function acceptLinks(tx: Tx, a: { firmId: string; userId: string | null; lineIds: readonly string[]; auto?: boolean }): Promise<AcceptLinksResult> {
  const out: AcceptLinksResult = { linked: 0, skipped: [], statements: 0 };
  if (!a.lineIds.length) return out;
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId), inArray(bankLines.id, [...a.lineIds]))).orderBy(asc(bankLines.date), asc(bankLines.lineNo));
  const env = await loadBankEnv(tx, a.firmId);
  const lockOf = await statementLockTest(tx, a.firmId);
  const S = L.length ? await tx.select({ id: bankStatements.id, date: bankStatements.date }).from(bankStatements).where(inArray(bankStatements.id, [...new Set(L.map((l) => l.statementId))])) : [];
  const lockBy = new Map(S.map((s) => [s.id, lockOf(s)]));
  const touched = new Set<string>();
  const done: { id: string; refs: { label: string; amt: number }[] }[] = [];
  for (const y of [...new Set(L.map((l) => yearOf(l.date)))]) {
    const ctx = await matchContext(tx, env, y);
    const rows = ctx.rows.slice();
    for (const l of L.filter((x) => yearOf(x.date) === y)) {
      const p = linkOf(l);
      if (!p || p.rejected) { out.skipped.push({ lineId: l.id, why: 'нема предлог' }); continue; }
      if (!linkable(l)) { out.skipped.push({ lineId: l.id, why: 'ставката е веќе поврзана / книжена' }); continue; }
      const lk = lockBy.get(l.statementId);
      if (lk) { out.skipped.push({ lineId: l.id, why: lk }); continue; }
      const b: BankRow = { ...toBankRow(l), ref: undefined, refs: undefined, settle: undefined };
      // all open documents of the type (the proposal names them); open amounts with the links made so far
      const O = openDocsFor({ id: b.id, acct: b.acct, date: b.date, amount: b.amount, desc: '' }, { ...ctx, rows: rows.map((r) => (r.id === l.id ? b : r)) });
      const pick = p.refs.map((r) => O.O.find((z) => z.x.id === r.id)).filter((z): z is NonNullable<typeof z> => !!z);
      if (!pick.length) { out.skipped.push({ lineId: l.id, why: 'фактурите се веќе платени' }); continue; }
      const r = (isFxAccount(env.accounts, l.bankAccountId) ? linkPaymentFx : linkPayment)(b, pick, O.type, env.konta);
      if (!r) { out.skipped.push({ lineId: l.id, why: 'фактурите се веќе платени' }); continue; }
      const data = { ...((l.data ?? {}) as Record<string, unknown>) };
      delete data.link;
      await tx.update(bankLines).set({ ...bookingPatch(r.row), auto: p.how, newPartner: null, data }).where(eq(bankLines.id, l.id));
      const i = rows.findIndex((x) => x.id === l.id);
      if (i >= 0) rows[i] = r.row; else rows.push(r.row);
      touched.add(l.statementId);
      done.push({ id: l.id, refs: r.refs.map((x) => ({ label: x.label, amt: den(x.amt) })) });
      out.linked++;
    }
  }
  if (touched.size) await postStatements(tx, touched, a.userId, env);
  out.statements = touched.size;
  if (done.length) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankLinkAccept', entityType: 'bank_lines', data: { auto: !!a.auto, lines: done, skipped: out.skipped.length } });
  return out;
}

/** Reject proposed links: the proposal stays on the line marked rejected (not proposed again for the same documents). */
export async function rejectLinks(tx: Tx, a: { firmId: string; userId: string | null; lineIds: readonly string[] }): Promise<number> {
  if (!a.lineIds.length) return 0;
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId), inArray(bankLines.id, [...a.lineIds])));
  let n = 0;
  const at = new Date().toISOString();
  for (const l of L) {
    const p = linkOf(l);
    if (!p || p.rejected) continue;
    await tx.update(bankLines).set({ data: { ...((l.data ?? {}) as Record<string, unknown>), link: { ...p, rejected: true, at, by: a.userId } } }).where(eq(bankLines.id, l.id));
    n++;
  }
  if (n) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankLinkReject', entityType: 'bank_lines', data: { n, ids: L.map((l) => l.id) } });
  return n;
}

/* ---------------- after an import ---------------- */

export interface AfterImport { proposed: number; linked: number; booked: number }

/**
 * After a statement import: proposed links for the imported lines; the „сигурно“ links / lines are confirmed only
 * when the owner switched that step on (`autoSteps`, off by default).
 */
export async function afterImport(tx: Tx, a: { firmId: string; userId: string | null; lineIds: readonly string[]; statementIds: readonly string[] }): Promise<AfterImport> {
  const out: AfterImport = { proposed: 0, linked: 0, booked: 0 };
  if (!a.lineIds.length) return out;
  const P = await proposeLinks(tx, { firmId: a.firmId, userId: a.userId, lineIds: a.lineIds });
  out.proposed = P.length;
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const s = autoSteps(f?.settings);
  if (s.link) {
    const sure = P.filter((p) => p.conf === 'sure').map((p) => p.lineId);
    if (sure.length) out.linked = (await acceptLinks(tx, { firmId: a.firmId, userId: a.userId, lineIds: sure, auto: true })).linked;
  }
  if (s.book && a.statementIds.length) out.booked = (await confirmReview(tx, { firmId: a.firmId, userId: a.userId, statementIds: a.statementIds, onlySure: true, auto: true })).booked;
  return out;
}

/* ---------------- the AI step ---------------- */

export interface ReviewAiStep {
  /** Lines nothing resolved. 0 → the AI step is not offered. */
  lines: number;
  /** AI paused by the budget guard (office or firm limit). */
  paused: boolean;
  msg: string;
  /** Estimated cost of one read (USD). */
  estUsd: number;
}

/** Estimated USD of reading `lines` lines: the firm's / office's average per read so far, else a token estimate. */
export const classifyEstimate = (lines: number, avgPerRead?: number | null): number =>
  Math.round((avgPerRead && avgPerRead > 0 ? avgPerRead : 0.01 + lines * 0.0008) * 10000) / 10000;

/** What the explicit AI button of the review would do (nothing is called here). */
export async function reviewAiStep(tx: Tx, firmId: string, lines: number): Promise<ReviewAiStep> {
  const st = await aiBudgetStatus(tx, firmId);
  if (!lines) return { lines: 0, paused: st.paused, msg: st.paused ? st.msg : '', estUsd: 0 };
  const since = new Date(Date.now() - 180 * 86400_000);
  const [h] = await tx.select({ n: sql<number>`count(distinct coalesce(${aiUsage.refId}, ${aiUsage.id}::text))::int`, usd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
    .from(aiUsage).where(and(sql`${aiUsage.purpose} like 'bankcls%'`, gte(aiUsage.at, since)));
  const avg = h && h.n ? Number(h.usd) / h.n : null;
  return { lines, paused: st.paused, msg: st.msg, estUsd: classifyEstimate(lines, avg) };
}

/** The owner's switches (`firms.settings.autoSteps`). Audited `autoStepsSet`. */
export async function saveAutoSteps(tx: Tx, a: { firmId: string; userId: string | null; steps: { book: boolean; link: boolean; repost: boolean } }): Promise<void> {
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!f) throw new BankError('Фирмата не постои.');
  const v = { book: !!a.steps.book, link: !!a.steps.link, repost: !!a.steps.repost };
  await tx.update(firms).set({ settings: { ...((f.settings ?? {}) as Record<string, unknown>), autoSteps: v } }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'autoStepsSet', entityType: 'firm', entityId: a.firmId, data: v });
}

