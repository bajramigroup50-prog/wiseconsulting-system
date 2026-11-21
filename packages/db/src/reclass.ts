/**
 * „🔁 Рекнижење во маса“ — the database side of `@wise/core/reclass`: find the journal lines of a firm, change konto /
 * partner of the chosen lines as ONE batch (one `audit_log` row `reclassBatch` with every changed line) and undo the
 * whole batch (`reclassUndo`). Every nalog is re-posted through its own path, so links stay right:
 * - manual nalog (`manual`, `open`, `bbimp`, no source): `updateJournal` with the changed lines;
 * - document nalog (invoice, purchase, payroll, …): a line correction (`saveJournalOverride`), re-applied every time
 *   the document is posted again; the partner of a document line is changed in the document (refused here);
 * - statement nalog: the statement line gets the konto / partner (`setLinesBulk`) and the statement is re-posted; a line
 *   closed against an invoice (or split) is refused — unlink it in Банка first.
 * Locked period, locked nalog, closing nalog and closed VAT period are refused (`rcCheck`, the posting service).
 * Each nalog runs in its own savepoint: one refused nalog never stops the others. The amounts never change.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { bankEffKonto } from '@wise/core';
import { bankLineOf } from '@wise/core/bank/line-of';
import {
  rcCheck, rcFind, rcUndoItems, type RcChange, type RcFilter, type RcItem, type RcLine,
} from '@wise/core/reclass';
import { audit, type Tx } from './audit';
import { effectiveChart } from './ledger-queries';
import { journalOverrideState, saveJournalOverride } from './journal-override-save';
import { PostingError, updateJournal } from './posting';
import { auditLog, bankAccounts, bankLines, bankStatements, firms, journalLines, journals } from './schema/index';
import { BankError } from './bank/context';
import { setLinesBulk } from './bank/lines';
import { toBankRow } from './bank/rows';

export class ReclassError extends Error {
  constructor(m: string) { super(m); this.name = 'ReclassError'; }
}

const num = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const MAX_LINES = 5000;

/** Journal lines of the firm in [from, to] (the SQL part of the filter; the rest is `rcFilter`). */
export async function reclassLines(tx: Tx, firmId: string, f: RcFilter & { ids?: readonly number[] }): Promise<RcLine[]> {
  const W = [eq(journalLines.firmId, firmId)];
  if (f.ids) W.push(inArray(journalLines.id, f.ids.length ? [...f.ids] : [-1]));
  if (f.from) W.push(gte(journals.date, f.from));
  if (f.to) W.push(lte(journals.date, f.to));
  if (f.kind) W.push(eq(journals.kind, f.kind));
  if (f.partnerId && f.partnerId !== '-') W.push(eq(journalLines.partnerId, f.partnerId));
  if (f.locationId) W.push(eq(journalLines.locationId, f.locationId));
  const kf = (f.kontoFrom ?? '').trim(), kt = (f.kontoTo ?? '').trim();
  if (kf && !kt) W.push(sql`${journalLines.account} like ${kf.replace(/[%_]/g, '') + '%'}`);
  const R = await tx.select({ l: journalLines, j: journals }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(...W)).orderBy(asc(journals.date), asc(journals.number), asc(journalLines.lineNo)).limit(MAX_LINES + 1);
  return R.map(({ l, j }) => ({
    id: l.id, journalId: j.id, lineNo: l.lineNo, date: j.date, kind: j.kind, number: j.number, jdesc: j.description, sourceType: j.sourceType,
    jlocked: j.locked, account: l.account, partnerId: l.partnerId, debit: num(l.debit), credit: num(l.credit), note: l.note, doc: l.doc, locationId: l.locationId,
  }));
}
export const RECLASS_MAX_LINES = MAX_LINES;

/** One target of a run: the line as it was when chosen (`old`) and what it becomes (`new`). */
interface Target extends RcItem { lineId?: number }
export interface ReclassBlocked { lineId?: number; number: string; date: string; account: string; debit: number; credit: number; reason: string }
export interface ReclassResult { batchId: string | null; items: RcItem[]; blocked: ReclassBlocked[]; journals: number }

class DryRun extends Error { constructor() { super('dry-run'); } }

const errText = (e: unknown) => (e instanceof PostingError || e instanceof BankError || e instanceof ReclassError ? e.message : null);

/** Change the lines of ONE nalog (inside a savepoint). Returns the items done, or throws with the reason. */
async function runJournal(tx: Tx, firmId: string, userId: string | null, journalId: string, T: Target[]): Promise<RcItem[]> {
  const [j] = await tx.select().from(journals).where(and(eq(journals.id, journalId), eq(journals.firmId, firmId))).limit(1);
  if (!j) throw new ReclassError('Налогот не постои.');
  const L = (await tx.select().from(journalLines).where(eq(journalLines.journalId, j.id)).orderBy(asc(journalLines.lineNo)))
    .map((l) => ({ ...l, debit: num(l.debit), credit: num(l.credit) }));
  // the current line of every target (same konto / partner / amounts as when chosen; the nalog may have been re-posted)
  const taken = new Set<(typeof L)[number]>();
  const at = new Map<Target, (typeof L)[number]>();
  for (const t of T) {
    const byId = t.lineId != null ? L.find((l) => l.id === t.lineId && !taken.has(l)) : undefined;
    const hit = byId && byId.account === t.old.account && (byId.partnerId ?? null) === (t.old.partnerId ?? null) && byId.debit === num(t.debit) && byId.credit === num(t.credit)
      ? byId : rcFind(L, t, taken);
    if (!hit) throw new ReclassError('Ставката е изменета по изборот (налогот е прекнижан) – пребарајте повторно.');
    taken.add(hit);
    at.set(t, hit);
  }
  const path = T[0]!.path;
  const done = (t: Target, l: (typeof L)[number]): RcItem => ({
    path: t.path, journalId: j.id, number: j.number, date: j.date, lineNo: l.lineNo, debit: l.debit, credit: l.credit,
    old: t.old, new: t.new, ...(t.bankLineId ? { bankLineId: t.bankLineId } : {}), ...(t.lineId != null ? { lineId: t.lineId } : {}),
  });

  if (path === 'manual') {
    const lines = L.map((l) => {
      const t = [...at.entries()].find(([, x]) => x === l)?.[0];
      return { account: t ? t.new.account : l.account, partnerId: t ? t.new.partnerId : l.partnerId, debit: l.debit, credit: l.credit,
        note: l.note, doc: l.doc, currency: l.currency, amountCur: l.amountCur, locationId: l.locationId };
    });
    await updateJournal(tx, j.id, {
      firmId, date: j.date, kind: j.kind as never, description: j.description, number: j.number, periodFrom: j.periodFrom, periodTo: j.periodTo,
      meta: j.meta ?? {}, lines, userId, requirePartner: false, allowEmpty: false, auditAction: 'reclassRepost',
    });
    return T.map((t) => done(t, at.get(t)!));
  }

  if (path === 'doc') {
    const st = await journalOverrideState(tx, firmId, j.id);
    if (!st.rows) throw new ReclassError('Налогот не може да се коригира.');
    // posted lines = the rows that are not deleted, in order (base lines with their corrections, then the added lines)
    const live = st.rows.filter((r) => !r.del);
    if (live.length !== L.length) throw new ReclassError(`Налогот ${j.number} не е усогласен со документот – отворете го налогот и прекнижете го документот.`);
    const rows = st.rows.map((r) => ({ ...r }));
    const liveIdx = rows.map((r, i) => (r.del ? -1 : i)).filter((i) => i >= 0);
    for (const [t, l] of at) {
      const k = L.indexOf(l);
      const r = rows[liveIdx[k]!]!;
      if (r.account !== l.account || num(r.debit) !== l.debit || num(r.credit) !== l.credit) {
        throw new ReclassError(`Налогот ${j.number} не е усогласен со документот – отворете го налогот и прекнижете го документот.`);
      }
      r.account = t.new.account;
    }
    await saveJournalOverride(tx, { firmId, journalId: j.id, rows, userId });
    return T.map((t) => done(t, at.get(t)!));
  }

  // bank statement: change the statement lines and re-post the statement once
  if (!j.sourceId) throw new ReclassError('Налогот не е поврзан со извод.');
  const [s] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, j.sourceId), eq(bankStatements.firmId, firmId))).limit(1);
  if (!s) throw new ReclassError('Изводот не постои.');
  const [acct] = await tx.select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.id, s.bankAccountId)).limit(1);
  const BL = await tx.select().from(bankLines).where(eq(bankLines.statementId, s.id));
  const cand = BL.map((l) => ({ id: l.id, amount: num(l.amount), partnerId: l.partnerId, konto: l.konto || (l.refId ? bankEffKonto(toBankRow(l)) : ''), row: l }));
  const used = new Set<string>();
  const items: { lineId: string; konto?: string | null; partnerId?: string | null }[] = [];
  const out: RcItem[] = [];
  for (const [t, l] of at) {
    let hit: (typeof cand)[number] | { error: string } | undefined = t.bankLineId ? cand.find((c) => c.id === t.bankLineId) : undefined;
    if (!hit) hit = bankLineOf({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId }, cand.filter((c) => !used.has(c.id)), acct?.konto ?? '');
    if ('error' in hit) throw new ReclassError(hit.error);
    const b = hit.row;
    if (b.refId || b.refs?.length || b.split?.length) {
      throw new ReclassError(`Ставката од изводот е поврзана со ${b.refLabel ? 'документ ' + b.refLabel : 'фактура / поделена'} – прво раскинете ја врската во Банка, па рекнижете.`);
    }
    used.add(b.id);
    const kontoChanged = t.new.account !== l.account;
    items.push(kontoChanged ? { lineId: b.id, konto: t.new.account, partnerId: t.new.partnerId } : { lineId: b.id, partnerId: t.new.partnerId });
    out.push({ ...done(t, l), bankLineId: b.id });
  }
  await setLinesBulk(tx, { firmId, userId, items });
  return out;
}

/** Run targets grouped per nalog, each nalog in its own savepoint. */
async function runTargets(tx: Tx, firmId: string, userId: string | null, T: Target[], blocked: ReclassBlocked[]): Promise<{ items: RcItem[]; journals: number }> {
  const G = new Map<string, Target[]>();
  for (const t of T) (G.get(t.journalId) ?? G.set(t.journalId, []).get(t.journalId)!).push(t);
  const items: RcItem[] = [];
  let n = 0;
  for (const [jid, list] of G) {
    try {
      const done = await tx.transaction(async (sp) => runJournal(sp as unknown as Tx, firmId, userId, jid, list));
      items.push(...done);
      n++;
    } catch (e) {
      const m = errText(e);
      if (m == null) throw e;
      for (const t of list) blocked.push({ lineId: t.lineId, number: t.number, date: t.date, account: t.old.account, debit: t.debit, credit: t.credit, reason: m });
    }
  }
  return { items, journals: n };
}

/**
 * Apply a change to the chosen lines. `dryRun` = the preview: everything is done and rolled back, so the result shows
 * exactly which lines would change and which are refused (with the posting service's own reason, e.g. a closed VAT period).
 */
export async function reclassApply(tx: Tx, a: { firmId: string; userId: string | null; lineIds: readonly number[]; change: RcChange; dryRun?: boolean }): Promise<ReclassResult> {
  if (!a.lineIds.length) throw new ReclassError('Не се избрани ставки.');
  if (a.lineIds.length > MAX_LINES) throw new ReclassError(`Најмногу ${MAX_LINES} ставки одеднаш.`);
  if (!a.change.account?.trim() && a.change.partnerId === undefined) throw new ReclassError('Изберете ново конто и / или нов комитент.');
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!f) throw new ReclassError('Фирмата не постои.');
  const kontos = new Set((await effectiveChart(tx, a.firmId)).map((c) => c.code));
  const L = await reclassLines(tx, a.firmId, { ids: a.lineIds });
  const blocked: ReclassBlocked[] = [];
  const found = new Set(L.map((l) => l.id));
  for (const id of a.lineIds) if (!found.has(id)) blocked.push({ lineId: id, number: '', date: '', account: '', debit: 0, credit: 0, reason: 'Ставката повеќе не постои (налогот е прекнижан) – пребарајте повторно.' });
  const T: Target[] = [];
  for (const l of L) {
    const c = rcCheck(l, a.change, { lockDate: f.lockDate, kontos });
    if (!c.ok) { blocked.push({ lineId: l.id, number: l.number, date: l.date, account: l.account, debit: l.debit, credit: l.credit, reason: c.reason }); continue; }
    T.push({ lineId: l.id, path: c.path as RcItem['path'], journalId: l.journalId, number: l.number, date: l.date, lineNo: l.lineNo, debit: l.debit, credit: l.credit,
      old: { account: l.account, partnerId: l.partnerId }, new: { account: c.account, partnerId: c.partnerId } });
  }
  if (a.dryRun) {
    let res: { items: RcItem[]; journals: number } = { items: [], journals: 0 };
    try {
      await tx.transaction(async (sp) => { res = await runTargets(sp as unknown as Tx, a.firmId, a.userId, T, blocked); throw new DryRun(); });
    } catch (e) { if (!(e instanceof DryRun)) throw e; }
    return { batchId: null, items: res.items, blocked, journals: res.journals };
  }
  const res = await runTargets(tx, a.firmId, a.userId, T, blocked);
  if (!res.items.length) return { batchId: null, items: [], blocked, journals: 0 };
  const batchId = randomUUID();
  await audit(tx, {
    userId: a.userId, firmId: a.firmId, action: 'reclassBatch', entityType: 'reclass', entityId: batchId,
    data: { change: a.change, items: res.items, journals: res.journals, blocked: blocked.length },
  });
  return { batchId, items: res.items, blocked, journals: res.journals };
}

export interface ReclassBatch {
  id: string; at: Date; userId: string | null; change: RcChange; items: RcItem[]; journals: number; blocked: number;
  undone: { at: Date; userId: string | null; restored: number; skipped: number } | null;
}

/** The batches of the firm, newest first, with their undo (if any). */
export async function reclassBatches(tx: Tx, firmId: string, limit = 30): Promise<ReclassBatch[]> {
  const B = await tx.select().from(auditLog).where(and(eq(auditLog.firmId, firmId), eq(auditLog.action, 'reclassBatch'))).orderBy(desc(auditLog.at)).limit(limit);
  if (!B.length) return [];
  const U = await tx.select().from(auditLog).where(and(eq(auditLog.firmId, firmId), eq(auditLog.action, 'reclassUndo'), inArray(auditLog.entityId, B.map((b) => b.entityId!))));
  return B.map((b) => {
    const d = (b.data ?? {}) as { change?: RcChange; items?: RcItem[]; journals?: number; blocked?: number };
    const u = U.find((x) => x.entityId === b.entityId);
    const ud = (u?.data ?? {}) as { restored?: number; skipped?: number };
    return {
      id: b.entityId!, at: b.at, userId: b.userId, change: d.change ?? {}, items: d.items ?? [], journals: d.journals ?? 0, blocked: d.blocked ?? 0,
      undone: u ? { at: u.at, userId: u.userId, restored: ud.restored ?? 0, skipped: ud.skipped ?? 0 } : null,
    };
  });
}

/**
 * „↶ Врати“: the whole batch back (every changed line to its old konto / partner, the same paths). A line that was
 * changed again since, or is now in a locked period, is skipped with its reason. A batch is undone only once.
 */
export async function reclassUndo(tx: Tx, a: { firmId: string; userId: string | null; batchId: string }): Promise<{ restored: RcItem[]; skipped: ReclassBlocked[] }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'reclass:' + a.batchId}))`);
  const [b] = await tx.select().from(auditLog).where(and(eq(auditLog.firmId, a.firmId), eq(auditLog.action, 'reclassBatch'), eq(auditLog.entityId, a.batchId))).limit(1);
  if (!b) throw new ReclassError('Рекнижењето не постои.');
  const [u] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.firmId, a.firmId), eq(auditLog.action, 'reclassUndo'), eq(auditLog.entityId, a.batchId))).limit(1);
  if (u) throw new ReclassError('Ова рекнижење е веќе вратено.');
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const items = rcUndoItems(((b.data ?? {}) as { items?: RcItem[] }).items ?? []);
  const skipped: ReclassBlocked[] = [];
  const T: Target[] = [];
  const J = items.length ? await tx.select({ id: journals.id, locked: journals.locked }).from(journals).where(inArray(journals.id, [...new Set(items.map((i) => i.journalId))])) : [];
  for (const it of items) {
    const j = J.find((x) => x.id === it.journalId);
    const sk = (reason: string) => skipped.push({ number: it.number, date: it.date, account: it.old.account, debit: it.debit, credit: it.credit, reason });
    if (!j) { sk('Налогот е избришан.'); continue; }
    if (f?.lockDate && it.date <= f.lockDate) { sk(`Заклучен период (до ${f.lockDate.split('-').reverse().join('.')}).`); continue; }
    if (j.locked) { sk(`Налогот ${it.number} е заклучен.`); continue; }
    T.push({ ...it, lineId: undefined });
  }
  const res = await runTargets(tx, a.firmId, a.userId, T, skipped);
  if (!res.items.length) throw new ReclassError('Ништо не може да се врати' + (skipped[0] ? ': ' + skipped[0].reason : '.'));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'reclassUndo', entityType: 'reclass', entityId: a.batchId,
    data: { restored: res.items.length, skipped: skipped.length, items: res.items } });
  return { restored: res.items, skipped };
}
