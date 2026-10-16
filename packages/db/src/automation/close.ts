/**
 * P35 — „✅ Месечно затворање“ prepared: the facts of the month-closing tasks for many firms (the aggregated queries
 * of the `zatvoranje` screen, moved here so the screen and the nightly job use the same code), the nightly
 * `auto.close` pass that marks a firm / month „подготвено за заклучување“ when every task is ✓ — it NEVER locks —
 * and the owner's „Заклучи ги сите подготвени“ (re-checked live, one transaction per firm, audited).
 */
import { and, eq, inArray, like, ne, sql } from 'drizzle-orm';
import { ymAdd, zatMonthEnd, zatTasks, type ZatFacts, type ZatTask } from '@wise/core/firms/zatvoranje';
import { todaySkopje } from '@wise/core/office';
import { audit, type Tx } from '../audit';
import { bankStatements, employees, firms, invoices, journalLines, journals, payrollRuns, purchases, vatPeriods, type Firm } from '../schema/index';
import { autoFirms, autoOn, decideDraft, dropDraft, listDrafts, lockedAt, noteAutoRun, upsertDraft } from './common';

export const CLOSE_KIND = 'close';

type FirmLike = Pick<Firm, 'id' | 'vatRegistered' | 'vatPeriod' | 'lockDate'>;

/** Legacy `zatTasks` facts of the month for every firm, with a few aggregated queries. */
export async function zatFactsFor(tx: Pick<Tx, 'select'>, F: readonly FirmLike[], ym: string): Promise<Map<string, ZatFacts>> {
  const ms = ym + '-01', me = zatMonthEnd(ym), y0 = ym.slice(0, 4) + '-01-01';
  const ids = F.map((f) => f.id);
  const out = new Map<string, ZatFacts>();
  if (!ids.length) return out;
  const inM = (col: Parameters<typeof sql>[1]) => sql`${col} between ${ms} and ${me}`;
  const [ST, PU, IN, NO, CA, EM, PR, VP] = await Promise.all([
    tx.select({ f: bankStatements.firmId, n: sql<number>`count(*)::int` }).from(bankStatements).where(and(inArray(bankStatements.firmId, ids), inM(bankStatements.date))).groupBy(bankStatements.firmId),
    tx.select({ f: purchases.firmId, n: sql<number>`count(*)::int` }).from(purchases).where(and(inArray(purchases.firmId, ids), ne(purchases.status, 'draft'), inM(purchases.date))).groupBy(purchases.firmId),
    tx.select({ f: invoices.firmId, n: sql<number>`count(*)::int` }).from(invoices).where(and(inArray(invoices.firmId, ids), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), inM(invoices.date))).groupBy(invoices.firmId),
    tx.select({ f: invoices.firmId, no: invoices.number }).from(invoices).where(and(inArray(invoices.firmId, ids), eq(invoices.kind, 'invoice'), eq(invoices.advance, false), ne(invoices.status, 'draft'), sql`${invoices.date} between ${y0} and ${me}`)),
    tx.select({ f: journalLines.firmId, b: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(inArray(journalLines.firmId, ids), eq(journalLines.account, '1020'), sql`${journals.date} between ${y0} and ${me}`)).groupBy(journalLines.firmId),
    tx.select({ f: employees.firmId, n: sql<number>`count(*)::int` }).from(employees)
      .where(and(inArray(employees.firmId, ids), eq(employees.active, true), sql`(${employees.start} is null or ${employees.start} <= ${me}) and (${employees.end} is null or ${employees.end} >= ${ms})`)).groupBy(employees.firmId),
    tx.select({ f: payrollRuns.firmId, locked: payrollRuns.locked }).from(payrollRuns).where(and(inArray(payrollRuns.firmId, ids), eq(payrollRuns.month, ym))),
    tx.select({ f: vatPeriods.firmId, p: vatPeriods.period }).from(vatPeriods).where(and(inArray(vatPeriods.firmId, ids), eq(vatPeriods.status, 'closed'), like(vatPeriods.period, ym.slice(0, 4) + '%'))),
  ]);
  const cnt = (L: { f: string; n: number }[]) => new Map(L.map((r) => [r.f, r.n]));
  const st = cnt(ST), pu = cnt(PU), inv = cnt(IN), em = cnt(EM);
  const nos = new Map<string, string[]>(); for (const r of NO) nos.set(r.f, [...(nos.get(r.f) ?? []), r.no]);
  const ca = new Map(CA.map((r) => [r.f, Number(r.b) || 0]));
  const pr = new Map(PR.map((r) => [r.f, { exists: true, locked: r.locked }]));
  const vp = new Map<string, Set<string>>(); for (const r of VP) vp.set(r.f, (vp.get(r.f) ?? new Set()).add(r.p));
  for (const f of F) {
    out.set(f.id, {
      vat: f.vatRegistered, vatPeriod: f.vatPeriod, lockDate: f.lockDate, statements: st.get(f.id) ?? 0, invoices: inv.get(f.id) ?? 0,
      purchases: pu.get(f.id) ?? 0, invoiceNumbers: nos.get(f.id) ?? [], cash: { any: ca.has(f.id), balance: Math.round((ca.get(f.id) ?? 0) * 100) / 100 },
      activeEmployees: em.get(f.id) ?? 0, payrollRun: pr.get(f.id) ?? null, vatClosed: vp.get(f.id) ?? new Set(),
    });
  }
  return out;
}

/** Every task done (✓ or not applicable) — the lock itself aside. */
export const zatReady = (T: readonly ZatTask[]): boolean => T.every((t) => t.k === 'lock' || t.ok !== false);

export interface AutoCloseResult { month: string; firms: number; ready: number; locked: number; skipped: boolean }

/** Nightly: mark the previous month „подготвено за заклучување“ per firm (never locks). */
export async function runAutoClose(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoCloseResult> {
  const today = o.today ?? todaySkopje();
  const ym = ymAdd(today.slice(0, 7), -1);
  if (!o.force && !(await autoOn(db, 'close'))) return { month: ym, firms: 0, ready: 0, locked: 0, skipped: true };
  const me = zatMonthEnd(ym);
  const F = await autoFirms(db);
  const facts = await zatFactsFor(db, F, ym);
  let ready = 0, locked = 0;
  for (const f of F) {
    const T = zatTasks(facts.get(f.id)!, ym);
    await db.transaction(async (tx) => {
      // 🔒 already locked: nothing to prepare (a waiting draft of it is settled)
      if (lockedAt(f, me)) {
        locked++;
        const [d] = await listDrafts(tx, { kind: CLOSE_KIND, firmIds: [f.id], period: ym });
        if (d) await decideDraft(tx, d.id, 'confirmed', null, { lockedElsewhere: true });
        return;
      }
      if (zatReady(T)) {
        ready++;
        await upsertDraft(tx, { kind: CLOSE_KIND, firmId: f.id, period: ym, data: { tasks: T.filter((t) => t.ok !== null && t.k !== 'lock').map((t) => t.n), lockDate: me } });
      } else await dropDraft(tx, CLOSE_KIND, f.id, ym);
    });
  }
  await noteAutoRun(db, 'close', `${ym}: подготвени за заклучување ${ready} од ${F.length - locked} фирми`, { month: ym, ready });
  return { month: ym, firms: F.length, ready, locked, skipped: false };
}

/** Legacy `zatLock`: lock the firm's books to the month end (never moves the lock back). Audited. */
export async function lockFirmMonth(tx: Tx, firmId: string, ym: string, userId: string | null, data: Record<string, unknown> = {}): Promise<{ error?: string; ok?: string }> {
  const me = zatMonthEnd(ym);
  const [f] = await tx.select({ name: firms.name, lock: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) return { error: 'Фирмата не постои.' };
  if (f.lock && f.lock >= me) return { error: `Фирмата е веќе заклучена до ${f.lock.split('-').reverse().join('.')}.` };
  await tx.update(firms).set({ lockDate: me }).where(eq(firms.id, firmId));
  await audit(tx, { userId, firmId, action: 'zatLock', entityType: 'firm', entityId: firmId, data: { lockDate: me, before: f.lock, ...data } });
  return { ok: `${f.name}: заклучено до ${me.split('-').reverse().join('.')}.` };
}

/**
 * „Заклучи ги сите подготвени“ (owner / administrator — checked by the caller): lock every firm whose month draft is
 * waiting and is STILL ready when re-checked now. `firmIds` limits it to the caller's firms.
 */
export async function lockPreparedMonths(db: Tx, a: { ym: string; userId: string; firmIds?: readonly string[] }): Promise<{ locked: string[]; skipped: string[] }> {
  const D = await listDrafts(db, { kind: CLOSE_KIND, period: a.ym, firmIds: a.firmIds });
  const F = await autoFirms(db, { ids: D.map((d) => d.firmId) });
  const facts = await zatFactsFor(db, F, a.ym);
  const locked: string[] = [], skipped: string[] = [];
  for (const d of D) {
    const f = F.find((x) => x.id === d.firmId);
    if (!f) continue;
    if (!zatReady(zatTasks(facts.get(f.id)!, a.ym))) { skipped.push(`${f.name}: веќе не е подготвено`); continue; }
    const r = await db.transaction(async (tx) => {
      const r = await lockFirmMonth(tx, f.id, a.ym, a.userId, { auto: true });
      await decideDraft(tx, d.id, 'confirmed', a.userId);
      return r;
    });
    if (r.ok) locked.push(f.name); else skipped.push(`${f.name}: ${r.error}`);
  }
  await audit(db, { userId: a.userId, action: 'autoCloseLockAll', entityType: 'automation', data: { month: a.ym, locked: locked.length, skipped: skipped.length } });
  return { locked, skipped };
}
