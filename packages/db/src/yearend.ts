/**
 * Year-end service (Phase 8): reads the posted ledger into the `@wise/core` year-end engine and posts the year-end
 * journals through the posting service — depreciation `dep-<Y>`, close `close-<Y>` (nalog 999), opening
 * `open-<Y+1>` (nalog 0) — together with the year-closing / annual-statement rows and the audit trail, all inside the
 * caller's transaction.
 *
 * This is the ONE year close: the Phase 2 stopgap on the opening-balance page (flat 10 % tax) now calls
 * {@link closeYear} / {@link openNextYear} too.
 *
 * Gate (FIX P8 #15): legacy gated only `closeYear`, `crmXmlDl`, `zyGen` with `zcGate`; `undoClose` had no confirmation,
 * `openYear`/`doTransfer` no gate and `lockYear` wrote the lock without audit. Here close, open and lock all require
 * the phase gate to be clear (`zcOpen` = no unacknowledged blocking finding) and every action is audited.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  clearCrmImport, crmImportPatch, deAuto, depEntries, depFor, deVals, f35Rows, parseCrmXml, r2, obRebuild, yeClosePlan, yeComputeYear,
  yeEntityOf, yeInputsFromLedger, yeManualOnly, yeMergePayroll, yeOpenPlan, yePayrollFromLedger, zcFindings, zcOpen, zsRules,
  type CrmFirmState, type CrmImportUndo, type DepRow, type LedgerLine, type ObRebuildRow, type YeEntity, type YeLedgerInputs,
  type YePayrollSource, type YeYear, type YeYearSettings, type ZcFinding, type ZcInput, type ZsResult, type ZsRule,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { loadLedgerLines } from './ledger-queries';
import { PostingError, postJournal, unpostSource } from './posting';
import {
  annualStatements, depreciationRuns, firms, fixedAssets, journals, yearClosings,
  type AnnualStatement, type Firm, type FixedAsset, type Journal, type YearClosing,
} from './schema/index';

/* ------------------------------------------------------------------ */
/* Inputs from other modules                                          */
/* ------------------------------------------------------------------ */

/**
 * Data the year-end needs from modules built in parallel phases. Each is optional; without it the engine reads what
 * it can from the ledger (payroll totals from `plati` journals) and the gate skips the check.
 *
 * Phase 6 registers `payroll` (`payrollYearEndSource` in ./payroll, at module load — employee counts, bu214–216 / bu257).
 * TODO(merge): Phases 3/4/7/9 register `findings` (bank statement lines and accounts, stock moves and items, invoices, purchases,
 * documents pending approval) for `zcFindings`. Call {@link registerYearEndInputs} once at app start-up.
 */
export interface YearEndExternalInputs {
  payroll?: YePayrollSource;
  findings?: (tx: Tx, firmId: string, year: number) => Promise<Partial<Omit<ZcInput, 'year' | 'today' | 'lines'>>>;
}
let external: YearEndExternalInputs = {};
export function registerYearEndInputs(x: YearEndExternalInputs): void {
  external = { ...external, ...x };
}

/* ------------------------------------------------------------------ */
/* Sources                                                            */
/* ------------------------------------------------------------------ */

export const YE_SOURCE = {
  close: { type: 'yearClose', id: (y: number) => `close-${y}` },
  open: { type: 'opening', id: (y: number) => `open-${y}` },
  bbimp: { type: 'bbimp', id: (y: number) => `bbimp-${y}` },
  dep: { type: 'depreciation', id: (y: number) => `dep-${y}` },
} as const;

const settingsOf = (f: Pick<Firm, 'settings'>) => (f.settings ?? {}) as Record<string, unknown>;
export const firmEntity = (f: Pick<Firm, 'settings' | 'legalForm' | 'name'>): YeEntity =>
  yeEntityOf({ ent: settingsOf(f).ent, legalForm: f.legalForm, name: f.name });
export const firmRules = (f: Pick<Firm, 'settings'>): readonly ZsRule[] => zsRules((settingsOf(f).zsRules as ZsRule[] | undefined) ?? null);

async function sourceJournal(tx: Tx, firmId: string, s: { type: string; id: (y: number) => string }, y: number): Promise<Journal | null> {
  const [j] = await tx.select().from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, s.type), eq(journals.sourceId, s.id(y)))).limit(1);
  return j ?? null;
}

/** The closing journal of the year: the year-end close, or any other journal of kind `close` dated in the year. */
export async function closeJournalOf(tx: Tx, firmId: string, year: number): Promise<Journal | null> {
  const own = await sourceJournal(tx, firmId, YE_SOURCE.close, year);
  if (own) return own;
  const [j] = await tx.select().from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.kind, 'close'), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).limit(1);
  return j ?? null;
}

/* ------------------------------------------------------------------ */
/* Annual statement row (per-year settings)                           */
/* ------------------------------------------------------------------ */

export type StatementPatch = Partial<Pick<AnnualStatement,
  'status' | 'aop' | 'zsMan' | 'deMan' | 'f35Raw' | 'crmImport' | 'crmPeriod' | 'dbAdj' | 'vpAdj' | 'dldAdj' | 'notes' | 'ack' | 'submittedAt' | 'submittedBy'>>;

export async function getStatement(tx: Tx, firmId: string, year: number): Promise<AnnualStatement | null> {
  const [r] = await tx.select().from(annualStatements).where(and(eq(annualStatements.firmId, firmId), eq(annualStatements.year, year))).limit(1);
  return r ?? null;
}

export async function upsertStatement(tx: Tx, firmId: string, year: number, patch: StatementPatch, userId: string | null): Promise<AnnualStatement> {
  const [r] = await tx.insert(annualStatements).values({ firmId, year, ...patch, updatedBy: userId })
    .onConflictDoUpdate({ target: [annualStatements.firmId, annualStatements.year], set: { ...patch, updatedBy: userId, updatedAt: new Date() } })
    .returning();
  return r!;
}

/** Per-year settings for the engine from the statement row. */
export const statementSettings = (s: AnnualStatement | null): YeYearSettings => ({
  zsMan: s && Object.keys(s.zsMan).length ? s.zsMan : null,
  dbAdj: s && Object.keys(s.dbAdj).length ? s.dbAdj : null,
  vpAdj: s && Object.keys(s.vpAdj).length ? (s.vpAdj as YeYearSettings['vpAdj']) : null,
  dldAdj: s && Object.keys(s.dldAdj).length ? s.dldAdj : null,
});

/* ------------------------------------------------------------------ */
/* Loading a year                                                     */
/* ------------------------------------------------------------------ */

export interface LoadedYear {
  firm: Firm;
  year: number;
  ent: YeEntity;
  rules: readonly ZsRule[];
  lines: LedgerLine[];
  inputs: YeLedgerInputs;
  closeJournal: Journal | null;
  openJournal: Journal | null;
  closing: YearClosing | null;
  statement: AnnualStatement | null;
  settings: YeYearSettings;
  /** engine result for the year */
  Y: YeYear;
  /** AOP values of the previous year (ledger or manual/imported amounts) */
  prev: ZsResult;
  prevStatement: AnnualStatement | null;
  locked: boolean;
}

async function payrollFor(firmId: string, year: number, lines: readonly LedgerLine[]) {
  const fromLedger = yePayrollFromLedger(lines);
  const fromModule = external.payroll ? await external.payroll.runs(firmId, year) : [];
  const active = external.payroll ? await external.payroll.activeEmployees(firmId, year) : 0;
  let runs = yeMergePayroll(fromModule, fromLedger);
  // the ledger has no head count: use the active employees for months the payroll module did not report
  if (active) runs = runs.map((r) => (r.employees ? r : { ...r, employees: active }));
  return { runs, active };
}

async function computeFor(tx: Tx, f: Firm, year: number, lines: LedgerLine[], st: AnnualStatement | null, closeJ: Journal | null) {
  const ent = firmEntity(f);
  const rules = firmRules(f);
  const inputs = yeInputsFromLedger(lines);
  const settings = statementSettings(st);
  const pay = await payrollFor(f.id, year, lines);
  const s = settingsOf(f);
  const metaTax = closeJ?.meta && typeof (closeJ.meta as Record<string, unknown>).tax === 'number' ? (closeJ.meta as { tax: number }).tax : undefined;
  const Y = yeComputeYear({
    year, ent, inputs, settings, rules, accounts: (s.accounts as Record<string, unknown>) ?? null, payroll: pay.runs, activeEmployees: pay.active,
    regDate: String(s.regDate || s.founded || ''), firm: { name: f.name, activity: f.activity }, closeTax: metaTax,
  });
  return { ent, rules, inputs, settings, Y };
}

export async function loadYear(tx: Tx, firmId: string, year: number): Promise<LoadedYear> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  const [lines, closeJournal, openJournal, closingRows, statement, prevStatement, prevLines] = await Promise.all([
    loadLedgerLines(tx, firmId, `${year}-01-01`, `${year}-12-31`),
    closeJournalOf(tx, firmId, year),
    sourceJournal(tx, firmId, YE_SOURCE.open, year + 1),
    tx.select().from(yearClosings).where(and(eq(yearClosings.firmId, firmId), eq(yearClosings.year, year))).limit(1),
    getStatement(tx, firmId, year),
    getStatement(tx, firmId, year - 1),
    loadLedgerLines(tx, firmId, `${year - 1}-01-01`, `${year - 1}-12-31`),
  ]);
  const c = await computeFor(tx, f, year, lines, statement, closeJournal);
  let prev: ZsResult;
  if (prevLines.length) {
    const pc = await computeFor(tx, f, year - 1, prevLines, prevStatement, await closeJournalOf(tx, firmId, year - 1));
    prev = pc.Y.co.zs;
  } else prev = yeManualOnly(year - 1, prevStatement?.zsMan, c.rules);
  return {
    firm: f, year, ...c, lines, closeJournal, openJournal, closing: closingRows[0] ?? null, statement, prevStatement, prev,
    locked: !!f.lockDate && f.lockDate >= `${year}-12-31`,
  };
}

/* ------------------------------------------------------------------ */
/* Phase gate                                                         */
/* ------------------------------------------------------------------ */

const SRC_OF_KIND: Record<string, string> = { izlez: 'Излез', vlez: 'Влез', vlezDev: 'Влез', open: 'Почетна' };

export async function yearFindings(tx: Tx, L: LoadedYear, today: string): Promise<{ all: ZcFinding[]; open: ZcFinding[] }> {
  const [assets, ids, ext] = await Promise.all([
    tx.select({ cost: fixedAssets.cost, date: fixedAssets.date, vehicleOnly: fixedAssets.vehicleOnly, disposed: fixedAssets.disposed })
      .from(fixedAssets).where(eq(fixedAssets.firmId, L.firm.id)),
    tx.select({ s: journals.sourceId }).from(journals)
      .where(and(eq(journals.firmId, L.firm.id), sql`${journals.date} between ${L.year + '-01-01'} and ${L.year + '-12-31'}`, sql`${journals.sourceId} is not null`)),
    external.findings ? external.findings(tx, L.firm.id, L.year) : Promise.resolve({}),
  ]);
  const all = zcFindings({
    year: L.year, today,
    lines: L.lines.filter((l) => l.kind !== 'close').map((l) => ({
      k: l.account, d: l.debit, p: l.credit, partner: l.partnerId, date: l.date, src: SRC_OF_KIND[l.kind ?? ''] ?? '',
    })),
    // an asset disposed before the year has nothing left to depreciate
    assets: assets.filter((a) => !a.disposed || a.disposed >= `${L.year}-01-01`).map((a) => ({ cost: Number(a.cost), date: a.date, vehicleOnly: a.vehicleOnly })),
    journalIds: ids.map((r) => r.s!),
    ...ext,
  });
  return { all, open: zcOpen(all, L.statement?.ack) };
}

function assertGate(open: readonly ZcFinding[], what: string): void {
  if (open.length) {
    throw new PostingError('locked', `${what}: има ${open.length} неразрешени наоди во контролата (${open.slice(0, 3).map((x) => x.area).join(', ')}…). Средете ги или означете ги како проверени во „Контрола“.`);
  }
}

/* ------------------------------------------------------------------ */
/* Close / undo / open / lock                                         */
/* ------------------------------------------------------------------ */

export interface YeActionInput { firmId: string; year: number; userId: string | null; today: string }

async function upsertClosing(tx: Tx, firmId: string, year: number, set: Partial<YearClosing>): Promise<void> {
  await tx.insert(yearClosings).values({ firmId, year, ...set })
    .onConflictDoUpdate({ target: [yearClosings.firmId, yearClosings.year], set: { ...set, updatedAt: new Date() } });
}

/** Post (or re-compute) the close of the year (legacy `closeYear` 6732 behind `zcGate`). */
export async function closeYear(tx: Tx, a: YeActionInput) {
  const L = await loadYear(tx, a.firmId, a.year);
  if (L.closeJournal && L.closeJournal.sourceType !== YE_SOURCE.close.type) {
    throw new PostingError('locked', `За ${a.year} веќе постои налог за затворање (${L.closeJournal.number}) што не е од завршната сметка – избришете го во „Налози“.`);
  }
  if (L.closing?.imported) {
    throw new PostingError('locked', `Затворањето за ${a.year} е од увезен бруто биланс по затворање – за повторна пресметка избришете го увозот во „Почетна состојба“.`);
  }
  if (L.openJournal) throw new PostingError('locked', `Почетната состојба за ${a.year + 1} е веќе пренесена – прво поништете ја, па затворете повторно.`);
  assertGate((await yearFindings(tx, L, a.today)).open, 'Годината не може да се затвори');
  const plan = yeClosePlan({
    year: a.year, ent: L.ent, inputs: L.inputs, settings: L.settings, rules: L.rules, accounts: (settingsOf(L.firm).accounts as Record<string, unknown>) ?? null,
    firm: { name: L.firm.name, activity: L.firm.activity },
  });
  if (!plan.lines.length) throw new PostingError('empty', `Нема приходи и расходи за затворање во ${a.year}.`);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: `${a.year}-12-31`, kind: 'close', sourceType: YE_SOURCE.close.type, sourceId: YE_SOURCE.close.id(a.year),
    description: `Затворање на сметки и утврдување на резултат ${a.year}`, lines: plan.lines, userId: a.userId, requirePartner: false,
    meta: { profit: plan.profit, tax: plan.tax, net: plan.net, taxSource: plan.taxSource, entity: L.ent }, auditAction: 'closeYear',
  });
  const db = plan.before.co.db;
  await upsertClosing(tx, a.firmId, a.year, {
    status: 'closed', entity: L.ent, closeJournalId: j.id, profit: String(plan.profit), tax: String(plan.tax), net: String(plan.net), imported: false,
    db: { taxSource: plan.taxSource, V: db.V, base: db.base, tax: db.tax, ak: db.ak, diff: db.diff, vp: plan.before.vp.tax, dld: plan.before.tp?.tax ?? null, npo: plan.before.npo?.tax ?? null },
    closedAt: new Date(), closedBy: a.userId,
  });
  return { journal: j, plan };
}

/**
 * Undo the close (legacy `undoClose` 7380: deleted `close-Y` with no confirmation and no gate). Now: the caller checks
 * the permission and asks for confirmation; refused while the next year's opening exists or the year is locked
 * (the posting service enforces the lock date); audited.
 */
export async function undoClose(tx: Tx, a: Omit<YeActionInput, 'today'>) {
  const open = await sourceJournal(tx, a.firmId, YE_SOURCE.open, a.year + 1);
  if (open) throw new PostingError('locked', `Почетната состојба за ${a.year + 1} е пренесена од оваа година – прво поништете ја.`);
  const n = await unpostSource(tx, { firmId: a.firmId, sourceType: YE_SOURCE.close.type, sourceId: YE_SOURCE.close.id(a.year), userId: a.userId });
  if (!n) throw new PostingError('not_found', `Годината ${a.year} не е затворена.`);
  await upsertClosing(tx, a.firmId, a.year, { status: 'open', closeJournalId: null, profit: null, tax: null, net: null, imported: false, closedAt: null, closedBy: null });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'undoClose', entityType: 'year', entityId: String(a.year) });
}

/** Carry the closed year into the next year's opening balance (legacy `openYear` 6744 / `doTransfer` 7325, now gated). */
export async function openNextYear(tx: Tx, a: YeActionInput) {
  const L = await loadYear(tx, a.firmId, a.year);
  if (!L.closeJournal) throw new PostingError('locked', `Прво затворете ја ${a.year} (налог за затворање на сметките).`);
  assertGate((await yearFindings(tx, L, a.today)).open, 'Почетната состојба не може да се пренесе');
  const lines = yeOpenPlan(L.inputs);
  if (!lines.length) throw new PostingError('empty', `Нема салда за пренос од ${a.year}.`);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: `${a.year + 1}-01-01`, kind: 'open', sourceType: YE_SOURCE.open.type, sourceId: YE_SOURCE.open.id(a.year + 1),
    description: `Почетна состојба ${a.year + 1}`, userId: a.userId, requirePartner: false, auditAction: 'doTransfer',
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partner ?? null })),
  });
  await upsertClosing(tx, a.firmId, a.year, { status: L.locked ? 'locked' : 'carried', openJournalId: j.id, openedAt: new Date(), openedBy: a.userId });
  return { journal: j, lines: lines.length };
}

/** Undo the carry-forward (delete `open-<Y+1>`). */
export async function undoOpen(tx: Tx, a: Omit<YeActionInput, 'today'>) {
  const n = await unpostSource(tx, { firmId: a.firmId, sourceType: YE_SOURCE.open.type, sourceId: YE_SOURCE.open.id(a.year + 1), userId: a.userId });
  if (!n) throw new PostingError('not_found', `Нема пренесена почетна состојба за ${a.year + 1}.`);
  const [c] = await tx.select().from(yearClosings).where(and(eq(yearClosings.firmId, a.firmId), eq(yearClosings.year, a.year))).limit(1);
  if (c) await upsertClosing(tx, a.firmId, a.year, { status: c.status === 'locked' ? 'locked' : c.closeJournalId ? 'closed' : 'open', openJournalId: null, openedAt: null, openedBy: null });
}

/** Lock the year (legacy `lockYear` 7382: wrote `firms.lock` directly, no audit, no gate). */
export async function lockYear(tx: Tx, a: YeActionInput) {
  const L = await loadYear(tx, a.firmId, a.year);
  if (!L.closeJournal) throw new PostingError('locked', `Прво затворете ја ${a.year}.`);
  assertGate((await yearFindings(tx, L, a.today)).open, 'Годината не може да се заклучи');
  const lock = `${a.year}-12-31`;
  const before = L.firm.lockDate;
  if (!before || before < lock) await tx.update(firms).set({ lockDate: lock }).where(eq(firms.id, a.firmId));
  await upsertClosing(tx, a.firmId, a.year, { status: 'locked', lockedAt: new Date(), lockedBy: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'lockYear', entityType: 'firm', entityId: a.firmId, data: { year: a.year, from: before, to: lock } });
}

/** Admin: move the lock back to the end of the previous year (legacy `firmUnlock` 17021). */
export async function unlockYear(tx: Tx, a: Omit<YeActionInput, 'today'>) {
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const to = `${a.year - 1}-12-31`;
  await tx.update(firms).set({ lockDate: to }).where(eq(firms.id, a.firmId));
  const [c] = await tx.select().from(yearClosings).where(and(eq(yearClosings.firmId, a.firmId), eq(yearClosings.year, a.year))).limit(1);
  if (c) await upsertClosing(tx, a.firmId, a.year, { status: c.openJournalId ? 'carried' : c.closeJournalId ? 'closed' : 'open', lockedAt: null, lockedBy: null });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'firmUnlock', entityType: 'firm', entityId: a.firmId, data: { year: a.year, from: f?.lockDate ?? null, to } });
}

/* ------------------------------------------------------------------ */
/* Trial balance imported after the close (obRebuild)                 */
/* ------------------------------------------------------------------ */

/**
 * Save a post-close trial balance as `bbimp-<Y>` with classes 4/7 rebuilt from turnover, plus the imported closing
 * journal (legacy `obRebuild` + `ACT.saveOpen` wrapper 17173). Returns null when the trial balance is not post-close.
 */
export async function importPostCloseTb(tx: Tx, a: Omit<YeActionInput, 'today'> & { rows: readonly ObRebuildRow[] }) {
  const X = obRebuild(a.rows);
  if (!X) return null;
  if (!X.close.ok) throw new PostingError('unbalanced', 'Налогот за затворање од увезениот бруто биланс не е изедначен.');
  const own = await closeJournalOf(tx, a.firmId, a.year);
  if (own && own.sourceType !== YE_SOURCE.close.type) throw new PostingError('locked', `За ${a.year} веќе постои друг налог за затворање (${own.number}).`);
  const bb = await postJournal(tx, {
    firmId: a.firmId, date: `${a.year}-12-31`, kind: 'bbimp', sourceType: YE_SOURCE.bbimp.type, sourceId: YE_SOURCE.bbimp.id(a.year),
    description: `Бруто биланс ${a.year} (увоз по затворање)`, userId: a.userId, requirePartner: false, auditAction: 'saveOpen',
    lines: X.rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit, partnerId: r.partnerId ?? null })),
  });
  const cl = await postJournal(tx, {
    firmId: a.firmId, date: `${a.year}-12-31`, kind: 'close', sourceType: YE_SOURCE.close.type, sourceId: YE_SOURCE.close.id(a.year),
    description: `Затворање ${a.year} (од увезен бруто биланс по затворање)`, userId: a.userId, requirePartner: false, auditAction: 'closeYear',
    lines: X.close.lines, meta: { imported: true, profit: X.close.profit, tax: X.close.tax, net: X.close.net },
  });
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  await upsertClosing(tx, a.firmId, a.year, {
    status: 'closed', entity: f ? firmEntity(f) : null, closeJournalId: cl.id, imported: true,
    profit: String(X.close.profit), tax: String(X.close.tax), net: String(X.close.net), closedAt: new Date(), closedBy: a.userId, db: { taxSource: 'imported' },
  });
  return { bbimp: bb, close: cl, ...X.close };
}

/** The imported trial balance was deleted: remove the close that was rebuilt from it (legacy `ACT.bbImpDel` wrapper 17176). */
export async function afterImportedTbDeleted(tx: Tx, a: Omit<YeActionInput, 'today'>): Promise<boolean> {
  const [c] = await tx.select().from(yearClosings).where(and(eq(yearClosings.firmId, a.firmId), eq(yearClosings.year, a.year))).limit(1);
  if (!c?.imported) return false;
  await unpostSource(tx, { firmId: a.firmId, sourceType: YE_SOURCE.close.type, sourceId: YE_SOURCE.close.id(a.year), userId: a.userId });
  await upsertClosing(tx, a.firmId, a.year, { status: 'open', closeJournalId: null, imported: false, profit: null, tax: null, net: null, closedAt: null, closedBy: null });
  return true;
}

/* ------------------------------------------------------------------ */
/* Depreciation                                                       */
/* ------------------------------------------------------------------ */

export const assetForDep = (a: FixedAsset) => ({
  id: a.id, name: a.name, konto: a.konto, rate: Number(a.rate), date: a.date, cost: Number(a.cost), vehicleOnly: a.vehicleOnly, disposed: a.disposed ?? undefined,
});

/** Depreciation of the year for the register (no posting). */
export async function depreciationFor(tx: Tx, firmId: string, year: number): Promise<{ assets: FixedAsset[]; rows: DepRow[]; total: number }> {
  const assets = await tx.select().from(fixedAssets).where(eq(fixedAssets.firmId, firmId)).orderBy(fixedAssets.konto, fixedAssets.invNo);
  const r = depFor(assets.map(assetForDep), year);
  return { assets, ...r };
}

/** Post the depreciation of the year (legacy `runDep` 7239 → journal `dep-YYYY`), one journal per year, re-postable. */
export async function runDepreciation(tx: Tx, a: Omit<YeActionInput, 'today'>) {
  const { rows, total } = await depreciationFor(tx, a.firmId, a.year);
  const lines = depEntries(rows);
  if (!total || !lines.length) throw new PostingError('empty', `Нема амортизација за ${a.year} (нема средства или се целосно амортизирани).`);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: `${a.year}-12-31`, kind: 'amort', sourceType: YE_SOURCE.dep.type, sourceId: YE_SOURCE.dep.id(a.year),
    description: `Амортизација ${a.year}`, lines, userId: a.userId, requirePartner: false, meta: { total }, auditAction: 'runDep',
  });
  const detail = rows.filter((r) => r.year);
  await tx.insert(depreciationRuns).values({ firmId: a.firmId, year: a.year, journalId: j.id, total: String(total), rows: detail, runBy: a.userId })
    .onConflictDoUpdate({ target: [depreciationRuns.firmId, depreciationRuns.year], set: { journalId: j.id, total: String(total), rows: detail, runBy: a.userId, updatedAt: new Date() } });
  return { journal: j, total, lines };
}

export async function undoDepreciation(tx: Tx, a: Omit<YeActionInput, 'today'>) {
  const n = await unpostSource(tx, { firmId: a.firmId, sourceType: YE_SOURCE.dep.type, sourceId: YE_SOURCE.dep.id(a.year), userId: a.userId });
  await tx.delete(depreciationRuns).where(and(eq(depreciationRuns.firmId, a.firmId), eq(depreciationRuns.year, a.year)));
  return n;
}

/* ------------------------------------------------------------------ */
/* ЦРСМ XML import / undo                                             */
/* ------------------------------------------------------------------ */

const yr = (v: Record<string, number> | null | undefined) => (v && Object.keys(v).length ? v : undefined);

/** Import an accepted ЦРМ annual-account XML into the statement rows of Y (and Y−1 when it has no ledger). */
export async function importCrmXml(tx: Tx, a: { firmId: string; userId: string | null; xml: string; year?: number }) {
  const P = parseCrmXml(a.xml);
  if (a.year && P.year && P.year !== a.year) throw new PostingError('bad_date', `XML-от е за ${P.year}, а избрана е ${a.year} година.`);
  const Y = P.year || a.year!;
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  const [cur, prev] = await Promise.all([getStatement(tx, a.firmId, Y), getStatement(tx, a.firmId, Y - 1)]);
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(journals)
    .where(and(eq(journals.firmId, a.firmId), sql`${journals.date} between ${Y - 1 + '-01-01'} and ${Y - 1 + '-12-31'}`))) as [{ n: number }];
  const s = settingsOf(f);
  const state: CrmFirmState = {
    zsMan: { ...(yr(prev?.zsMan) ? { [Y - 1]: prev!.zsMan } : {}), ...(yr(cur?.zsMan) ? { [Y]: cur!.zsMan } : {}) },
    deMan: { ...(yr(prev?.deMan) ? { [Y - 1]: prev!.deMan } : {}), ...(yr(cur?.deMan) ? { [Y]: cur!.deMan } : {}) },
    f35Raw: yr(cur?.f35Raw) ? { [Y]: cur!.f35Raw } : {},
    nkdAop: (s.nkdAop as Record<string, number>) ?? {},
    nkd: f.activity ?? '',
  };
  const patch = crmImportPatch(state, P, firmRules(f), n > 0);
  await upsertStatement(tx, a.firmId, Y, {
    zsMan: patch.zsMan?.[Y] ?? {}, deMan: patch.deMan?.[Y] ?? {}, f35Raw: patch.f35Raw?.[Y] ?? {}, crmPeriod: patch.crmPeriod,
    crmImport: (patch.crmImp?.[Y] ?? null) as Record<string, unknown> | null, status: 'accepted',
  }, a.userId);
  const touchPrev = patch.zsMan?.[Y - 1] !== state.zsMan?.[Y - 1] || patch.deMan?.[Y - 1] !== state.deMan?.[Y - 1];
  if (touchPrev) await upsertStatement(tx, a.firmId, Y - 1, { zsMan: patch.zsMan?.[Y - 1] ?? {}, deMan: patch.deMan?.[Y - 1] ?? {} }, a.userId);
  if (patch.nkdAop) await tx.update(firms).set({ settings: { ...s, nkdAop: patch.nkdAop } }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'crmXmlImport', entityType: 'annualStatement', entityId: String(Y),
    data: { aop: Object.keys(P.cur).length, d38: Object.keys(P.d38).length, f35: Object.keys(P.f35).length, period: P.period } });
  return { year: Y, aop: Object.keys(P.cur).length };
}

/** Undo the XML import of Y (legacy `crmXClr`, fixed C1: restores what the import replaced). */
export async function clearCrmXml(tx: Tx, a: { firmId: string; userId: string | null; year: number }) {
  const Y = a.year;
  const [cur, prev] = await Promise.all([getStatement(tx, a.firmId, Y), getStatement(tx, a.firmId, Y - 1)]);
  const undo = (cur?.crmImport ?? null) as CrmImportUndo | null;
  const state: CrmFirmState = {
    zsMan: { ...(yr(prev?.zsMan) ? { [Y - 1]: prev!.zsMan } : {}), ...(yr(cur?.zsMan) ? { [Y]: cur!.zsMan } : {}) },
    deMan: { ...(yr(prev?.deMan) ? { [Y - 1]: prev!.deMan } : {}), ...(yr(cur?.deMan) ? { [Y]: cur!.deMan } : {}) },
    f35Raw: yr(cur?.f35Raw) ? { [Y]: cur!.f35Raw } : {},
    crmImp: undo ? { [Y]: undo } : {},
  };
  const p = clearCrmImport(state, Y);
  await upsertStatement(tx, a.firmId, Y, { zsMan: p.zsMan?.[Y] ?? {}, deMan: p.deMan?.[Y] ?? {}, f35Raw: p.f35Raw?.[Y] ?? {}, crmImport: null, status: 'draft' }, a.userId);
  if (undo && (undo.zsManPrev !== undefined || undo.deManPrev !== undefined)) {
    await upsertStatement(tx, a.firmId, Y - 1, { zsMan: p.zsMan?.[Y - 1] ?? {}, deMan: p.deMan?.[Y - 1] ?? {} }, a.userId);
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'crmXClr', entityType: 'annualStatement', entityId: String(Y) });
}

/* ------------------------------------------------------------------ */
/* Forms 35 / 38                                                      */
/* ------------------------------------------------------------------ */

/** Form-38 suggestion + values and form-35 rows for a loaded year. */
export function forms3538(L: LoadedYear, accountNames: Readonly<Record<string, string>>) {
  const pre = L.Y.co.balances.pre;
  const auto = deAuto(pre, accountNames, L.Y.co.zs);
  const de = deVals(L.statement?.deMan, auto);
  const s = settingsOf(L.firm);
  const f35 = f35Rows(pre, { nkd: L.firm.activity ?? '', activity: L.firm.activity ?? '', actMap: (s.actMap as Record<string, string>) ?? {}, nkdAop: (s.nkdAop as Record<string, number>) ?? {} });
  return { auto, de, f35 };
}

/** Snapshot the computed AOPs into the statement (on save / XML export / submit). */
export async function snapshotAop(tx: Tx, L: LoadedYear, userId: string | null, extra: StatementPatch = {}): Promise<void> {
  const aop: Record<string, number> = {};
  for (const [k, v] of Object.entries(L.Y.co.zs.V)) if (v) aop[k] = Math.round(v);
  await upsertStatement(tx, L.firm.id, L.year, { aop, ...extra }, userId);
}

export const sumDepRows = (rows: readonly { year: number }[]) => r2(rows.reduce((s, r) => s + r.year, 0));
