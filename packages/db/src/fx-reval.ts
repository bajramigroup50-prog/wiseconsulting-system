/**
 * 💱 Курсни разлики на крајот на месецот — db side of `@wise/core/fx-reval`: gathers, for the firm's foreign-currency
 * bank accounts, the balance in currency (statement chain, `fxStatementBalance`), the ledger balance of the konto in
 * denars (the fiscal year up to the date, opening journal included, without this date's own revaluation) and the НБРМ
 * middle rate of the date, then posts one journal per date (source `fxReval` / `<date>`), re-postable and undoable.
 */
import { and, asc, eq, ne, or, sql, isNull } from 'drizzle-orm';
import { fxRate } from '@wise/core';
import { fxRevalPlan, type FxRevalInput, type FxRevalPlan } from '@wise/core/fx-reval';
import type { Tx } from './audit';
import { PostingError, postJournal, unpostSource } from './posting';
import { bankAccounts, firms, journalLines, journals } from './schema/index';
import { bankKontaFor, firmPostingContext, loadFxSources } from './bank/context';
import { fxStatementBalance } from './bank/bank-parity';
import { closeJournalOf } from './yearend';

export const FX_REVAL_SOURCE = 'fxReval';

export interface FxRevalPreview extends FxRevalPlan {
  date: string;
  konta: { gain: string; loss: string };
  /** The journal already posted for this date (re-posting replaces it). */
  posted: { id: string; number: string; gain: number; loss: number } | null;
  /** The posted journal already books exactly this plan. */
  upToDate: boolean;
  /** The year of the date has no opening journal although the previous year has bookings. */
  noOpening: boolean;
  closed: boolean;
}

export async function fxRevalPreview(tx: Tx, firmId: string, date: string): Promise<FxRevalPreview> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  const year = Number(date.slice(0, 4));
  const ctx = await firmPostingContext(tx, f);
  const bk = bankKontaFor(f, ctx);
  const konta = { gain: bk.fxGain, loss: bk.fxLoss };
  const A = (await tx.select().from(bankAccounts).where(eq(bankAccounts.firmId, firmId)).orderBy(asc(bankAccounts.sort)))
    .filter((a) => (a.cur || 'MKD').toUpperCase() !== 'MKD');
  const fx = await loadFxSources(tx, firmId);
  // one row per konto: the accounts booked on the same konto are summed (they must share the currency)
  const byKonto = new Map<string, typeof A>();
  for (const a of A) byKonto.set(a.konto, [...(byKonto.get(a.konto) ?? []), a]);
  const input: FxRevalInput[] = [];
  for (const [konto, L] of byKonto) {
    const curs = [...new Set(L.map((a) => a.cur.toUpperCase()))];
    const cur = curs[0]!;
    const name = L.map((a) => a.name).join(', ');
    const balMkd = await kontoBalance(tx, firmId, konto, year, date);
    if (curs.length > 1) { input.push({ konto, cur, name, balCur: null, balMkd, rate: 0, skip: `на контото се води повеќе валути (${curs.join(', ')}) – одделете ги сметките на посебни конта` }); continue; }
    let balCur: number | null = 0, missing = false;
    for (const a of L) {
      const b = await fxStatementBalance(tx, a.id, date);
      if (b == null) missing = true; else balCur = (balCur ?? 0) + b / 100;
    }
    if (missing) balCur = null;
    // the official НБРМ middle rate (office list); the firm's own fixed rate only when the office has none
    const rate = fx.office.some((r) => r.cur === cur) ? fxRate(cur, date, { office: fx.office }) : fxRate(cur, date, fx);
    input.push({
      konto, cur, name, balCur, balMkd, rate,
      ...(balCur == null ? { skip: 'нема извод со салдо до датумот – внесете го изводот (почетно салдо) за сметката' } : {}),
    });
  }
  const plan = fxRevalPlan(input, konta);
  const [pj] = await tx.select({ id: journals.id, number: journals.number, meta: journals.meta }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, FX_REVAL_SOURCE), eq(journals.sourceId, date))).limit(1);
  const [{ open }] = (await tx.select({ open: sql<number>`count(*)::int` }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.kind, 'open'), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))) as [{ open: number }];
  const [{ prev }] = (await tx.select({ prev: sql<number>`count(*)::int` }).from(journals)
    .where(and(eq(journals.firmId, firmId), sql`${journals.date} between ${year - 1 + '-01-01'} and ${year - 1 + '-12-31'}`))) as [{ prev: number }];
  const closed = !!(await closeJournalOf(tx, firmId, year));
  const m = (pj?.meta ?? {}) as { gain?: number; loss?: number };
  const posted = pj ? { id: pj.id, number: pj.number, gain: m.gain ?? 0, loss: m.loss ?? 0 } : null;
  const upToDate = !!posted && Math.abs(posted.gain - plan.gain) < 0.005 && Math.abs(posted.loss - plan.loss) < 0.005;
  return { ...plan, date, konta, posted, upToDate, noOpening: !open && prev > 0, closed };
}

/** Ledger balance (debit − credit) of a konto in the fiscal year up to `date`, without that date's revaluation journal. */
async function kontoBalance(tx: Tx, firmId: string, konto: string, year: number, date: string): Promise<number> {
  const [r] = await tx.select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(
      eq(journalLines.firmId, firmId), eq(journalLines.account, konto),
      sql`${journals.date} between ${year + '-01-01'} and ${date}`,
      or(isNull(journals.sourceType), ne(journals.sourceType, FX_REVAL_SOURCE), ne(journals.sourceId, date)),
    ));
  return Number(r?.s ?? 0) || 0;
}

export async function postFxReval(tx: Tx, a: { firmId: string; date: string; userId: string | null }) {
  const p = await fxRevalPreview(tx, a.firmId, a.date);
  if (p.closed) throw new PostingError('locked', `Годината ${a.date.slice(0, 4)} е затворена – прво поништете го затворањето.`);
  if (!p.lines.length) throw new PostingError('empty', 'Нема курсни разлики за книжење (салдата веќе се по средниот курс или нема девизни сметки со извод).');
  const d = a.date.split('-').reverse().join('.');
  const j = await postJournal(tx, {
    firmId: a.firmId, date: a.date, kind: 'manual', sourceType: FX_REVAL_SOURCE, sourceId: a.date,
    description: `Курсни разлики – девизни сметки по среден курс на НБРМ на ${d}`,
    lines: p.lines.map((l) => ({ ...l, doc: null })), userId: a.userId, requirePartner: false, auditAction: 'fxReval',
    meta: { gain: p.gain, loss: p.loss, rows: p.rows.filter((r) => r.diff).map((r) => ({ konto: r.konto, cur: r.cur, balCur: r.balCur, rate: r.rate, balMkd: r.balMkd, diff: r.diff })) },
  });
  return { journal: j, gain: p.gain, loss: p.loss };
}

export const undoFxReval = (tx: Tx, a: { firmId: string; date: string; userId: string | null }) =>
  unpostSource(tx, { firmId: a.firmId, sourceType: FX_REVAL_SOURCE, sourceId: a.date, userId: a.userId });

/** The revaluation journals of a year (newest first) with their gain / loss. */
export async function fxRevalList(tx: Tx, firmId: string, year: number) {
  const R = await tx.select({ id: journals.id, date: journals.date, number: journals.number, meta: journals.meta }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, FX_REVAL_SOURCE), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
    .orderBy(sql`${journals.date} desc`);
  return R.map((r) => { const m = r.meta as { gain?: number; loss?: number }; return { id: r.id, date: r.date, number: r.number, gain: m.gain ?? 0, loss: m.loss ?? 0 }; });
}
