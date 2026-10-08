/**
 * Matching: automatic proposals (`autoMatch` — POS, VAT, payment-code rules, FX and MKD invoices by number /
 * amount / subset sum, fees, description rules) reviewed by the user before saving, and manual linking to open
 * documents (`openDocsFor`, `fifoPick`, `linkPayment`).
 *
 * FIX(4.4 #6): legacy `autoMatch` saved every layer immediately (7 wrappers, each toasting and rendering);
 * here one pure run proposes changes and only the accepted ones are written. FIX(4.4 #5): partners are never
 * created silently — a proposal carries `newPartner` and the user ticks it.
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  autoMatch, BKPK_RE, fifoPick, isFxAccount, linkPayment, linkPaymentFx, openDocsFor,
  type BankRow, type DocRefAmt, type DocType, type MatchContext, type MatchHow, type OpenDoc,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { bankLines, bankStatements, partners } from '../schema/index';
import { den, loadBankEnv, POS_PARTNER_NAME, type BankEnv } from './context';
import { openItemsSource } from './open-items';
import { assertStatementOpen, postStatements } from './posting';
import { bookingPatch, toBankRow } from './rows';

/** Matching context for a business year: that year's lines plus every linked line (for paid amounts). */
export async function matchContext(tx: Tx, env: BankEnv, year: number): Promise<MatchContext & { lineStatement: Map<string, string> }> {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const [L, items] = await Promise.all([
    tx.select().from(bankLines).where(and(eq(bankLines.firmId, env.firm.id), or(sql`${bankLines.date} between ${y0} and ${y1}`, isNotNull(bankLines.refId)))),
    openItemsSource().load(tx, env.firm.id, year),
  ]);
  return {
    rows: L.map(toBankRow), accounts: env.accounts, invoices: items.invoices, purchases: items.purchases, partners: env.partners,
    year, firmName: env.firm.name, rules: env.rules, osnovK: env.osnovK, posPartner: env.posPartner, konta: env.konta,
    // TODO(payroll): legacy `payMatch` recognised net-salary payments; Phase 6 owns payroll runs.
    lineStatement: new Map(L.map((l) => [l.id, l.statementId])),
  };
}

export interface MatchProposal {
  lineId: string;
  statementId: string;
  how: MatchHow;
  date: string;
  /** Denars, signed. */
  amount: number;
  desc: string;
  konto?: string;
  partnerId?: string;
  refLabel?: string;
  refs?: { label: string; amt: number }[];
  /** Not allocated to a document (denars) — stays an advance on the partner (FIX 4.4 #8). */
  excess?: number;
  newPartner?: string;
  pos?: boolean;
}

/** A line matching may (re)book: unbooked, or booked on a customer/supplier konto without a document (legacy `bmRun`). */
const open = (r: BankRow) => !r.ref && (!r.konto || BKPK_RE.test(r.konto));

const lastPerLine = <T extends { id: string }>(C: T[]) => [...new Map(C.map((c) => [c.id, c])).values()];

/** Proposals for unbooked lines of the year (optionally only MKD or only FX accounts). Nothing is written. */
export async function proposeMatches(tx: Tx, firmId: string, year: number, scope: { fx?: boolean } = {}): Promise<MatchProposal[]> {
  const env = await loadBankEnv(tx, firmId);
  const ctx = await matchContext(tx, env, year);
  const unbooked = new Set(ctx.rows.filter((r) => open(r) && String(r.date).startsWith(String(year))).map((r) => r.id));
  const r = autoMatch({ ...ctx, rows: ctx.rows });
  return lastPerLine(r.changes)
    .filter((c) => unbooked.has(c.id))
    .filter((c) => scope.fx == null || isFxAccount(env.accounts, c.row.acct) === scope.fx)
    .map((c) => ({
      lineId: c.id, statementId: ctx.lineStatement.get(c.id)!, how: c.how, date: c.row.date, amount: den(c.row.amount), desc: c.row.desc ?? '',
      ...(c.row.konto ? { konto: c.row.konto } : {}), ...(c.row.partner ? { partnerId: c.row.partner } : {}),
      ...(c.row.ref ? { refLabel: c.row.ref.label } : {}),
      ...(c.refs && c.refs.length > 1 ? { refs: c.refs.map((x) => ({ label: x.label, amt: den(x.amt) })) } : {}),
      ...(c.excess ? { excess: den(c.excess) } : {}), ...(c.newPartner ? { newPartner: c.newPartner } : {}),
      ...(c.row.pos ? { pos: true } : {}),
    }));
}

async function ensurePartner(tx: Tx, firmId: string, userId: string | null, name: string, data: Record<string, unknown> = {}): Promise<string> {
  const [ex] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.name, name))).limit(1);
  if (ex) return ex.id;
  const [p] = await tx.insert(partners).values({ firmId, name, data }).returning({ id: partners.id });
  await audit(tx, { userId, firmId, action: 'newS', entityType: 'partner', entityId: p!.id, data: { name, from: 'bank' } });
  return p!.id;
}

/**
 * Save the accepted proposals. The proposals are recomputed here (the client only sends line ids), so a stale
 * review cannot write outdated links. `createPartners` = line ids whose suggested new partner may be created.
 */
export async function applyMatches(tx: Tx, a: { firmId: string; userId: string | null; year: number; accept: string[]; createPartners?: string[] }): Promise<{ applied: number; posted: number; drafts: number }> {
  const env = await loadBankEnv(tx, a.firmId);
  const ctx = await matchContext(tx, env, a.year);
  const ok = new Set(a.accept);
  const mkP = new Set(a.createPartners ?? []);
  const unbooked = new Set(ctx.rows.filter(open).map((r) => r.id));
  const C = lastPerLine(autoMatch(ctx).changes).filter((c) => ok.has(c.id) && unbooked.has(c.id));
  const touched = new Set<string>();
  let posPartner = env.posPartner;
  for (const c of C) {
    const stId = ctx.lineStatement.get(c.id)!;
    const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, stId)).limit(1);
    await assertStatementOpen(tx, st!);
    let row: BankRow = c.row;
    if (row.pos && !row.partner) {
      posPartner ??= await ensurePartner(tx, a.firmId, a.userId, POS_PARTNER_NAME, { pos: true });
      row = { ...row, partner: posPartner };
    }
    if (!row.partner && c.newPartner && mkP.has(c.id)) row = { ...row, partner: await ensurePartner(tx, a.firmId, a.userId, c.newPartner) };
    await tx.update(bankLines).set({ ...bookingPatch(row), auto: c.how, newPartner: row.partner ? null : c.newPartner ?? null })
      .where(and(eq(bankLines.id, c.id), eq(bankLines.firmId, a.firmId)));
    touched.add(stId);
  }
  const res = await postStatements(tx, touched, a.userId, env);
  if (C.length) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'autoMatch', entityType: 'bank_lines', data: { lines: C.map((c) => ({ id: c.id, how: c.how })) } });
  const posted = [...res.values()].filter((r) => r.status === 'posted').length;
  return { applied: C.length, posted, drafts: res.size - posted };
}

/* ---------------- manual linking ---------------- */

export interface LineDocs { type: DocType; partnerId: string; docs: { doc: OpenDoc; open: number }[]; fifo: string[] }

/** Open documents a payment could close (legacy `bmOpenFor` / `VIEWS.bkPick`), oldest first; `fifo` = default pick. */
export async function lineOpenDocs(tx: Tx, firmId: string, year: number, lineId: string): Promise<LineDocs> {
  const env = await loadBankEnv(tx, firmId);
  const ctx = await matchContext(tx, env, year);
  const self = ctx.rows.find((r) => r.id === lineId);
  if (!self) throw new Error('Ставката не постои.');
  // The line's own current link does not count as paid while re-linking it.
  const rows = ctx.rows.map((r) => (r.id === lineId ? { ...r, ref: undefined, refs: undefined, settle: undefined } : r));
  const b = { ...self, ref: undefined, refs: undefined };
  const o = openDocsFor(b, { ...ctx, rows });
  return { type: o.type, partnerId: o.pid, docs: o.O.map((z) => ({ doc: z.x, open: z.o })), fifo: fifoPick(b, o.O).map((z) => z.x.id) };
}

/**
 * Link a payment to picked documents (legacy `bmLink` / `bkPickSave`). The allocation is capped at each
 * document's open amount (FIX 4.4 #8); the excess stays on the partner as an advance.
 */
export async function linkLine(tx: Tx, a: { firmId: string; userId: string | null; year: number; lineId: string; docIds: string[] }): Promise<{ refs: DocRefAmt[]; excess: number }> {
  const [line] = await tx.select().from(bankLines).where(and(eq(bankLines.id, a.lineId), eq(bankLines.firmId, a.firmId))).limit(1);
  if (!line) throw new Error('Ставката не постои.');
  const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, line.statementId)).limit(1);
  await assertStatementOpen(tx, st!);
  const env = await loadBankEnv(tx, a.firmId);
  const D = await lineOpenDocs(tx, a.firmId, a.year, a.lineId);
  const pick = a.docIds.map((id) => D.docs.find((z) => z.doc.id === id)).filter((z): z is { doc: OpenDoc; open: number } => !!z).map((z) => ({ x: z.doc, o: z.open }));
  if (!pick.length) throw new Error('Изберете барем една фактура.');
  const fx = isFxAccount(env.accounts, line.bankAccountId);
  const r = (fx ? linkPaymentFx : linkPayment)({ ...toBankRow(line), ref: undefined, refs: undefined, settle: undefined }, pick, D.type, env.konta);
  if (!r) throw new Error('Фактурите се веќе платени.');
  await tx.update(bankLines).set({ ...bookingPatch(r.row), auto: null, newPartner: null }).where(eq(bankLines.id, line.id));
  await postStatements(tx, [line.statementId], a.userId, env);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bkPickSave', entityType: 'bank_line', entityId: line.id,
    data: { refs: r.refs.map((x) => ({ label: x.label, amt: den(x.amt) })), excess: den(r.excess) } });
  return { refs: r.refs, excess: r.excess };
}

/** Other unbooked lines of the same statement (for "next" navigation in the UI). */
export async function nextUnbookedLine(tx: Tx, firmId: string, statementId: string, afterLineNo: number): Promise<string | null> {
  const [n] = await tx.select({ id: bankLines.id }).from(bankLines).where(and(
    eq(bankLines.firmId, firmId), eq(bankLines.statementId, statementId), sql`${bankLines.lineNo} > ${afterLineNo}`,
    sql`${bankLines.konto} is null`, sql`${bankLines.refId} is null`,
  )).orderBy(bankLines.lineNo).limit(1);
  return n?.id ?? null;
}

/** Lines of a set of ids belonging to the firm (guard for bulk actions). */
export async function firmLines(tx: Tx, firmId: string, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), inArray(bankLines.id, ids)));
}
