/**
 * „Конта за изводи“: the per-firm bank kontos (`firms.settings.bankKonta`) — customer, supplier, daily turnover,
 * cash withdrawal, own-transfer transit (denars / FX), POS — validated against the chart, and the move of the existing
 * own-transfer lines from the old transit konto (1009) to the current one (10091 by default).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { BANK_KONTA, BANK_KONTA_FIELDS, bankKontoBookable, bankTransitDefaults, genericBankKonto, ownTransferBy, pickBankKonto, validateBankKonta, type BankKonta, type SelfBy } from '@wise/core';
import { audit, type Tx } from '../audit';
import { effectiveChart } from '../ledger-queries';
import { PostingError } from '../posting';
import { bankAccounts, bankLines, bankStatements, firms } from '../schema/index';
import { BankError, bankKontoChart, bankKontaFor, kontoManualIds, loadBankAccounts, loadBankEnv, loadFirm, markKontoManual, syncFirmBanks } from './context';
import { assertStatementOpen, bankJournalLayout, postStatement, postStatements, repostAccountStatements, type AccountRepost, type BankJournalLayout } from './posting';
import { journalLines, journals } from '../schema/index';
import { BANK_SOURCE_TYPE } from './open-items';
import { toBankRow } from './rows';

type KontaKey = keyof BankKonta;

export interface BankKontaPanel {
  /** Effective kontos (defaults + scheme + per-firm overrides). */
  konta: BankKonta;
  /** What the firm set explicitly (`firms.settings.bankKonta`). */
  overrides: Partial<BankKonta>;
  /** Value without the firm's override (scheme / chart default), shown as the placeholder. */
  defaults: Partial<Record<KontaKey, string>>;
  /** Bank konto in the statement journal: `sum` (once per side, default) or `line` (per statement line). */
  layout: BankJournalLayout;
}

export async function bankKontaPanel(tx: Tx, firmId: string): Promise<BankKontaPanel> {
  const env = await loadBankEnv(tx, firmId);
  const overrides = (((env.firm.settings ?? {}) as Record<string, unknown>).bankKonta ?? {}) as Partial<BankKonta>;
  const s = { ...((env.firm.settings ?? {}) as Record<string, unknown>) };
  delete s.bankKonta;
  const base = bankKontaFor({ ...env.firm, settings: s }, env.posting, await effectiveChart(tx, firmId));
  const defaults: Partial<Record<KontaKey, string>> = {};
  for (const f of BANK_KONTA_FIELDS) defaults[f.key] = base[f.key];
  return { konta: env.konta, overrides, defaults, layout: bankJournalLayout(env.firm) };
}

/** Save the firm's bank kontos; an empty field returns to the default. Every konto must be in the chart. Audited `bankKontaSet`. */
export async function saveBankKonta(tx: Tx, a: { firmId: string; userId: string | null; input: Partial<Record<KontaKey, string>>; layout?: BankJournalLayout }): Promise<Partial<BankKonta>> {
  const chart = await effectiveChart(tx, a.firmId);
  const { konta, errors } = validateBankKonta(a.input, chart);
  if (errors.length) throw new BankError(errors.join(' '));
  const f = await loadFirm(tx, a.firmId);
  const s = (f.settings ?? {}) as Record<string, unknown>;
  const prev = (s.bankKonta ?? {}) as Partial<BankKonta>;
  // keys outside the panel (fee, fxGain, …) set elsewhere are kept
  const keep = Object.fromEntries(Object.entries(prev).filter(([k]) => !BANK_KONTA_FIELDS.some((x) => x.key === k)));
  const next = { ...keep, ...konta };
  const layout = a.layout ?? bankJournalLayout(f);
  await tx.update(firms).set({ settings: { ...s, bankKonta: next, bankJournal: layout } }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankKontaSet', entityType: 'firm', entityId: a.firmId,
    data: { before: prev, after: next, ...(layout !== bankJournalLayout(f) ? { layout: { before: bankJournalLayout(f), after: layout } } : {}) } });
  return next;
}

export interface TransitMove {
  from: string;
  to: string;
  /** Lines moved (or to be moved, on a dry run). */
  lines: number;
  statements: number;
  /** Statements left untouched because the period / nalog is locked. */
  skipped: { statementId: string; number: string | null; date: string; lines: number; why: string }[];
  /** The lines (moved / to move, and the skipped ones flagged), for the list shown before the confirm. */
  items: { id: string; date: string; statementNo: string | null; desc: string; amount: number; by: SelfBy | 'tech'; skipped: boolean }[];
}

/**
 * „↻ Префрли постоечки ставки 1009 → 10091“: the year's lines on the old transit konto whose counterparty is the firm
 * itself (`ownTransferBy`: own bank account, ЕДБ or name incl. a branch suffix — both sides of a transfer between the
 * main account and the sub-accounts) or that come from a „Посебна сметка“ (`auto` tech) go to the current transit
 * konto; their statements are re-posted. Never: a real deposit of the daily turnover (a cash deposit / „уплата на
 * пазар“ that does not come from an own account stays on 1009), a line on any other konto, a line linked to a
 * document or split, a statement in a locked period or with a locked nalog (listed as skipped). `dry` = the list only.
 * Audited `bankTransitMove`.
 */
export async function moveTransitLines(tx: Tx, a: { firmId: string; userId: string | null; year: number; from?: string; dry?: boolean }): Promise<TransitMove> {
  const env = await loadBankEnv(tx, a.firmId);
  const from = a.from || BANK_KONTA.transit;
  const to = env.konta.transit;
  const out: TransitMove = { from, to, lines: 0, statements: 0, skipped: [], items: [] };
  if (from === to) return out;
  const L = await tx.select().from(bankLines).where(and(
    eq(bankLines.firmId, a.firmId), eq(bankLines.konto, from), sql`${bankLines.refId} is null`,
    sql`${bankLines.date} between ${a.year + '-01-01'} and ${a.year + '-12-31'}`, sql`not ${bankLines.conv}`,
  )).orderBy(asc(bankLines.date), asc(bankLines.lineNo));
  const ctx = { firmName: env.firm.name, firmEdb: env.firm.edb ?? undefined, accounts: env.accounts, partners: env.partners, konta: env.konta };
  const byOf = new Map<string, SelfBy | 'tech'>();
  for (const l of L) {
    if (l.split && l.split.length) continue;
    const by = l.auto === 'tech' ? 'tech' : ownTransferBy(toBankRow(l), ctx);
    if (by) byOf.set(l.id, by);
  }
  const pick = L.filter((l) => byOf.has(l.id));
  if (!pick.length) return out;
  const bySt = new Map<string, typeof pick>();
  for (const l of pick) (bySt.get(l.statementId) ?? bySt.set(l.statementId, []).get(l.statementId)!).push(l);
  const S = await tx.select().from(bankStatements).where(inArray(bankStatements.id, [...bySt.keys()])).orderBy(asc(bankStatements.date));
  const done: string[] = [];
  for (const st of S) {
    const its = bySt.get(st.id)!;
    try { await assertStatementOpen(tx, st); } catch (e) {
      if (!(e instanceof PostingError)) throw e;
      out.skipped.push({ statementId: st.id, number: st.number, date: st.date, lines: its.length, why: e.message });
      for (const l of its) out.items.push({ id: l.id, date: l.date, statementNo: st.number, desc: l.name || l.description, amount: Number(l.amount), by: byOf.get(l.id)!, skipped: true });
      continue;
    }
    for (const l of its) out.items.push({ id: l.id, date: l.date, statementNo: st.number, desc: l.name || l.description, amount: Number(l.amount), by: byOf.get(l.id)!, skipped: false });
    if (!a.dry) await tx.update(bankLines).set({ konto: to }).where(inArray(bankLines.id, its.map((l) => l.id)));
    out.lines += its.length;
    out.statements++;
    done.push(st.id);
  }
  if (!a.dry && done.length) {
    await postStatements(tx, done, a.userId, env);
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankTransitMove', entityType: 'bank_lines', data: { from, to, year: a.year, lines: out.lines, statements: out.statements, skipped: out.skipped.length } });
  }
  return out;
}

export interface StatementRepost {
  layout: BankJournalLayout;
  /** Statements re-posted (their journal was rebuilt in the firm's current layout). */
  statements: number;
  /** Journal lines before → after over the re-posted statements. */
  linesBefore: number;
  linesAfter: number;
  skipped: { statementId: string; number: string | null; date: string; why: string }[];
}

/**
 * „↻ Прекнижи ги изводите збирно“: re-post every statement of the year that has a journal, through the normal
 * statement posting (same journal number, link to the statement), so the journal takes the firm's current layout.
 * Statements in a locked period or with a locked nalog are skipped and listed. Audited `bankRepostLayout`.
 */
export async function repostStatementsLayout(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<StatementRepost> {
  const env = await loadBankEnv(tx, a.firmId);
  const out: StatementRepost = { layout: bankJournalLayout(env.firm), statements: 0, linesBefore: 0, linesAfter: 0, skipped: [] };
  const J = await tx.select({ id: journals.id, sourceId: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), sql`${journals.date} between ${a.year + '-01-01'} and ${a.year + '-12-31'}`));
  if (!J.length) return out;
  const countOf = async (stId: string): Promise<number> => {
    const [j] = await tx.select({ id: journals.id }).from(journals)
      .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), eq(journals.sourceId, stId))).limit(1);
    if (!j) return 0;
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalLines).where(eq(journalLines.journalId, j.id));
    return Number(n?.n ?? 0);
  };
  const S = await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, a.firmId), inArray(bankStatements.id, J.map((j) => j.sourceId!).filter(Boolean)))).orderBy(asc(bankStatements.date));
  for (const st of S) {
    try { await assertStatementOpen(tx, st); } catch (e) {
      if (!(e instanceof PostingError)) throw e;
      out.skipped.push({ statementId: st.id, number: st.number, date: st.date, why: e.message });
      continue;
    }
    out.linesBefore += await countOf(st.id);
    await postStatement(tx, st.id, a.userId, env);
    out.linesAfter += await countOf(st.id);
    out.statements++;
  }
  if (out.statements) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankRepostLayout', entityType: 'bank_statement', data: { year: a.year, layout: out.layout, statements: out.statements, linesBefore: out.linesBefore, linesAfter: out.linesAfter, skipped: out.skipped.length } });
  return out;
}

/* ---------------- konto of each bank account ---------------- */

export interface BankAccountKontoRow {
  id: string; name: string; account: string | null; cur: string; konto: string; manual: boolean;
  /** Analytic konto of the bank when the account is still on the generic 1000 / 100 and was not set by hand. */
  suggest?: { konto: string; name: string };
}

/** Every bank account with its konto and — for a generic, not manual konto — the analytic one of its bank (a suggestion only). */
export async function bankAccountKontos(tx: Tx, firmId: string): Promise<BankAccountKontoRow[]> {
  const [f, A, chart] = await Promise.all([loadFirm(tx, firmId), loadBankAccounts(tx, firmId), bankKontoChart(tx, firmId)]);
  const manual = new Set(kontoManualIds(f));
  return A.map((a) => {
    const row: BankAccountKontoRow = { id: a.id, name: a.name, account: a.account ?? a.iban, cur: a.cur, konto: a.konto, manual: manual.has(a.id) };
    if (!row.manual && a.cur === 'MKD' && genericBankKonto(a.konto)) {
      const k = pickBankKonto(a.account ?? a.iban, chart, A.filter((x) => x.id !== a.id).map((x) => x.konto));
      if (k) row.suggest = { konto: k, name: chart.find((c) => c.code === k)?.name ?? '' };
    }
    return row;
  });
}

/**
 * Set a bank account's konto by hand („Примени и прекнижи“ / the konto field): the konto must be a real konto of the
 * chart and not used by another account; it is remembered as manual (never changed automatically) and the account's
 * statements are re-posted in OPEN periods (locked ones reported). Audited `bankAcctKonto`.
 */
export async function setBankAccountKonto(tx: Tx, a: { firmId: string; userId: string | null; accountId: string; konto: string }): Promise<AccountRepost & { from: string; to: string }> {
  const konto = a.konto.trim().split(/\s/)[0]!;
  const chart = await effectiveChart(tx, a.firmId);
  if (!bankKontoBookable(chart, konto)) throw new BankError(`Контото ${konto || '—'} го нема во контниот план.`);
  const A = await loadBankAccounts(tx, a.firmId);
  const acc = A.find((x) => x.id === a.accountId);
  if (!acc) throw new BankError('Сметката не постои.');
  if (A.some((x) => x.id !== acc.id && x.konto === konto)) throw new BankError('Ова конто веќе се користи за друга сметка.');
  await markKontoManual(tx, a.firmId, acc.id);
  if (acc.konto === konto) return { from: konto, to: konto, statements: 0, skipped: [] };
  await tx.update(bankAccounts).set({ konto }).where(eq(bankAccounts.id, acc.id));
  await syncFirmBanks(tx, a.firmId);
  const r = await repostAccountStatements(tx, { firmId: a.firmId, userId: a.userId, accountId: acc.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankAcctKonto', entityType: 'bank_account', entityId: acc.id,
    data: { from: acc.konto, to: konto, statements: r.statements, skipped: r.skipped.length } });
  return { ...r, from: acc.konto, to: konto };
}

/** Chart defaults of the transit kontos (for the panel's hint). */
export const transitDefaultsOf = bankTransitDefaults;

/**
 * Counterparty accounts of own-transfer lines (the firm itself by name / ЕДБ) that are not registered as the firm's
 * bank accounts — offered for registration on the bank accounts screen.
 */
export async function unregisteredOwnAccounts(tx: Tx, firmId: string): Promise<{ account: string; lines: number; name: string }[]> {
  const env = await loadBankEnv(tx, firmId);
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), sql`coalesce(${bankLines.counterAccount}, '') <> ''`, eq(bankLines.own, true)));
  const dig = (x: unknown) => String(x ?? '').replace(/\D/g, '');
  const known = env.accountRows.map((x) => dig(x.account ?? x.iban)).filter((x) => x.length >= 10);
  const ctx = { firmName: env.firm.name, firmEdb: env.firm.edb ?? undefined, accounts: env.accounts, partners: env.partners, konta: env.konta };
  const M = new Map<string, { account: string; lines: number; name: string }>();
  for (const l of L) {
    const ca = dig(l.counterAccount);
    if (ca.length < 10 || known.some((k) => ca.endsWith(k.slice(-10)) || k.endsWith(ca.slice(-10)))) continue;
    if (!ownTransferBy(toBankRow(l), ctx)) continue;
    const m = M.get(ca) ?? { account: l.counterAccount!, lines: 0, name: l.name || '' };
    m.lines++;
    M.set(ca, m);
  }
  return [...M.values()];
}
