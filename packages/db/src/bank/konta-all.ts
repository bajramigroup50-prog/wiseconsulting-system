/**
 * „🏦 Примени за сите фирми“ (office owner only): the three per-firm actions of „Конта за изводи“ for EVERY real firm
 * at once —
 *  1. `konto`: every bank account still on the generic 1000 / 100 (denars, not set by hand) gets the analytic konto of
 *     its bank (`pickBankKonto`, as „Примени и прекнижи“ — 270 Halk → 100005, the next Halk account → 1000051, 300 →
 *     100002); an account without a confident match stays; its statements are re-posted in OPEN periods;
 *  2. `transit`: „↻ Префрли постоечки ставки 1009 → 10091“ (own-transfer lines only, the daily turnover stays);
 *  3. `layout`: „↻ Прекнижи ги изводите збирно“ — only the statements whose journal is NOT already in the firm's layout
 *     (so a second run finds nothing to do).
 *
 * The preview (`bankKontaAllPlan`) writes nothing. `applyFirmBankKontaAll` runs ONE firm in its OWN transaction and
 * checks before it commits that the firm's trial balance (debit and credit per konto) and the bank konto balance of
 * every statement journal are unchanged except for the intended konto moves (old bank konto → new, 1009 → 10091 —
 * compared per konto group); any other difference rolls the firm back and is reported as an error. Locked periods /
 * nalogs are skipped and reported. Demo firms (`settings.demo`) are never touched. Audited per firm `bankKontaAll`.
 * The run over many firms is the worker job `bank.konta-all` with its state / progress in `app_settings`.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { bankKontoBookable, genericBankKonto, pickBankKonto } from '@wise/core';
import { isDemoFirm } from '@wise/core/demo';
import { audit, type Tx } from '../audit';
import { effectiveChart } from '../ledger-queries';
import { assertOpenPeriod, PostingError } from '../posting';
import { appSettings, bankAccounts, bankLines, bankStatements, firms, journalLines, journals, type BankLine } from '../schema/index';
import { kontoManualIds, loadBankAccounts, loadBankEnv, loadFirm, type BankEnv } from './context';
import { moveTransitLines, setBankAccountKonto } from './konta';
import { BANK_SOURCE_TYPE } from './open-items';
import { bankJournalLayout, lineProblem, postStatement, statementJournalLines, type BankJournalLayout } from './posting';

export type BulkStep = 'konto' | 'transit' | 'layout';
export const BULK_STEPS: readonly BulkStep[] = ['konto', 'transit', 'layout'];
export const BULK_STEP_LBL: Record<BulkStep, string> = {
  konto: 'Конто на банкарските сметки („Примени и прекнижи“)',
  transit: 'Префрли ставки 1009 → 10091',
  layout: 'Прекнижи ги изводите збирно',
};
export const BANK_KONTA_ALL_JOB = 'bank.konta-all';
export const BANK_KONTA_ALL_KEY = 'bankKontaAll';

const isDemo = (f: { name: string; settings: unknown }) =>
  isDemoFirm(f) || ((f.settings ?? {}) as { demo?: unknown }).demo === true;

/* ---------------- preview ---------------- */

export interface BulkAccountMove { id: string; name: string; account: string | null; from: string; fromName: string; to: string; toName: string; statements: number }

export interface FirmBulkPlan {
  firmId: string;
  name: string;
  active: boolean;
  accounts: BulkAccountMove[];
  /** Accounts set by hand (left alone) / generic accounts without a confident match (left alone). */
  manual: number;
  noMatch: number;
  transit: { from: string; to: string; lines: number; statements: number };
  layout: { layout: BankJournalLayout; statements: number; off?: string };
  /** Statements each step leaves out because the period / nalog is locked (ids; the screen counts the union of the ticked steps). */
  locked: Record<BulkStep, string[]>;
  /** The reasons (distinct, first few). */
  lockedWhy: string[];
}

export const planEmpty = (p: FirmBulkPlan, steps: readonly BulkStep[] = BULK_STEPS): boolean =>
  !(steps.includes('konto') && p.accounts.length) && !(steps.includes('transit') && p.transit.lines) && !(steps.includes('layout') && p.layout.statements);

/** Statement lock test of one firm (period lock date, locked nalog) without a query per statement. */
async function lockTest(tx: Tx, firmId: string): Promise<(st: { id: string; date: string }) => string | null> {
  const f = await loadFirm(tx, firmId);
  const J = await tx.select({ sourceId: journals.sourceId, number: journals.number }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), eq(journals.locked, true)));
  const L = new Map(J.map((j) => [j.sourceId!, j.number]));
  return (st) => {
    try { assertOpenPeriod(f, st.date); } catch (e) {
      if (e instanceof PostingError) return e.message;
      throw e;
    }
    return L.has(st.id) ? `Налогот ${L.get(st.id)} е заклучен.` : null;
  };
}

/** Lock test of a firm's statements (period lock date, locked nalog): the reason, or null when open. */
export const statementLockTest = (tx: Tx, firmId: string) => lockTest(tx, firmId);

/** Bank accounts that would get their bank's analytic konto, chosen in order so two accounts never get the same konto. */
async function accountMoves(tx: Tx, firmId: string): Promise<{ moves: BulkAccountMove[]; manual: number; noMatch: number }> {
  const [f, A, chart] = await Promise.all([loadFirm(tx, firmId), loadBankAccounts(tx, firmId), effectiveChart(tx, firmId)]);
  const manual = new Set(kontoManualIds(f));
  const pc = chart.map((a) => ({ code: a.code, name: a.name, own: a.overridden }));
  const cur = new Map(A.map((a) => [a.id, a.konto]));
  const nameOf = (k: string) => chart.find((c) => c.code === k)?.name ?? '';
  const out = { moves: [] as BulkAccountMove[], manual: 0, noMatch: 0 };
  for (const a of A) {
    if (manual.has(a.id)) { out.manual++; continue; }
    if ((a.cur || 'MKD') !== 'MKD' || !genericBankKonto(a.konto)) continue;
    const used = [...cur].filter(([id]) => id !== a.id).map(([, k]) => k);
    const k = pickBankKonto(a.account ?? a.iban, pc, used);
    if (!k || k === a.konto || used.includes(k) || !bankKontoBookable(chart, k)) { out.noMatch++; continue; }
    cur.set(a.id, k);
    out.moves.push({ id: a.id, name: a.name, account: a.account ?? a.iban, from: a.konto, fromName: nameOf(a.konto), to: k, toName: nameOf(k), statements: 0 });
  }
  return out;
}

const C = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100);

/**
 * Statements of the year whose journal differs from what posting them NOW gives (the firm's layout, current kontos) —
 * the ones „↻ Прекнижи ги изводите збирно“ would change. Locked ones are returned apart.
 */
async function layoutDue(tx: Tx, env: BankEnv, year: number, locked: (st: { id: string; date: string }) => string | null): Promise<{ due: string[]; skipped: { id: string; why: string }[] }> {
  const firmId = env.firm.id;
  const J = await tx.select({ id: journals.id, sourceId: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const out = { due: [] as string[], skipped: [] as { id: string; why: string }[] };
  if (!J.length) return out;
  const ids = J.map((j) => j.sourceId!).filter(Boolean);
  const [S, L, JL] = await Promise.all([
    tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, firmId), inArray(bankStatements.id, ids))).orderBy(asc(bankStatements.date)),
    tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), inArray(bankLines.statementId, ids))).orderBy(asc(bankLines.lineNo)),
    tx.select({ journalId: journalLines.journalId, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit }).from(journalLines)
      .where(inArray(journalLines.journalId, J.map((j) => j.id))).orderBy(asc(journalLines.lineNo)),
  ]);
  const acc = new Map(env.accountRows.map((a) => [a.id, a]));
  const jOf = new Map(J.map((j) => [j.sourceId!, j.id]));
  const linesOf = new Map<string, BankLine[]>();
  for (const l of L) (linesOf.get(l.statementId) ?? linesOf.set(l.statementId, []).get(l.statementId)!).push(l);
  const jl = new Map<string, string[]>();
  for (const l of JL) (jl.get(l.journalId) ?? jl.set(l.journalId, []).get(l.journalId)!).push(`${l.account}|${C(l.debit)}|${C(l.credit)}`);
  for (const st of S) {
    const a = acc.get(st.bankAccountId);
    if (!a) continue;
    const fx = (a.cur || 'MKD') !== 'MKD';
    const ok = (linesOf.get(st.id) ?? []).filter((l) => !lineProblem(l, fx));
    const want = statementJournalLines(env, { konto: a.konto, cur: a.cur }, ok, st).map((l) => `${l.account}|${C(l.debit)}|${C(l.credit)}`);
    const have = jl.get(jOf.get(st.id)!) ?? [];
    if (want.length === have.length && want.every((x, i) => x === have[i])) continue;
    const why = locked(st);
    if (why) out.skipped.push({ id: st.id, why });
    else out.due.push(st.id);
  }
  return out;
}

/** What the three steps would change in one firm (nothing is written). */
export async function planFirmBankKonta(tx: Tx, firmId: string, year: number): Promise<FirmBulkPlan> {
  const f = await loadFirm(tx, firmId);
  const locked = await lockTest(tx, firmId);
  const why = new Set<string>();
  const plan: FirmBulkPlan = {
    firmId, name: f.name, active: f.active, accounts: [], manual: 0, noMatch: 0,
    transit: { from: '', to: '', lines: 0, statements: 0 }, layout: { layout: bankJournalLayout(f), statements: 0 },
    locked: { konto: [], transit: [], layout: [] }, lockedWhy: [],
  };
  // 1) bank account kontos: the statements of each moved account are re-posted (locked ones stay)
  const am = await accountMoves(tx, firmId);
  plan.manual = am.manual;
  plan.noMatch = am.noMatch;
  if (am.moves.length) {
    const S = await tx.select({ id: bankStatements.id, date: bankStatements.date, acc: bankStatements.bankAccountId }).from(bankStatements)
      .where(and(eq(bankStatements.firmId, firmId), inArray(bankStatements.bankAccountId, am.moves.map((m) => m.id))));
    for (const m of am.moves) {
      for (const s of S.filter((x) => x.acc === m.id)) {
        const w = locked(s);
        if (w) { plan.locked.konto.push(s.id); why.add(w); } else m.statements++;
      }
    }
  }
  plan.accounts = am.moves;
  // 2) own-transfer lines 1009 → 10091 (dry run of the per-firm action)
  const mv = await moveTransitLines(tx, { firmId, userId: null, year, dry: true });
  plan.transit = { from: mv.from, to: mv.to, lines: mv.lines, statements: mv.statements };
  for (const s of mv.skipped) { plan.locked.transit.push(s.statementId); why.add(s.why); }
  // 3) statements not in the firm's layout
  if (plan.layout.layout === 'line') plan.layout.off = 'фирмата е поставена „по ставка“';
  else {
    const env = await loadBankEnv(tx, firmId);
    const d = await layoutDue(tx, env, year, locked);
    plan.layout.statements = d.due.length;
    for (const s of d.skipped) { plan.locked.layout.push(s.id); why.add(s.why); }
  }
  plan.lockedWhy = [...why].slice(0, 5);
  return plan;
}

/** Real firms (no demo firm), active first, then by name. */
export async function bankKontaAllFirms(db: Tx, ids?: readonly string[]): Promise<{ id: string; name: string; active: boolean }[]> {
  const F = await db.select({ id: firms.id, name: firms.name, active: firms.active, settings: firms.settings }).from(firms)
    .where(ids ? (ids.length ? inArray(firms.id, [...ids]) : sql`false`) : undefined);
  return F.filter((f) => !isDemo(f)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'mk'))
    .map((f) => ({ id: f.id, name: f.name, active: f.active }));
}

/** The preview for every real firm (each read in its own transaction; a firm that cannot be read is listed with the error). */
export async function bankKontaAllPlan(db: Tx, a: { year: number; firmIds?: readonly string[] }): Promise<(FirmBulkPlan & { error?: string })[]> {
  const out: (FirmBulkPlan & { error?: string })[] = [];
  for (const f of await bankKontaAllFirms(db, a.firmIds)) {
    try { out.push(await db.transaction((tx) => planFirmBankKonta(tx as unknown as Tx, f.id, a.year))); } catch (e) {
      out.push({
        firmId: f.id, name: f.name, active: f.active, accounts: [], manual: 0, noMatch: 0, transit: { from: '', to: '', lines: 0, statements: 0 },
        layout: { layout: 'sum', statements: 0 }, locked: { konto: [], transit: [], layout: [] }, lockedWhy: [], error: (e as Error).message,
      });
    }
  }
  return out;
}

/* ---------------- apply (one firm, its own transaction) ---------------- */

export interface FirmBulkResult {
  firmId: string;
  name: string;
  status: 'done' | 'skipped' | 'error';
  reason?: string;
  accounts: { from: string; to: string; name: string }[];
  transitLines: number;
  /** Statements re-posted into the layout by step 3. */
  layoutStatements: number;
  /** Statements left out because of a locked period / nalog (all steps). */
  locked: number;
}

/** The totals did not hold — the firm is rolled back. */
export class BulkVerifyError extends Error {}

interface Snapshot { tb: Map<string, { d: number; c: number }>; st: Map<string, Map<string, number>>; accOf: Map<string, string> }

async function snapshot(tx: Tx, firmId: string): Promise<Snapshot> {
  const [T, S, A] = await Promise.all([
    tx.select({ account: journalLines.account, d: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)` })
      .from(journalLines).where(eq(journalLines.firmId, firmId)).groupBy(journalLines.account),
    tx.select({ sourceId: journals.sourceId, account: journalLines.account, n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, BANK_SOURCE_TYPE))).groupBy(journals.sourceId, journalLines.account),
    tx.select({ id: bankStatements.id, konto: bankAccounts.konto }).from(bankStatements).innerJoin(bankAccounts, eq(bankAccounts.id, bankStatements.bankAccountId))
      .where(eq(bankStatements.firmId, firmId)),
  ]);
  const st = new Map<string, Map<string, number>>();
  for (const r of S) (st.get(r.sourceId!) ?? st.set(r.sourceId!, new Map()).get(r.sourceId!)!).set(r.account, C(r.n));
  return { tb: new Map(T.map((r) => [r.account, { d: C(r.d), c: C(r.c) }])), st, accOf: new Map(A.map((r) => [r.id, r.konto])) };
}

/**
 * Same totals before / after, per konto GROUP (the intended moves join old and new konto into one group): the trial
 * balance (debit and credit) and, per statement journal, the balance on its bank konto. Returns the differences.
 */
export function compareSnapshots(b: Snapshot, a: Snapshot, pairs: readonly (readonly [string, string])[]): string[] {
  const P = new Map<string, string>();
  const g = (k: string): string => { let x = k; while (P.has(x)) x = P.get(x)!; return x; };
  for (const [x, y] of pairs) { const gx = g(x), gy = g(y); if (gx !== gy) P.set(gx, gy); }
  const out: string[] = [];
  const sumTb = (s: Snapshot) => {
    const M = new Map<string, { d: number; c: number; k: Set<string> }>();
    for (const [k, v] of s.tb) { const m = M.get(g(k)) ?? { d: 0, c: 0, k: new Set() }; m.d += v.d; m.c += v.c; m.k.add(k); M.set(g(k), m); }
    return M;
  };
  const TB = sumTb(b), TA = sumTb(a);
  for (const k of new Set([...TB.keys(), ...TA.keys()])) {
    const x = TB.get(k) ?? { d: 0, c: 0, k: new Set([k]) }, y = TA.get(k) ?? { d: 0, c: 0, k: new Set([k]) };
    if (x.d !== y.d || x.c !== y.c) out.push(`бруто биланс, конто ${[...new Set([...x.k, ...y.k])].join(' / ')}: Д ${x.d / 100} → ${y.d / 100}, П ${x.c / 100} → ${y.c / 100}`);
  }
  const bank = (s: Snapshot, stId: string, konto: string | undefined) => {
    const M = s.st.get(stId);
    if (!M || !konto) return 0;
    let n = 0;
    for (const [k, v] of M) if (g(k) === g(konto)) n += v;
    return n;
  };
  for (const id of new Set([...b.st.keys(), ...a.st.keys()])) {
    if (b.st.has(id) !== a.st.has(id)) { out.push(`извод ${id}: налогот ${b.st.has(id) ? 'исчезна' : 'е нов'}`); continue; }
    const x = bank(b, id, b.accOf.get(id)), y = bank(a, id, a.accOf.get(id));
    if (x !== y) out.push(`извод ${id}: салдо на банкарското конто ${x / 100} → ${y / 100}`);
  }
  return out;
}

export interface ApplyFirmInput {
  firmId: string;
  userId: string | null;
  year: number;
  steps: readonly BulkStep[];
  /** Tests only: runs inside the firm's transaction after the steps, before the check (a throw = a failure). */
  hook?: (tx: Tx, firmId: string) => Promise<void>;
}

/** Apply the ticked steps to ONE firm in its own transaction; checked totals; idempotent (a second run: skipped, nothing to do). */
export async function applyFirmBankKontaAll(db: Tx, a: ApplyFirmInput): Promise<FirmBulkResult> {
  const steps = BULK_STEPS.filter((s) => a.steps.includes(s));
  const [f0] = await db.select({ name: firms.name, settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const base: FirmBulkResult = { firmId: a.firmId, name: f0?.name ?? '', status: 'skipped', accounts: [], transitLines: 0, layoutStatements: 0, locked: 0 };
  if (!f0) return { ...base, status: 'error', reason: 'Фирмата не постои.' };
  if (isDemo(f0)) return { ...base, reason: 'демо фирма' };
  if (!steps.length) return { ...base, reason: 'не е избран ниту еден чекор' };
  try {
    return await db.transaction(async (t) => {
      const tx = t as unknown as Tx;
      const plan = await planFirmBankKonta(tx, a.firmId, a.year);
      const r: FirmBulkResult = { ...base };
      const lockedIds = new Set(steps.flatMap((s) => plan.locked[s]));
      r.locked = lockedIds.size;
      if (planEmpty(plan, steps)) {
        const off = steps.length === 1 && steps[0] === 'layout' && plan.layout.off;
        return { ...r, reason: off ? off : lockedIds.size ? 'нема промени во отворените периоди' : 'нема промени' };
      }
      const before = await snapshot(tx, a.firmId);
      const pairs: [string, string][] = [];
      if (steps.includes('konto')) {
        for (const m of plan.accounts) {
          await setBankAccountKonto(tx, { firmId: a.firmId, userId: a.userId, accountId: m.id, konto: m.to });
          r.accounts.push({ from: m.from, to: m.to, name: m.name });
          pairs.push([m.from, m.to]);
        }
      }
      if (steps.includes('transit') && plan.transit.lines) {
        const mv = await moveTransitLines(tx, { firmId: a.firmId, userId: a.userId, year: a.year });
        r.transitLines = mv.lines;
        pairs.push([mv.from, mv.to]);
      }
      if (steps.includes('layout') && !plan.layout.off) {
        const env = await loadBankEnv(tx, a.firmId);
        const d = await layoutDue(tx, env, a.year, await lockTest(tx, a.firmId));
        for (const id of d.due) await postStatement(tx, id, a.userId, env);
        r.layoutStatements = d.due.length;
      }
      if (a.hook) await a.hook(tx, a.firmId);
      const diff = compareSnapshots(before, await snapshot(tx, a.firmId), pairs);
      if (diff.length) throw new BulkVerifyError(`Збировите не се исти – фирмата е вратена: ${diff.slice(0, 3).join('; ')}${diff.length > 3 ? ` (+${diff.length - 3})` : ''}`);
      r.status = 'done';
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankKontaAll', entityType: 'firm', entityId: a.firmId,
        data: { status: 'done', year: a.year, steps, accounts: r.accounts, transitLines: r.transitLines, layoutStatements: r.layoutStatements, locked: r.locked } });
      return r;
    });
  } catch (e) {
    const reason = (e as Error).message || String(e);
    await audit(db, { userId: a.userId, firmId: a.firmId, action: 'bankKontaAll', entityType: 'firm', entityId: a.firmId, data: { status: 'error', year: a.year, steps, error: reason.slice(0, 500) } }).catch(() => undefined);
    return { ...base, status: 'error', reason };
  }
}

/* ---------------- the run over many firms (worker job, state in app_settings) ---------------- */

export interface BankKontaAllRun {
  runId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  userId: string | null;
  year: number;
  steps: BulkStep[];
  firmIds: string[];
  total: number;
  done: number;
  current?: string | null;
  results: FirmBulkResult[];
  at: string;
  finishedAt?: string | null;
  error?: string | null;
}

export async function bankKontaAllRun(db: Tx): Promise<BankKontaAllRun | null> {
  const [r] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, BANK_KONTA_ALL_KEY)).limit(1);
  return (r?.v as BankKontaAllRun | undefined) ?? null;
}

export async function putBankKontaAllRun(db: Tx, s: BankKontaAllRun): Promise<void> {
  await db.insert(appSettings).values({ key: BANK_KONTA_ALL_KEY, value: s, updatedBy: s.userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedBy: s.userId } });
}

/** A run still going (queued / running and updated in the last 30 minutes). */
export const bankKontaAllBusy = (s: BankKontaAllRun | null, now = Date.now()): boolean =>
  !!s && (s.status === 'queued' || s.status === 'running') && now - Date.parse(s.at) < 30 * 60_000;

/** Apply to the given firms one by one (each its own transaction), reporting progress after every firm. */
export async function runBankKontaAll(db: Tx, a: { userId: string | null; year: number; steps: readonly BulkStep[]; firmIds: readonly string[]; onProgress?: (done: number, current: string | null, r: FirmBulkResult) => Promise<void> }): Promise<FirmBulkResult[]> {
  const real = new Map((await bankKontaAllFirms(db, a.firmIds)).map((f) => [f.id, f]));
  const out: FirmBulkResult[] = [];
  for (const id of a.firmIds) {
    const r = real.has(id)
      ? await applyFirmBankKontaAll(db, { firmId: id, userId: a.userId, year: a.year, steps: a.steps })
      : { firmId: id, name: '', status: 'skipped' as const, reason: 'демо фирма или непостоечка фирма', accounts: [], transitLines: 0, layoutStatements: 0, locked: 0 };
    out.push(r);
    await a.onProgress?.(out.length, r.name, r);
  }
  return out;
}

/** The worker job: runs the stored request `runId` (a newer request or a finished run → nothing). */
export async function runBankKontaAllJob(db: Tx, runId: string): Promise<boolean> {
  const s = await bankKontaAllRun(db);
  if (!s || s.runId !== runId || s.status !== 'queued') return false;
  const st: BankKontaAllRun = { ...s, status: 'running', done: 0, results: [], at: new Date().toISOString() };
  await putBankKontaAllRun(db, st);
  try {
    await runBankKontaAll(db, {
      userId: s.userId, year: s.year, steps: s.steps, firmIds: s.firmIds,
      onProgress: async (done, current, r) => {
        st.done = done; st.current = current; st.results.push(r); st.at = new Date().toISOString();
        await putBankKontaAllRun(db, st);
      },
    });
    await putBankKontaAllRun(db, { ...st, status: 'done', current: null, finishedAt: new Date().toISOString() });
  } catch (e) {
    await putBankKontaAllRun(db, { ...st, status: 'error', current: null, error: (e as Error).message, finishedAt: new Date().toISOString() });
  }
  return true;
}
