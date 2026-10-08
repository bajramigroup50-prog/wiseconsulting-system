/**
 * Payroll & HR service (Phase 6) — the only writer of payroll runs, the HR registry and contracts.
 * Web server actions (and later the all-firms batch screen and the MPIN inbox) call these functions inside a
 * transaction; each writes its `audit_log` row and posts through the posting service.
 *
 * DELIBERATE FIXES (LEGACY-MAP 6.4):
 * - FIX(#18): legacy `pbGo`/`pbDel` (all-firms batch) and `mpinGo` wrote `firms/{id}/payroll` directly — no lock
 *   check, no audit. Here every path (single firm, batch, import) goes through `saveRun` / `postRun` / `deleteRun`,
 *   which check the run lock and the firm's period lock and audit every change.
 * - FIX(#12): a payroll run cannot be posted when the month was already booked from the УЈП MPIN acceptance
 *   (journal kind `mpin`), and `mpinAckPostAllowed` tells the (Phase 3) acceptance inbox not to post a month
 *   that a payroll run already booked.
 * - FIX(#10): parameter overrides are read per firm (office-wide rows first, firm rows win).
 * - FIX(#16/#17): HR registry numbers are assigned under an advisory lock and are unique per firm; the control
 *   code is stored on the registry row.
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  assertPayParams, empCalc, hrCtTypeName, payCatOf, hrDocCode, hrFixedTerm, hrNextNo, payNotesOpen, payrollEntries2, resolvePayParams,
  resolvePayScheme, monthEnd, PAY_RATE_KEYS, type HrContract, type HrDiDoc, type HrExtension, type PayCat, type PayEmp,
  type PayParamRow, type PayParams, type PayScheme,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { assertOpenPeriod, postJournal, PostingError, unpostSource } from './posting';
import { registerYearEndInputs } from './yearend';
import {
  appSettings, employees, firms, hrContracts, hrDocs, journals, payrollEmp, payrollLines, payrollNotes, payrollParams,
  payrollRuns, payrollSettings, type Employee, type Firm, type HrDoc, type PayrollRunRow,
} from './schema/index';

export type PayrollErrorCode = 'not_found' | 'locked' | 'empty' | 'notes_open' | 'mpin_double' | 'bad_month' | 'bad_input' | 'duplicate';

/** Domain error with a Macedonian message for the UI. */
export class PayrollError extends Error {
  constructor(readonly code: PayrollErrorCode, message: string) {
    super(message);
    this.name = 'PayrollError';
  }
}

const num = (v: string | number | null | undefined): number | undefined => (v == null || v === '' ? undefined : Number(v));
const s2 = (v: number | null | undefined): string | null => (v == null || !Number.isFinite(+v) ? null : String(v));
const mm = (month: string) => month.split('-').reverse().join('/');

/* ---------------- Parameters, scheme, settings ---------------- */

/** Override rows for `payRows`/`resolvePayParams`: office-wide rows, then the firm's rows (same month → firm wins). */
export async function loadPayOverrides(tx: Tx, firmId: string): Promise<PayParamRow[]> {
  const rows = await tx.select().from(payrollParams)
    .where(or(isNull(payrollParams.firmId), eq(payrollParams.firmId, firmId)))
    .orderBy(sql`${payrollParams.firmId} nulls first`, asc(payrollParams.from));
  return rows.map((r) => {
    const o: PayParamRow = { from: r.from, ...(r.src ? { src: r.src } : {}) };
    for (const k of PAY_RATE_KEYS) {
      const v = num(r[k]);
      if (v !== undefined) o[k] = v;
    }
    return o;
  });
}

/** Firm payroll settings row (created lazily). */
export async function loadPaySettings(tx: Tx, firmId: string) {
  const [s] = await tx.select().from(payrollSettings).where(eq(payrollSettings.firmId, firmId)).limit(1);
  return s ?? { firmId, scheme: {}, orders: {}, mpinTemplate: null, hrPrefix: null, groupMail: {}, updatedBy: null, updatedAt: new Date(0) };
}

/** Payroll accounts: payroll settings → firm posting scheme (`settings.sch`) → office scheme (`app_settings.schemes`) → defaults. */
export async function loadPayScheme(tx: Tx, firm: Pick<Firm, 'id' | 'settings'>): Promise<PayScheme> {
  const ps = await loadPaySettings(tx, firm.id);
  const [g] = await tx.select().from(appSettings).where(eq(appSettings.key, 'schemes')).limit(1);
  const gsch = ((g?.value as { sch?: Record<string, string> } | undefined)?.sch) ?? {};
  const fsch = ((firm.settings ?? {}) as { sch?: Record<string, string> }).sch ?? {};
  return resolvePayScheme({ ...fsch, ...ps.scheme }, gsch);
}

/* ---------------- Runs ---------------- */

/** Run row in the editor/core shape; flags `short`, `union`, `adv`, `noTax`, `inout`, `ioDate` are part of `PayEmp`. */
export type RunEmpInput = PayEmp;

export interface RunData {
  id: string;
  month: string;
  date: string;
  status: 'draft' | 'posted';
  locked: boolean;
  journalId: string | null;
  source: string;
  params: PayParams;
  emps: RunEmpInput[];
  totals: Record<string, number>;
}

const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Load a run with its employees and lines in the editor/core shape (`PayEmp`). */
export async function loadRun(tx: Tx, firmId: string, key: { id?: string; month?: string }): Promise<RunData | null> {
  const [r] = await tx.select().from(payrollRuns).where(and(
    eq(payrollRuns.firmId, firmId), key.id ? eq(payrollRuns.id, key.id) : eq(payrollRuns.month, key.month ?? ''),
  )).limit(1);
  if (!r) return null;
  const E = await tx.select().from(payrollEmp).where(eq(payrollEmp.runId, r.id)).orderBy(asc(payrollEmp.pos));
  const L = E.length ? await tx.select().from(payrollLines).where(eq(payrollLines.runId, r.id)).orderBy(asc(payrollLines.pos)) : [];
  const emps: RunEmpInput[] = E.map((e) => ({
    empId: e.employeeId ?? e.id,
    no: e.no ?? '',
    name: e.name,
    embg: e.embg ?? '',
    netBase: Number(e.netBase),
    ...(e.grossBase != null ? { grossBase: Number(e.grossBase) } : {}),
    coef: Number(e.coef),
    stazY: num(e.stazY) ?? 0,
    ...(e.hNorm != null ? { hNorm: Number(e.hNorm) } : {}),
    short: e.short, union: e.union, noTax: e.noTax, adv: e.adv,
    inout: (e.inout as PayEmp['inout']) || 'full',
    ...(e.ioDate ? { ioDate: e.ioDate } : {}),
    lines: L.filter((l) => l.runEmpId === e.id).map((l) => ({
      type: l.type, hours: Number(l.hours), pct: l.pct == null ? 100 : Number(l.pct), amt: Number(l.amt), cat: l.cat as PayCat,
      ...(l.code ? { code: l.code } : {}), ...(l.payer ? { payer: l.payer } : {}), ...(l.mpin ? { mpin: l.mpin } : {}),
    })),
  }));
  return {
    id: r.id, month: r.month, date: r.date, status: r.status, locked: r.locked, journalId: r.journalId, source: r.source,
    params: r.params as unknown as PayParams, emps, totals: r.totals,
  };
}

async function lockRun(tx: Tx, firmId: string, id: string): Promise<PayrollRunRow> {
  const [r] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.id, id))).for('update').limit(1);
  if (!r) throw new PayrollError('not_found', 'Пресметката не постои.');
  return r;
}

async function loadFirmRow(tx: Tx, firmId: string): Promise<Firm> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new PayrollError('not_found', 'Фирмата не постои.');
  return f;
}

function assertEditable(r: Pick<PayrollRunRow, 'locked' | 'month'>) {
  if (r.locked) throw new PayrollError('locked', `Месецот ${mm(r.month)} е заклучен – прво отклучете го.`);
}

function lockMsg(f: Firm, date: string) {
  try { assertOpenPeriod(f, date); } catch (e) {
    if (e instanceof PostingError) throw new PayrollError('locked', e.message);
    throw e;
  }
}

/** Snapshot totals of a run (and per employee). */
function runTotals(emps: readonly PayEmp[], P: PayParams) {
  const T = { gross: 0, net: 0, contr: 0, tax: 0, dopl: 0, ded: 0, emps: emps.length };
  const per = emps.map((e) => {
    const c = empCalc(e, P);
    T.gross += c.T.gross + c.T.dopl;
    T.net += c.T.net;
    T.contr += c.T.contr + c.T.dopl;
    T.tax += c.T.tax;
    T.dopl += c.T.dopl;
    T.ded += c.T.ded;
    return { gross: c.T.gross + c.T.dopl, net: c.T.net, contr: c.T.contr + c.T.dopl, tax: c.T.tax };
  });
  return { T, per };
}

export interface SaveRunInput {
  firmId: string;
  month: string;
  params: Partial<PayParams> | Record<string, unknown>;
  emps: readonly RunEmpInput[];
  userId: string | null;
  source?: string;
  /** Expected run id when editing (guards against two editors creating the same month). */
  runId?: string | null;
}

/**
 * Save the run's employees, hours and parameters (legacy draft → `save('payroll')`). A run that is already
 * posted is re-posted in the same transaction, so the journal always matches the stored data.
 */
export async function saveRun(tx: Tx, input: SaveRunInput): Promise<{ id: string; posted: boolean }> {
  const { firmId, month, userId } = input;
  if (!isMonth(month)) throw new PayrollError('bad_month', 'Внесете месец во облик ГГГГ-ММ.');
  const f = await loadFirmRow(tx, firmId);
  const date = monthEnd(month);
  lockMsg(f, date);
  const overrides = await loadPayOverrides(tx, firmId);
  let P: PayParams;
  try { P = resolvePayParams(input.params as Partial<PayParams>, month, overrides); } catch (e) {
    throw new PayrollError('bad_input', (e as Error).message);
  }
  P.pfrom = (input.params as { pfrom?: string }).pfrom ?? P.pfrom;
  const [ex] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.month, month))).for('update').limit(1);
  if (ex) assertEditable(ex);
  if (input.runId && ex && ex.id !== input.runId) throw new PayrollError('duplicate', `Пресметката за ${mm(month)} е веќе зачувана од друг корисник – отворете ја повторно.`);
  const emps = input.emps.map((e) => ({ ...e, lines: (e.lines ?? []).filter((l) => l && l.type) }));
  const { T, per } = runTotals(emps, P);
  let id: string;
  if (ex) {
    id = ex.id;
    await tx.update(payrollRuns).set({ params: P as unknown as Record<string, unknown>, totals: T, updatedBy: userId, date }).where(eq(payrollRuns.id, id));
    await tx.delete(payrollEmp).where(eq(payrollEmp.runId, id));
  } else {
    const [r] = await tx.insert(payrollRuns).values({
      firmId, month, date, params: P as unknown as Record<string, unknown>, totals: T, source: input.source ?? 'cal', createdBy: userId, updatedBy: userId,
    }).returning({ id: payrollRuns.id });
    id = r!.id;
  }
  const empIds = emps.map((e) => e.empId).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const known = new Set(empIds.length ? (await tx.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.firmId, firmId), inArray(employees.id, empIds)))).map((x) => x.id) : []);
  for (const [i, e] of emps.entries()) {
    const [row] = await tx.insert(payrollEmp).values({
      runId: id, firmId, employeeId: known.has(e.empId) ? e.empId : null, pos: i, no: e.no || null, name: e.name, embg: e.embg || null,
      netBase: String(+(e.netBase ?? 0) || 0), grossBase: e.grossBase ? String(+e.grossBase) : null, coef: String(+(e.coef ?? 1) || 1),
      stazY: s2(+(e.stazY ?? 0)), hNorm: e.hNorm ? String(+e.hNorm) : null,
      short: !!e.short, union: !!e.union, noTax: !!e.noTax, adv: !!e.adv, inout: e.inout || 'full', ioDate: e.ioDate || null,
      gross: String(per[i]!.gross), net: String(per[i]!.net), contr: String(per[i]!.contr), tax: String(per[i]!.tax),
    }).returning({ id: payrollEmp.id });
    const L = e.lines ?? [];
    if (L.length) {
      await tx.insert(payrollLines).values(L.map((l, j) => ({
        runEmpId: row!.id, runId: id, firmId, pos: j, type: l.type, code: l.code || null,
        // FIX(#14): every stored line has a category
        cat: (l.cat || payCatOf(l.type)) as string,
        hours: String(+(l.hours ?? 0) || 0), pct: l.pct === '' || l.pct == null ? null : String(+l.pct), amt: String(+(l.amt ?? 0) || 0),
        payer: l.payer || null, mpin: l.mpin || null,
      })).map((x) => ({ ...x, cat: ['reg', 'dop', 'bol', 'odm', 'kor', 'sin'].includes(x.cat) ? x.cat : 'reg' })));
    }
  }
  await audit(tx, { userId, firmId, action: ex ? 'savePay2' : 'payNewM', entityType: 'payroll_run', entityId: id,
    data: { month, emps: emps.length, net: T.net, gross: T.gross } });
  if (ex?.status === 'posted') {
    await postRunInner(tx, f, id, userId);
    return { id, posted: true };
  }
  return { id, posted: false };
}

/** Is the month already booked from the УЈП MPIN acceptance? (journal kind `mpin`) */
async function mpinJournalFor(tx: Tx, firmId: string, month: string) {
  const [j] = await tx.select({ id: journals.id, number: journals.number }).from(journals).where(and(
    eq(journals.firmId, firmId), eq(journals.kind, 'mpin'),
    or(eq(journals.sourceId, month), sql`${journals.meta}->>'month' = ${month}`),
  )).limit(1);
  return j ?? null;
}

/**
 * FIX(#12) for the Phase 3 MPIN-acceptance inbox: posting an acceptance as a `mpin` journal is allowed only
 * when no payroll run of that month is posted.
 */
export async function mpinAckPostAllowed(tx: Tx, firmId: string, month: string): Promise<boolean> {
  const [r] = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
    .where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.month, month), eq(payrollRuns.status, 'posted'))).limit(1);
  return !r;
}

async function postRunInner(tx: Tx, f: Firm, id: string, userId: string | null) {
  const r = await lockRun(tx, f.id, id);
  const run = (await loadRun(tx, f.id, { id }))!;
  if (!run.emps.length) throw new PayrollError('empty', 'Нема вработени во пресметката.');
  const notes = await tx.select().from(payrollNotes).where(and(eq(payrollNotes.firmId, f.id), eq(payrollNotes.done, false)));
  const open = payNotesOpen(notes, run.month);
  if (open.length) {
    throw new PayrollError('notes_open', `Има ${open.length} отворени известувања за промени (${open.map((n) => n.type + (n.empName ? ' – ' + n.empName : '')).join('; ')}). Внесете ги во платата и означете ги „✓ Внесено“.`);
  }
  const mj = await mpinJournalFor(tx, f.id, run.month);
  if (mj) throw new PayrollError('mpin_double', `Месецот ${mm(run.month)} е веќе прокнижен од прифатената МПИН пријава (налог ${mj.number}). Избришете го тој налог пред да ја книжите пресметката – инаку платата би била двапати книжена.`);
  const overrides = await loadPayOverrides(tx, f.id);
  const scheme = await loadPayScheme(tx, f);
  const P = resolvePayParams(run.params, run.month, overrides);
  assertPayParams(P);
  const lines = payrollEntries2({ month: run.month, params: P, emps: run.emps }, scheme, overrides);
  const j = await postJournal(tx, {
    firmId: f.id, date: run.date, kind: 'plati', sourceType: 'payroll', sourceId: id,
    description: `Плата ${mm(run.month)}`, lines, numbering: { payMonth: +run.month.slice(5, 7) },
    meta: { month: run.month }, userId, auditAction: r.status === 'posted' ? 'repostPayroll' : 'postPayroll',
  });
  await tx.update(payrollRuns).set({ status: 'posted', journalId: j.id, updatedBy: userId }).where(eq(payrollRuns.id, id));
  return j;
}

/** Calculate and post the run (legacy `savePay2`, F4). Returns the journal number. */
export async function postRun(tx: Tx, a: { firmId: string; runId: string; userId: string | null }): Promise<{ journalId: string; number: string }> {
  const f = await loadFirmRow(tx, a.firmId);
  const r = await lockRun(tx, a.firmId, a.runId);
  assertEditable(r);
  const j = await postRunInner(tx, f, a.runId, a.userId);
  return { journalId: j.id, number: j.number };
}

/** Remove the run's journal; the run stays as a draft. */
export async function unpostRun(tx: Tx, a: { firmId: string; runId: string; userId: string | null }): Promise<void> {
  const r = await lockRun(tx, a.firmId, a.runId);
  assertEditable(r);
  await unpostSource(tx, { firmId: a.firmId, sourceType: 'payroll', sourceId: r.id, userId: a.userId });
  await tx.update(payrollRuns).set({ status: 'draft', journalId: null, updatedBy: a.userId }).where(eq(payrollRuns.id, r.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'unpostPayroll', entityType: 'payroll_run', entityId: r.id, data: { month: r.month } });
}

/** Delete the run together with its journal (legacy `payDelM`). */
export async function deleteRun(tx: Tx, a: { firmId: string; runId: string; userId: string | null }): Promise<void> {
  const r = await lockRun(tx, a.firmId, a.runId);
  assertEditable(r);
  const f = await loadFirmRow(tx, a.firmId);
  lockMsg(f, r.date);
  await unpostSource(tx, { firmId: a.firmId, sourceType: 'payroll', sourceId: r.id, userId: a.userId });
  await tx.delete(payrollRuns).where(eq(payrollRuns.id, r.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'payDelM', entityType: 'payroll_run', entityId: r.id, data: { month: r.month, net: r.totals?.net } });
}

/** Lock / unlock a month (legacy `payLockM`; locking is blocked while pay-change notes are open). */
export async function setRunLocked(tx: Tx, a: { firmId: string; runId: string; locked: boolean; userId: string | null }): Promise<void> {
  const r = await lockRun(tx, a.firmId, a.runId);
  if (a.locked) {
    const notes = await tx.select().from(payrollNotes).where(and(eq(payrollNotes.firmId, a.firmId), eq(payrollNotes.done, false)));
    if (payNotesOpen(notes, r.month).length) throw new PayrollError('notes_open', 'Има отворени известувања за промени кај платите – месецот не може да се заклучи.');
  }
  await tx.update(payrollRuns).set({ locked: a.locked, updatedBy: a.userId }).where(eq(payrollRuns.id, r.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'payLockM', entityType: 'payroll_run', entityId: r.id, data: { month: r.month, locked: a.locked } });
}

/* ---------------- HR registry & contracts ---------------- */

export interface RegisterHrDocInput {
  firmId: string;
  employeeId: string | null;
  contractId?: string | null;
  kind: string;
  no?: string | null;
  date: string;
  empName: string;
  ctype?: string | null;
  start?: string | null;
  end?: string | null;
  days?: number | null;
  position?: string | null;
  refNo?: string | null;
  transform?: boolean;
  code?: string | null;
  title?: string | null;
  snap?: Record<string, unknown>;
  userId: string | null;
}

/** Next free registry number for the year of `date` (serialized per firm and year). */
export async function nextHrDocNo(tx: Tx, firmId: string, date: string): Promise<string> {
  const y = date.slice(0, 4);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'hrno:' + firmId + ':' + y}))`);
  const ps = await loadPaySettings(tx, firmId);
  const rows = await tx.select({ no: hrDocs.no, date: hrDocs.date }).from(hrDocs)
    .where(and(eq(hrDocs.firmId, firmId), sql`${hrDocs.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
  return hrNextNo(rows, date, ps.hrPrefix ?? '');
}

/** Register a document in the HR registry (legacy `hrRegister`); an empty number gets the next one (FIX #16). */
export async function registerHrDoc(tx: Tx, i: RegisterHrDocInput): Promise<HrDoc> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new PayrollError('bad_input', 'Внесете датум на документот.');
  const no = i.no?.trim() || (await nextHrDocNo(tx, i.firmId, i.date));
  const [dup] = await tx.select({ id: hrDocs.id, empName: hrDocs.empName }).from(hrDocs).where(and(eq(hrDocs.firmId, i.firmId), eq(hrDocs.no, no))).limit(1);
  if (dup) throw new PayrollError('duplicate', `Деловодниот број ${no} веќе е искористен (${dup.empName}).`);
  const [d] = await tx.insert(hrDocs).values({
    firmId: i.firmId, employeeId: i.employeeId, contractId: i.contractId ?? null, kind: i.kind, no, date: i.date, empName: i.empName,
    ctype: i.ctype ?? null, start: i.start || null, end: i.end || null, days: i.days == null ? null : String(i.days), position: i.position ?? null,
    refNo: i.refNo ?? null, transform: !!i.transform, code: i.code ?? null, title: i.title ?? null, snap: i.snap ?? {}, createdBy: i.userId,
  }).returning();
  await audit(tx, { userId: i.userId, firmId: i.firmId, action: 'hrRegister', entityType: 'hr_doc', entityId: d!.id, data: { kind: i.kind, no, empName: i.empName } });
  return d!;
}

async function loadEmployee(tx: Tx, firmId: string, id: string): Promise<Employee> {
  const [e] = await tx.select().from(employees).where(and(eq(employees.firmId, firmId), eq(employees.id, id))).limit(1);
  if (!e) throw new PayrollError('not_found', 'Вработениот не постои.');
  return e;
}

/**
 * Save the employment contract (legacy `ctSave` 7786 + `docReg` 15596): the contract becomes the employee's
 * current one, the employee card takes over the contract terms, and the contract is registered with a number
 * and a control code.
 */
export async function saveContract(tx: Tx, a: { firmId: string; employeeId: string; c: HrContract; userId: string | null }): Promise<{ contractId: string; doc: HrDoc }> {
  const e = await loadEmployee(tx, a.firmId, a.employeeId);
  const c: HrContract & Record<string, unknown> = { ...a.c };
  if (!c.start) throw new PayrollError('bad_input', 'Внесете датум на започнување.');
  if (hrFixedTerm(c.type) && !c.end) throw new PayrollError('bad_input', 'За определено време задолжително внесете датум до кога важи договорот.');
  c.signDate ||= c.start;
  c.no = c.no?.trim() || (await nextHrDocNo(tx, a.firmId, c.signDate));
  const fixed = hrFixedTerm(c.type);
  await tx.update(hrContracts).set({ current: false }).where(and(eq(hrContracts.employeeId, e.id), eq(hrContracts.current, true)));
  const { type, no, signDate, place, start, end, firstStart, reason, position, duties, workPlace, hours, probation, gross, net, leave, notice, rep, repRole, ...rest } = c;
  const [ct] = await tx.insert(hrContracts).values({
    firmId: a.firmId, employeeId: e.id, current: true, type, no, signDate, place: place || null, start, end: fixed ? end || null : null,
    firstStart: firstStart || start, reason: reason || null, position: position || null, duties: duties || null, workPlace: workPlace || null,
    hours: String(+hours || 40), probation: probation === '' || probation == null ? null : +probation, gross: s2(+gross || 0), net: s2(+net || 0),
    leave: +leave || 20, notice: +notice || 1, rep: rep || null, repRole: repRole || null, data: rest, createdBy: a.userId,
  }).returning({ id: hrContracts.id });
  await tx.update(employees).set({
    contract: fixed ? 'определено' : 'неопределено', start: start || e.start, end: fixed ? end || null : null,
    position: position || e.position, coef: +hours && +hours < 40 ? String(Math.round((+hours / 40) * 100) / 100) : e.coef,
    netBase: +net ? String(+net) : e.netBase, leaveDays: +leave || e.leaveDays,
  }).where(eq(employees.id, e.id));
  const code = hrDocCode({ t: 'ct', f: a.firmId, e: e.id, n: e.name, m: e.embg, a: e.address, o: { type, no, signDate, start, end, position, duties, gross, net, hours, leave, notice, probation, workPlace, rep, repRole } });
  const doc = await registerHrDoc(tx, {
    firmId: a.firmId, employeeId: e.id, contractId: ct!.id, kind: 'contract', no, date: signDate, empName: e.name, ctype: type, start,
    end: fixed ? end : null, position, code, title: 'Договор за вработување ' + hrCtTypeName(type), snap: { c }, userId: a.userId,
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ctSave', entityType: 'employee', entityId: e.id, data: { no, type, start, end } });
  return { contractId: ct!.id, doc };
}

/**
 * Extend a fixed-term contract or transform it to indefinite (legacy `extSave` 7780): annex or decision
 * registered, contract history kept in `data.hist`, employee end date updated.
 */
export async function extendContract(tx: Tx, a: { firmId: string; employeeId: string; x: HrExtension; userId: string | null }): Promise<HrDoc> {
  const e = await loadEmployee(tx, a.firmId, a.employeeId);
  const [ct] = await tx.select().from(hrContracts).where(and(eq(hrContracts.employeeId, e.id), eq(hrContracts.current, true))).for('update').limit(1);
  if (!ct) throw new PayrollError('not_found', 'Вработениот нема зачуван договор.');
  const x = a.x;
  if (x.kind === 'ext' && !x.end) throw new PayrollError('bad_input', 'Внесете нов датум „до“.');
  const tr = x.kind === 'transform';
  const hist = [...(((ct.data as { hist?: unknown[] }).hist) ?? []), { ...x, prevEnd: ct.end }];
  await tx.update(hrContracts).set({
    type: tr ? 'neopr' : ct.type, end: tr ? null : x.end!, firstStart: ct.firstStart || ct.start, data: { ...ct.data, hist },
  }).where(eq(hrContracts.id, ct.id));
  await tx.update(employees).set({ end: tr ? null : x.end!, contract: tr ? 'неопределено' : 'определено' }).where(eq(employees.id, e.id));
  const kind = x.doc === 'odluka' ? 'odluka' : 'annex';
  const c = { ...ct, data: undefined };
  return registerHrDoc(tx, {
    firmId: a.firmId, employeeId: e.id, contractId: ct.id, kind, no: x.no, date: x.date, empName: e.name, transform: tr,
    end: tr ? null : x.end, refNo: ct.no, position: ct.position, start: ct.firstStart || ct.start,
    code: hrDocCode({ t: 'ext', f: a.firmId, e: e.id, ref: ct.no, x }), snap: { c, x }, userId: a.userId,
  });
}

/** Save a disciplinary / termination document in the registry (legacy `diSave`). */
export async function saveDiDoc(tx: Tx, a: { firmId: string; employeeId: string; x: HrDiDoc; title: string; userId: string | null }): Promise<HrDoc> {
  const e = await loadEmployee(tx, a.firmId, a.employeeId);
  const code = hrDocCode({ t: 'di', f: a.firmId, e: e.id, n: e.name, x: a.x });
  return registerHrDoc(tx, {
    firmId: a.firmId, employeeId: e.id, kind: 'di-' + a.x.kind, no: a.x.no, date: a.x.date, empName: e.name, end: a.x.last ?? null,
    code, title: a.title, snap: { x: a.x }, userId: a.userId,
  });
}

/** Apply a termination (legacy `diApply`): end date, reason and document number on the employee; nothing deleted. */
export async function applyTermination(tx: Tx, a: { firmId: string; employeeId: string; last: string; reason: string; docNo?: string | null; userId: string | null }): Promise<void> {
  const e = await loadEmployee(tx, a.firmId, a.employeeId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.last)) throw new PayrollError('bad_input', 'Внесете последен работен ден.');
  await tx.update(employees).set({ end: a.last, endReason: a.reason, endDocNo: a.docNo || null }).where(eq(employees.id, e.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'diApply', entityType: 'employee', entityId: e.id, data: { last: a.last, reason: a.reason } });
}

/** Registry numbers used by other documents than `exceptId` (for contract warnings). */
export async function hrNumbersTaken(tx: Tx, firmId: string, exceptEmployeeId?: string): Promise<string[]> {
  const rows = await tx.select({ no: hrDocs.no }).from(hrDocs).where(and(
    eq(hrDocs.firmId, firmId), exceptEmployeeId ? or(ne(hrDocs.kind, 'contract'), ne(hrDocs.employeeId, exceptEmployeeId)) : undefined,
  ));
  return rows.map((r) => r.no);
}

/* ---------------- Year-end input (Phase 8: AOP bu214–216 / bu257) ---------------- */

/**
 * Payroll data for the annual statement (`YePayrollSource`): per month the number of employees in the posted run,
 * PIT and contributions (incl. the employer top-up); and the employees active at year end (bu257).
 */
export function payrollYearEndSource(getTx: () => Tx | Promise<Tx>) {
  return {
    async runs(firmId: string, year: number) {
      const tx = await getTx();
      const rows = await tx.select({
        month: payrollRuns.month, employees: sql<number>`count(${payrollEmp.id})::int`,
        tax: sql<string>`coalesce(sum(${payrollEmp.tax}),0)`, contrib: sql<string>`coalesce(sum(${payrollEmp.contr}),0)`,
      }).from(payrollRuns).innerJoin(payrollEmp, eq(payrollEmp.runId, payrollRuns.id))
        .where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.status, 'posted'), sql`${payrollRuns.month} like ${year + '-%'}`))
        .groupBy(payrollRuns.month).orderBy(asc(payrollRuns.month));
      return rows.map((r) => ({ month: r.month, employees: r.employees, tax: Number(r.tax), contrib: Number(r.contrib) }));
    },
    async activeEmployees(firmId: string, year: number) {
      const tx = await getTx();
      const end = `${year}-12-31`;
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(
        eq(employees.firmId, firmId), eq(employees.active, true),
        sql`(${employees.start} is null or ${employees.start} <= ${end})`, sql`(${employees.end} is null or ${employees.end} >= ${end})`,
      ));
      return r?.n ?? 0;
    },
  };
}

// Registered with the year-end service at load (resolves its TODO(merge)); reads through the app's pool.
registerYearEndInputs({ payroll: payrollYearEndSource(async () => (await import('./index')).getDb()) });
