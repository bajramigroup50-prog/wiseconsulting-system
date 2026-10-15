/**
 * Legal compliance services (docs/legal/COMPLIANCE.md):
 * - `complianceFacts` — what the „Законска усогласеност“ dashboard checks for a firm and year;
 * - `invoiceLegalCheck` — mandatory invoice elements of one stored document (print view, e-mail action);
 * - the inspections register („Анализа на решение / записник од контрола“): cases, findings, corrective actions,
 *   the evidence from the books for a finding and the AI-read import;
 * - personal data: the default processing activities of a client and the access log of personal-data views.
 * Every mutation writes its `audit_log` row in the caller's transaction; permission checks are the caller's.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  AUTH_AREA, daysLeft, deadlineFrom, DEFAULT_ACTIVITIES, fromCents, invoiceLegalIssues, isFindingArea, isKontrolaAuth, isKontrolaDoc, isKontrolaStatus, isVerdict,
  kontrolaDeadlines, numberingIssues, RECOMMEND_LBL, toCents, CASH_LIMIT_EUR, CASH_LIMIT_MONTH, CASH_LIMIT_SINGLE,
  addVersion, aiPatches, docText, isDisputed, isSubmissionType, kontrolaInternal, kontrolaSubmission, versionsOf,
  type CaseDoc, type CaseInput, type Finding, type KontrolaAiAnalysis, type KontrolaVersion, type SubmissionType,
  type ComplianceFacts, type FindingArea, type KontrolaAiResult, type KontrolaAuth, type LegalIssue, type Recommendation,
} from '@wise/core/compliance';
import { addDays, addMonths, cashDays, inspCheck, inspCtx, inspScore, todaySkopje, vatPeriodRange, ymAdd, type InspManual, type InspProfile } from '@wise/core/office';
import { randomUUID } from 'node:crypto';
import { audit, type Tx } from './audit';
import { buildFirmSnapshot, officeProfileForFirm, OfficeError } from './office';
import { loadInvoicePrintData } from './sales/invoice-print';
import {
  amlRecords, auditLog, bankStatements, employees, firms, gdprRecords, inspectionStates, invoiceLines, invoices, journalLines, journals, kontrolaActions,
  kontrolaFindings, kontroli, partners, payrollEmp, payrollRuns, serviceContracts, users, vatPeriods,
  type Firm, type Kontrola, type KontrolaFinding, type InvoiceData,
} from './schema/index';

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.');
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ====================================================================================================== */
/* Audit log integrity                                                                                     */
/* ====================================================================================================== */

/** The append-only trigger (`compliance.sql`) is installed on `audit_log`. */
export async function auditLogImmutable(tx: Tx): Promise<boolean> {
  const r = await tx.execute(sql`select 1 from pg_trigger where tgname = 'audit_log_append_only' and not tgisinternal limit 1`);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows) ?? [];
  return rows.length > 0;
}

/** Access to personal data (employee file, payroll slip, AML file …) — recorded like every other action (ЗЗЛП чл. 36). */
export async function logPersonalDataAccess(tx: Tx, a: { userId: string | null; firmId: string | null; entityType: string; entityId: string; what: string }): Promise<void> {
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'viewPersonal', entityType: a.entityType, entityId: a.entityId, data: { what: a.what } });
}

/* ====================================================================================================== */
/* Invoices                                                                                                */
/* ====================================================================================================== */

/** Legal issues of one stored outgoing document (`null` = not found). Cancelled documents report only that. */
export async function invoiceLegalCheck(tx: Tx, invoiceId: string, today = todaySkopje()): Promise<LegalIssue[] | null> {
  const d = await loadInvoicePrintData(tx, invoiceId);
  if (!d) return null;
  const inv = d.invoice;
  if ((inv.data as InvoiceData).cancelled) return [{ code: 'cancelled', sev: 'block', text: 'Фактурата е сторнирана.', law: 'ЗДП чл. 48 (чување)' }];
  return invoiceLegalIssues({
    kind: inv.kind, number: inv.number, date: inv.date, pdate: inv.pdate, art32: inv.art32, export: inv.export, advance: inv.advance, note: inv.note,
    ref: d.input.ref, firm: d.firm, partner: d.partner, lines: d.input.lines, today,
  });
}

/* ====================================================================================================== */
/* Dashboard facts                                                                                         */
/* ====================================================================================================== */

/** Revenue (class 7) turnover of a year: credit − debit, denars. */
async function revenueOf(tx: Tx, firmId: string, year: number): Promise<number | null> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int`, s: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)` })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), sql`${journalLines.account} like '7%'`, gte(journals.date, `${year}-01-01`), lte(journals.date, `${year}-12-31`), sql`${journals.kind} not in ('close','open')`));
  return r && r.n ? Number(r.s) : null;
}

export async function complianceFacts(tx: Tx, firmId: string, year: number, today = todaySkopje()): Promise<ComplianceFacts | null> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) return null;
  const st = (f.settings ?? {}) as { officeFirm?: boolean; inspProf?: InspProfile; nkdOther?: string[]; eurRate?: number };
  const y = String(year);
  const asOf = today.slice(0, 4) === y ? today : `${y}-12-31` < today ? `${y}-12-31` : today;

  // invoices of the year: numbering over every document of the series, mandatory elements over the issued ones
  const I = await tx.select().from(invoices).where(and(eq(invoices.firmId, firmId), inArray(invoices.kind, ['invoice', 'credit']), sql`${invoices.date} between ${String(year) + '-01-01'} and ${String(year) + '-12-31'}`))
    .orderBy(asc(invoices.date));
  const issued = I.filter((i) => i.status !== 'draft' || (i.data as InvoiceData).cancelled);
  const real = issued.filter((i) => !(i.data as InvoiceData).cancelled);
  const pIds = [...new Set(real.map((i) => i.partnerId).filter((x): x is string => !!x))];
  const P = new Map((pIds.length ? await tx.select().from(partners).where(inArray(partners.id, pIds)) : []).map((p) => [p.id, p]));
  const L = real.length ? await tx.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, real.map((i) => i.id))) : [];
  const byInv = new Map<string, typeof L>();
  for (const l of L) byInv.set(l.invoiceId, [...(byInv.get(l.invoiceId) ?? []), l]);
  const refs = new Map(I.map((i) => [i.id, i]));
  const invoiceIssues = real.map((i) => ({
    number: i.number, date: i.date,
    issues: invoiceLegalIssues({
      kind: i.kind, number: i.number, date: i.date, pdate: i.pdate, art32: i.art32, export: i.export, advance: i.advance, note: i.note,
      ref: i.refInvoiceId ? { number: refs.get(i.refInvoiceId)?.number ?? '?', date: refs.get(i.refInvoiceId)?.date ?? '' } : null,
      firm: f, partner: i.partnerId ? P.get(i.partnerId) ?? null : null, lines: byInv.get(i.id) ?? [], today,
    }),
  })).filter((x) => x.issues.length);
  const numbering = numberingIssues(I.filter((i) => i.status !== 'draft' || (i.data as InvoiceData).cancelled || i.kind === 'invoice')
    .map((i) => ({ number: i.number, date: i.date, kind: i.kind, cancelled: !!(i.data as InvoiceData).cancelled })), year);

  // books snapshot (ledger of the year, payroll months, VAT closes, employees) — shared with the inspection checklist
  const snap = await buildFirmSnapshot(tx, firmId, { today: asOf });
  const man = await tx.select().from(inspectionStates).where(eq(inspectionStates.firmId, firmId));
  const M: Record<string, InspManual> = Object.fromEntries(man.map((m) => [m.itemId, { d: m.doneDate, na: m.na, by: m.byName, note: m.note }]));
  const c = snap ? inspCtx(snap, st.inspProf ?? {}, (st.nkdOther ?? []).filter((x) => typeof x === 'string')) : null;
  const insp = c ? inspScore(inspCheck(c, M)) : null;

  // VAT periods whose 25-day filing deadline passed without a closed return (ЗДДВ чл. 41)
  const vatMissing: string[] = [];
  if (f.vatRegistered && snap?.vatClosedPeriods) {
    const per = f.vatPeriod === 'month' ? 'month' : 'quarter', step = per === 'month' ? 1 : 3;
    for (let a = `${y}-01-01`; a.startsWith(y); a = addMonths(a, step)) {
      const [, b] = vatPeriodRange(a, per);
      if (addDays(b, 25) < asOf && !snap.vatClosedPeriods.includes(a)) vatMissing.push(`${dmy(a)}–${dmy(b)}`);
    }
  }

  // payroll: months without a calculated payroll since the first employee (МПИН until the 10th of the next month)
  let payrollMissing: string[] | null = null, payrollRaised = 0;
  const emps = (c?.emps ?? []).filter((e) => !e.end || e.end >= `${y}-01-01`);
  if (emps.length && snap?.payrollMonths) {
    payrollMissing = [];
    const first = emps.map((e) => e.start ?? '').filter(Boolean).sort()[0] ?? `${y}-01-01`;
    // month m is due (МПИН) by the 10th of m + 1
    for (let m = `${y}-01`; m.startsWith(y) && `${ymAdd(m, 1)}-10` < asOf; m = ymAdd(m, 1)) {
      if (m >= first.slice(0, 7) && !snap.payrollMonths.includes(m)) payrollMissing.push(`${m.slice(5)}/${m.slice(0, 4)}`);
    }
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.status, 'posted'), sql`${payrollRuns.month} like ${`${y}-%`}`)).orderBy(desc(payrollRuns.month)).limit(1);
    if (run) {
      const minNet = Number((run.params as { minNet?: number }).minNet) || 0;
      const E = await tx.select({ netBase: payrollEmp.netBase, coef: payrollEmp.coef }).from(payrollEmp).where(eq(payrollEmp.runId, run.id));
      payrollRaised = minNet ? E.filter((e) => Number(e.netBase) > 0 && Number(e.coef) >= 1 && Number(e.netBase) * Number(e.coef) < minNet - 1).length : 0;
    }
  } else if (emps.length) payrollMissing = [];

  // cash: payments above the per-payment limit, months above the monthly limit, negative balance, > 1.000 €
  let cash: ComplianceFacts['cash'] = null;
  if (snap) {
    const K = new Set(snap.cashAccounts?.length ? snap.cashAccounts : ['1020']);
    const CL = snap.ledger.filter((l) => K.has(String(l.account)) && l.date.startsWith(y));
    if (CL.length) {
      const by = new Map<string, typeof snap.ledger[number][]>();
      for (const l of snap.ledger) if (l.date.startsWith(y)) { const k = l.journalId ?? `${l.date}|${l.number ?? ''}`; by.set(k, [...(by.get(k) ?? []), l]); }
      let single = 0;
      const mon = new Map<string, number>();
      for (const G of by.values()) {
        const out = G.filter((l) => K.has(String(l.account)) && l.credit > 0);
        const cp = G.filter((l) => /^(22|4)/.test(String(l.account)) && l.debit > 0);
        if (!out.length || !cp.length) continue;
        const amt = r2(Math.min(out.reduce((s, l) => s + l.credit, 0), cp.reduce((s, l) => s + l.debit, 0)));
        if (amt > CASH_LIMIT_SINGLE.value) single++;
        mon.set(G[0]!.date.slice(0, 7), r2((mon.get(G[0]!.date.slice(0, 7)) ?? 0) + amt));
      }
      const eur = Number(st.eurRate) || snap.eurRate || 61.5;
      cash = {
        single, monthly: [...mon].filter(([, v]) => v > CASH_LIMIT_MONTH.value).map(([m]) => `${m.slice(5)}/${m.slice(0, 4)}`),
        negativeDays: cashDays(snap, y).days.filter(([, b]) => b < -1).length,
        overEur: CL.filter((l) => Math.max(l.debit, l.credit) > CASH_LIMIT_EUR.value * eur).length,
      };
    }
  }

  const G = await tx.select({ kind: gdprRecords.kind, status: gdprRecords.status, due: gdprRecords.due }).from(gdprRecords).where(eq(gdprRecords.firmId, firmId));
  const open = (k: string) => G.filter((g) => g.kind === k && g.status === 'open');
  const [sc] = await tx.select({ id: serviceContracts.id }).from(serviceContracts).where(and(eq(serviceContracts.firmId, firmId), eq(serviceContracts.status, 'signed'))).limit(1);
  const K = await tx.select().from(kontroli).where(and(eq(kontroli.firmId, firmId), isNull(kontroli.filedOn), sql`${kontroli.status} <> 'closed'`));
  let kontrolaExpired = 0, kontrolaUrgent = 0, kontrolaOpen = 0;
  let kontrolaNext: ComplianceFacts['kontrolaNext'] = null;
  for (const k of K) {
    if (!isKontrolaAuth(k.auth) || !isKontrolaDoc(k.doc)) continue;
    const [d] = kontrolaDeadlines(k.auth, k.doc, k.delivered, today, kontrolaDue(k));
    if (!d) continue;
    kontrolaOpen++;
    if (!kontrolaNext || d.due < kontrolaNext.due) kontrolaNext = { due: d.due, days: daysLeft(today, d.due), name: d.remedy.name };
    if (d.state === 'expired') kontrolaExpired++;
    else if (d.state !== 'open') kontrolaUrgent++;
  }
  const [ao] = await tx.select({ n: sql<number>`count(*)::int` }).from(kontrolaActions)
    .where(and(eq(kontrolaActions.firmId, firmId), isNull(kontrolaActions.doneOn), sql`${kontrolaActions.due} < ${today}`));

  return {
    today, year,
    firm: { name: f.name, edb: f.edb, address: f.address, city: f.city, vatRegistered: f.vatRegistered, vatPeriod: f.vatPeriod, lockDate: f.lockDate, officeFirm: !!st.officeFirm },
    turnoverPrev: await revenueOf(tx, firmId, year - 1),
    invoiceIssues, invoiceCount: real.length, numbering, cancelledCount: issued.length - real.length,
    vatMissing, payrollMissing, payrollRaised, cash,
    serviceContract: sc ? true : false,
    dpa: G.some((g) => g.kind === 'dpa'),
    activities: G.filter((g) => g.kind === 'activity').length,
    dsrOpen: open('request').length, dsrOverdue: open('request').filter((g) => g.due && g.due < today).length,
    breachOpen: open('breach').length, breachOverdue: open('breach').filter((g) => g.due && g.due < today).length,
    auditImmutable: await auditLogImmutable(tx),
    kontrolaExpired, kontrolaUrgent, kontrolaOpen, kontrolaNext, actionsOverdue: ao?.n ?? 0,
    inspScore: insp ? { pct: insp.pct, bad: insp.bad } : null,
  };
}

/* ====================================================================================================== */
/* Inspections register                                                                                    */
/* ====================================================================================================== */

export interface KontrolaInput {
  id?: string | null;
  auth: string; doc: string; docNo?: string | null; docDate?: string | null; delivered?: string | null; dueOverride?: string | null;
  periodFrom?: string | null; periodTo?: string | null; subject?: string | null; status?: string | null; filedOn?: string | null;
  clientVisible?: boolean; aiDocId?: string | null;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const optDate = (s: unknown) => (isDate(s) ? s : null);

/**
 * The case's deadline: the one typed from the „правна поука“ (`dueOverride`), otherwise the days the reader found in
 * it (`data.remedy`, `applyKontrolaAi`) counted from the delivery date; null = the authority's default remedy period.
 */
export function kontrolaDue(k: Pick<Kontrola, 'dueOverride' | 'delivered' | 'data'>): string | null {
  if (k.dueOverride) return k.dueOverride;
  const r = ((k.data ?? {}) as { remedy?: { n?: number; unit?: string } }).remedy;
  if (!k.delivered || !r?.n) return null;
  try { return deadlineFrom(k.delivered, r.n, r.unit === 'workdays' ? 'workdays' : 'days'); } catch { return null; }
}

async function own(tx: Tx, firmId: string, id: string): Promise<Kontrola> {
  const [k] = /^[0-9a-f-]{36}$/i.test(id) ? await tx.select().from(kontroli).where(and(eq(kontroli.id, id), eq(kontroli.firmId, firmId))).limit(1) : [];
  if (!k) throw new OfficeError('Контролата не е пронајдена.');
  return k;
}

export async function saveKontrola(tx: Tx, firmId: string, x: KontrolaInput, userId: string | null): Promise<string> {
  if (!isKontrolaAuth(x.auth)) throw new OfficeError('Изберете орган.');
  if (!isKontrolaDoc(x.doc)) throw new OfficeError('Изберете вид на акт.');
  const status = x.status && isKontrolaStatus(x.status) ? x.status : x.doc === 'zapisnik' ? 'record' : 'decision';
  const pf = optDate(x.periodFrom), pt = optDate(x.periodTo);
  if (pf && pt && pf > pt) throw new OfficeError('Периодот „од“ е по „до“.');
  const dl = optDate(x.delivered), dd = optDate(x.docDate);
  if (dl && dd && dl < dd) throw new OfficeError('Датумот на прием е пред датумот на актот.');
  const row = {
    auth: x.auth, doc: x.doc, docNo: x.docNo?.trim() || null, docDate: dd, delivered: dl, dueOverride: optDate(x.dueOverride),
    periodFrom: pf, periodTo: pt, subject: x.subject?.trim() || null, status, filedOn: optDate(x.filedOn), clientVisible: !!x.clientVisible,
    updatedBy: userId,
  };
  let id: string;
  if (x.id) {
    await own(tx, firmId, x.id);
    await tx.update(kontroli).set(row).where(eq(kontroli.id, x.id));
    id = x.id;
  } else {
    const [k] = await tx.insert(kontroli).values({ ...row, firmId, aiDocId: x.aiDocId ?? null, createdBy: userId }).returning({ id: kontroli.id });
    id = k!.id;
  }
  await audit(tx, { userId, firmId, action: x.id ? 'kontrolaEdit' : 'kontrolaNew', entityType: 'kontrola', entityId: id, data: { auth: x.auth, doc: x.doc, docNo: row.docNo, delivered: dl, status } });
  return id;
}

/** Removing an inspection is for a wrong entry only — the caller requires `del`; the audit row keeps what it was. */
export async function deleteKontrola(tx: Tx, firmId: string, id: string, userId: string | null): Promise<void> {
  const k = await own(tx, firmId, id);
  const F = await tx.select({ n: sql<number>`count(*)::int` }).from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, id));
  await tx.delete(kontroli).where(eq(kontroli.id, id));
  await audit(tx, { userId, firmId, action: 'kontrolaDel', entityType: 'kontrola', entityId: id, data: { auth: k.auth, doc: k.doc, docNo: k.docNo, docDate: k.docDate, findings: F[0]?.n ?? 0 } });
}

export interface FindingInput {
  id?: string | null; no?: number | null; area?: string | null; text: string; article?: string | null;
  claimed?: string | number | null; interest?: string | number | null; fine?: string | number | null; ours?: string | number | null; oursSource?: string | null;
  account?: string | null; verdict?: string | null; officeOk?: boolean | null; systemError?: boolean | null; analysis?: string | null; recommendation?: string | null;
}

const money = (v: unknown) => fromCents(toCents(v as string | number | null | undefined));
const isRec = (x: unknown): x is Recommendation => typeof x === 'string' && x in RECOMMEND_LBL;

export async function saveKontrolaFinding(tx: Tx, firmId: string, kontrolaId: string, x: FindingInput, userId: string | null): Promise<string> {
  const k = await own(tx, firmId, kontrolaId);
  const text = String(x.text ?? '').trim();
  if (!text) throw new OfficeError('Внесете го наодот.');
  let row;
  try {
    row = {
      area: isFindingArea(x.area) ? x.area : AUTH_AREA[k.auth as KontrolaAuth] ?? 'other', text, article: x.article?.trim() || null,
      claimed: money(x.claimed), interest: money(x.interest), fine: money(x.fine),
      ours: x.ours == null || x.ours === '' ? null : money(x.ours), oursSource: x.oursSource?.trim() || null,
      account: x.account && /^\d{1,10}$/.test(x.account.trim()) ? x.account.trim() : null,
      verdict: isVerdict(x.verdict) ? x.verdict : null, officeOk: x.officeOk ?? null, systemError: x.systemError ?? null,
      analysis: x.analysis?.trim() || null, recommendation: isRec(x.recommendation) ? x.recommendation : null,
    };
  } catch (e) { throw new OfficeError(e instanceof Error ? e.message : 'Неважечки износ.'); }
  let id: string;
  if (x.id) {
    const [f] = await tx.select({ id: kontrolaFindings.id }).from(kontrolaFindings).where(and(eq(kontrolaFindings.id, x.id), eq(kontrolaFindings.kontrolaId, kontrolaId))).limit(1);
    if (!f) throw new OfficeError('Наодот не е пронајден.');
    await tx.update(kontrolaFindings).set({ ...row, ...(x.no ? { no: x.no } : {}) }).where(eq(kontrolaFindings.id, x.id));
    id = x.id;
  } else {
    const [m] = await tx.select({ n: sql<number>`coalesce(max(${kontrolaFindings.no}), 0)::int` }).from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, kontrolaId));
    const [f] = await tx.insert(kontrolaFindings).values({ ...row, kontrolaId, firmId, no: x.no || (m?.n ?? 0) + 1 }).returning({ id: kontrolaFindings.id });
    id = f!.id;
  }
  await audit(tx, { userId, firmId, action: x.id ? 'kontrolaFindingEdit' : 'kontrolaFindingNew', entityType: 'kontrola_finding', entityId: id, data: { kontrolaId, claimed: row.claimed, ours: row.ours, verdict: row.verdict, recommendation: row.recommendation } });
  return id;
}

export async function deleteKontrolaFinding(tx: Tx, firmId: string, kontrolaId: string, id: string, userId: string | null): Promise<void> {
  await own(tx, firmId, kontrolaId);
  const [f] = await tx.delete(kontrolaFindings).where(and(eq(kontrolaFindings.id, id), eq(kontrolaFindings.kontrolaId, kontrolaId))).returning();
  if (!f) throw new OfficeError('Наодот не е пронајден.');
  await audit(tx, { userId, firmId, action: 'kontrolaFindingDel', entityType: 'kontrola_finding', entityId: id, data: { kontrolaId, no: f.no, text: f.text, claimed: f.claimed } });
}

/** Quick marking of a finding: „⚖ Оспори“ (object) / „½ Делумно“ (partial) / „✓ Прифати“ (accept) / automatic (null). */
export async function markKontrolaFinding(tx: Tx, firmId: string, kontrolaId: string, id: string, rec: string | null, userId: string | null): Promise<void> {
  await own(tx, firmId, kontrolaId);
  const r = rec && isRec(rec) ? rec : null;
  const [f] = await tx.update(kontrolaFindings).set({ recommendation: r }).where(and(eq(kontrolaFindings.id, id), eq(kontrolaFindings.kontrolaId, kontrolaId))).returning({ no: kontrolaFindings.no });
  if (!f) throw new OfficeError('Наодот не е пронајден.');
  await audit(tx, { userId, firmId, action: 'kontrolaFindingMark', entityType: 'kontrola_finding', entityId: id, data: { kontrolaId, no: f.no, recommendation: r } });
}

/** Findings from the AI read of the uploaded record / decision (added after the existing ones; header fields fill blanks). */
export async function applyKontrolaAi(tx: Tx, firmId: string, kontrolaId: string, r: KontrolaAiResult, userId: string | null): Promise<number> {
  const k = await own(tx, firmId, kontrolaId);
  const patch: Partial<typeof kontroli.$inferInsert> = {};
  if (!k.docNo && r.docNo) patch.docNo = String(r.docNo).slice(0, 100);
  if (!k.docDate && isDate(r.docDate)) patch.docDate = r.docDate;
  if (!k.periodFrom && isDate(r.periodFrom)) patch.periodFrom = r.periodFrom;
  if (!k.periodTo && isDate(r.periodTo)) patch.periodTo = r.periodTo;
  if (!k.subject && r.subject) patch.subject = String(r.subject).slice(0, 500);
  // the deadline of the „правна поука“ (free reader): kept with the case, counted from the delivery date (`kontrolaDue`)
  const rd = Number(r.remedyDays);
  if (Number.isInteger(rd) && rd > 0 && rd <= 90) patch.data = { ...(k.data ?? {}), remedy: { n: rd, unit: r.remedyUnit === 'workdays' ? 'workdays' : 'days' } };
  if (Object.keys(patch).length) await tx.update(kontroli).set(patch).where(eq(kontroli.id, kontrolaId));
  let n = 0;
  for (const f of r.findings ?? []) {
    if (!f?.text || !String(f.text).trim()) continue;
    const safe = (v: unknown) => { try { return fromCents(toCents(v as string)); } catch { return '0.00'; } };
    await saveKontrolaFinding(tx, firmId, kontrolaId, {
      area: isFindingArea(f.area) ? f.area : null, text: String(f.text).slice(0, 4000), article: f.article ? String(f.article).slice(0, 500) : null,
      claimed: safe(f.claimed), interest: safe(f.interest), fine: safe(f.fine),
    }, userId);
    n++;
  }
  await audit(tx, { userId, firmId, action: 'kontrolaAiApply', entityType: 'kontrola', entityId: kontrolaId, data: { findings: n, ...(r.noai ? { noai: true } : {}), ...(patch.data ? { remedyDays: rd } : {}) } });
  return n;
}

export interface ActionInput { id?: string | null; findingId?: string | null; text: string; ownerId?: string | null; ownerName?: string | null; due?: string | null; note?: string | null }

export async function saveKontrolaAction(tx: Tx, firmId: string, kontrolaId: string, x: ActionInput, userId: string | null): Promise<string> {
  await own(tx, firmId, kontrolaId);
  const text = String(x.text ?? '').trim();
  if (!text) throw new OfficeError('Опишете ја мерката.');
  let ownerName = x.ownerName?.trim() || null;
  if (x.ownerId) {
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, x.ownerId)).limit(1);
    if (!u) throw new OfficeError('Корисникот не постои.');
    ownerName = ownerName ?? u.name;
  }
  if (x.findingId) {
    const [f] = await tx.select({ id: kontrolaFindings.id }).from(kontrolaFindings).where(and(eq(kontrolaFindings.id, x.findingId), eq(kontrolaFindings.kontrolaId, kontrolaId))).limit(1);
    if (!f) throw new OfficeError('Наодот не е пронајден.');
  }
  const row = { text, findingId: x.findingId || null, ownerId: x.ownerId || null, ownerName, due: optDate(x.due), note: x.note?.trim() || null };
  let id: string;
  if (x.id) {
    const [a] = await tx.update(kontrolaActions).set(row).where(and(eq(kontrolaActions.id, x.id), eq(kontrolaActions.kontrolaId, kontrolaId))).returning({ id: kontrolaActions.id });
    if (!a) throw new OfficeError('Мерката не е пронајдена.');
    id = a.id;
  } else {
    const [a] = await tx.insert(kontrolaActions).values({ ...row, kontrolaId, firmId, createdBy: userId }).returning({ id: kontrolaActions.id });
    id = a!.id;
  }
  await audit(tx, { userId, firmId, action: x.id ? 'kontrolaActionEdit' : 'kontrolaActionNew', entityType: 'kontrola_action', entityId: id, data: { kontrolaId, due: row.due, owner: ownerName } });
  return id;
}

export async function setKontrolaActionDone(tx: Tx, firmId: string, id: string, doneOn: string | null, userId: string | null): Promise<void> {
  const [a] = await tx.update(kontrolaActions).set({ doneOn: optDate(doneOn) }).where(and(eq(kontrolaActions.id, id), eq(kontrolaActions.firmId, firmId))).returning({ k: kontrolaActions.kontrolaId });
  if (!a) throw new OfficeError('Мерката не е пронајдена.');
  await audit(tx, { userId, firmId, action: 'kontrolaActionDone', entityType: 'kontrola_action', entityId: id, data: { kontrolaId: a.k, doneOn } });
}

export async function loadKontrola(tx: Tx, firmId: string, id: string) {
  const k = await own(tx, firmId, id);
  const F = await tx.select().from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, id)).orderBy(asc(kontrolaFindings.no));
  const A = await tx.select().from(kontrolaActions).where(eq(kontrolaActions.kontrolaId, id)).orderBy(asc(kontrolaActions.due));
  return { k, F, A };
}

/* ---------------- Evidence from the books ---------------- */

export interface EvidenceLink { label: string; href: string }
export interface EvidenceCheck { s: 'ok' | 'warn' | 'bad'; txt: string }
export interface FindingEvidence {
  links: EvidenceLink[];
  /** Amount recalculated from our books for the controlled period (cents), with its source; null = not computable. */
  recalc: { cents: number; source: string } | null;
  /** System checks of the program over the period (did the program allow / cause the error?). */
  checks: EvidenceCheck[];
  /** Who / when changed relevant records in the period (audit log). */
  audit: { n: number; users: { name: string; n: number }[]; first: string | null; last: string | null };
  /** The documents of the period cited as evidence (ДДВ-04, payroll, invoices, journal and statement numbers). */
  refs: string[];
}

/** Entity types of the audit log relevant to an area. */
const AREA_AUDIT: Partial<Record<FindingArea, string[]>> = {
  vat: ['vat_period', 'invoice', 'purchase'], invoice: ['invoice'], books: ['journal', 'invoice', 'purchase'], cash: ['cash_voucher', 'journal'],
  pit: ['payroll_run', 'employee'], contrib: ['payroll_run', 'employee'], payroll: ['payroll_run', 'employee'], labour: ['employee', 'hr_contract', 'hr_doc'],
  aml: ['aml_record'], gdpr: ['gdpr_record'],
};

/**
 * Evidence for one finding over the inspection's period (defaults to the year of the act): links to the screens,
 * the amount recalculated from our books, the program's own checks for the period and the audit trail.
 */
export async function findingEvidence(tx: Tx, firmId: string, k: Pick<Kontrola, 'periodFrom' | 'periodTo' | 'docDate'>, f: Pick<KontrolaFinding, 'area' | 'account'>): Promise<FindingEvidence> {
  const y = (k.docDate ?? todaySkopje()).slice(0, 4);
  const from = k.periodFrom ?? `${y}-01-01`, to = k.periodTo ?? `${y}-12-31`;
  const area = (isFindingArea(f.area) ? f.area : 'other') as FindingArea;
  const links: EvidenceLink[] = [];
  const checks: EvidenceCheck[] = [];
  const refs: string[] = [];
  let recalc: FindingEvidence['recalc'] = null;
  const period = `${dmy(from)}–${dmy(to)}`;

  if (area === 'vat') {
    const V = await tx.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, firmId), lte(vatPeriods.dateFrom, to), gte(vatPeriods.dateTo, from))).orderBy(asc(vatPeriods.dateFrom));
    const closed = V.filter((v) => v.status === 'closed' && v.ddv04);
    refs.push(...closed.map((v) => `ДДВ-04 за ${v.period}`));
    if (closed.length) recalc = { cents: closed.reduce((s, v) => s + Math.round(Number(v.ddv04!.closeDiff) * 100), 0), source: `ДДВ-04 (обврска − побарување) за ${closed.map((v) => v.period).join(', ')}` };
    const open = V.filter((v) => v.status !== 'closed');
    checks.push(open.length ? { s: 'warn', txt: `Отворени (незатворени) ДДВ периоди во контролираниот период: ${open.map((v) => v.period).join(', ')}.` } : { s: 'ok', txt: 'Сите ДДВ периоди во контролираниот период се затворени во програмата (затворениот период не може да се менува).' });
    links.push({ label: 'ДДВ-04 по периоди', href: '/ddv' }, { label: 'Книги за ДДВ', href: '/ddvKnigi' });
  }
  if (area === 'pit' || area === 'contrib' || area === 'payroll' || area === 'labour') {
    const R = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), gte(payrollRuns.month, from.slice(0, 7)), lte(payrollRuns.month, to.slice(0, 7)))).orderBy(asc(payrollRuns.month));
    const P = R.filter((r) => r.status === 'posted');
    const key = area === 'pit' ? 'tax' : area === 'contrib' ? 'contr' : 'gross';
    if (P.length && area !== 'labour') recalc = { cents: P.reduce((s, r) => s + Math.round(Number(r.totals[key] ?? 0) * 100), 0), source: `${area === 'pit' ? 'Персонален данок' : area === 'contrib' ? 'Придонеси' : 'Бруто плати'} од пресметките за ${P.map((r) => r.month).join(', ')}` };
    refs.push(...P.map((r) => `Пресметка на плата за ${r.month}`));
    const draft = R.filter((r) => r.status !== 'posted');
    checks.push(draft.length ? { s: 'warn', txt: `Непрокнижени пресметки на плата: ${draft.map((r) => r.month).join(', ')}.` } : { s: 'ok', txt: `${P.length} прокнижени пресметки на плата во периодот; програмата ја зголемува платата до минималната и ги применува стапките од табелата на параметри.` });
    const [e] = await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.firmId, firmId));
    links.push({ label: `Пресметка на плата`, href: '/plati' }, { label: `Вработени (${e?.n ?? 0})`, href: '/vraboteni' });
  }
  if (area === 'invoice' || area === 'books') {
    const I = await tx.select({ number: invoices.number, date: invoices.date, kind: invoices.kind, status: invoices.status, data: invoices.data, total: invoices.total, fx: invoices.fx })
      .from(invoices).where(and(eq(invoices.firmId, firmId), inArray(invoices.kind, ['invoice', 'credit']), gte(invoices.date, from), lte(invoices.date, to)));
    const years = [...new Set(I.map((i) => i.date.slice(0, 4)))];
    const N = years.flatMap((yy) => numberingIssues(I.filter((i) => i.status !== 'draft' || (i.data as InvoiceData).cancelled || i.kind === 'invoice').map((i) => ({ number: i.number, date: i.date, kind: i.kind, cancelled: !!(i.data as InvoiceData).cancelled })), yy));
    checks.push(N.length ? { s: 'warn', txt: N.map((n) => n.text).join(' ') } : { s: 'ok', txt: `Нумерацијата на ${I.length} фактури во периодот е по ред.` });
    const posted = I.filter((i) => i.status === 'posted' && i.kind === 'invoice');
    if (area === 'invoice') {
      const S = [...posted].sort((a, b) => a.date.localeCompare(b.date));
      refs.push(...S.slice(0, 8).map((i) => `Фактура бр. ${i.number} од ${dmy(i.date)}`), ...(S.length > 8 ? [`… вкупно ${S.length} излезни фактури во периодот`] : []));
    }
    if (area === 'invoice' && posted.length) recalc = { cents: posted.reduce((s, i) => s + Math.round(Number(i.total) * (Number(i.fx) || 1) * 100), 0), source: `Вкупно ${posted.length} прокнижени излезни фактури` };
    links.push({ label: 'Излезни фактури', href: '/izlez' }, { label: 'Налози за книжење', href: '/nalozi' });
  }
  if (area === 'cash' || area === 'books') {
    const B = await tx.select({ number: bankStatements.number, date: bankStatements.date }).from(bankStatements)
      .where(and(eq(bankStatements.firmId, firmId), gte(bankStatements.date, from), lte(bankStatements.date, to))).orderBy(asc(bankStatements.date));
    if (B.length) refs.push(`Изводи од банка: ${B.slice(0, 5).map((b) => `${b.number ? `бр. ${b.number} ` : ''}од ${dmy(b.date)}`).join(', ')}${B.length > 5 ? ` … (вкупно ${B.length})` : ''}`);
  }
  if (area === 'cash') {
    links.push({ label: 'Благајна', href: '/blagajna' });
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firmId), eq(journalLines.account, '1020'), gte(journals.date, from), lte(journals.date, to), sql`${journalLines.credit} > ${CASH_LIMIT_SINGLE.value}`));
    checks.push(r?.n ? { s: 'warn', txt: `${r.n} исплати од благајна над ${CASH_LIMIT_SINGLE.value.toLocaleString('mk-MK')} ден. во периодот (програмата предупредува во „Подготвеност за инспекција“, не блокира).` } : { s: 'ok', txt: 'Нема исплати од благајна над лимитот во периодот.' });
  }
  if (area === 'aml') {
    const [a] = await tx.select().from(amlRecords).where(eq(amlRecords.firmId, firmId)).limit(1);
    checks.push(a ? { s: a.nextReview && a.nextReview < to ? 'warn' : 'ok', txt: `АМЛ досие: ризик ${a.level}, последен преглед ${a.lastReview ? dmy(a.lastReview) : '—'}, следен ${a.nextReview ? dmy(a.nextReview) : '—'}.` } : { s: 'bad', txt: 'Нема АМЛ досие (анализа на клиентот) за фирмата.' });
    links.push({ label: 'АМЛ досие (УФР)', href: '/aml' });
  }
  if (area === 'gdpr') {
    const G = await tx.select({ kind: gdprRecords.kind }).from(gdprRecords).where(eq(gdprRecords.firmId, firmId));
    checks.push(G.some((g) => g.kind === 'dpa') ? { s: 'ok', txt: 'Постои договор за обработка на лични податоци.' } : { s: 'bad', txt: 'Нема договор за обработка на лични податоци.' });
    links.push({ label: 'Заштита на лични податоци', href: '/zzlp' });
  }
  if (f.account) {
    const [r] = await tx.select({ d: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)` })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firmId), sql`${journalLines.account} like ${`${f.account}%`}`, gte(journals.date, from), lte(journals.date, to)));
    const d = toCents(r?.d ?? '0'), c = toCents(r?.c ?? '0');
    recalc = { cents: Math.abs(d - c), source: `Салдо на конто ${f.account} за ${period} (должи ${fromCents(d)}, побарува ${fromCents(c)})` };
    const J = await tx.selectDistinct({ number: journals.number, date: journals.date }).from(journals).innerJoin(journalLines, eq(journalLines.journalId, journals.id))
      .where(and(eq(journals.firmId, firmId), sql`${journalLines.account} like ${`${f.account}%`}`, gte(journals.date, from), lte(journals.date, to))).orderBy(asc(journals.date)).limit(11);
    refs.push(...J.slice(0, 10).map((j) => `Налог бр. ${j.number} од ${dmy(j.date)}`), ...(J.length > 10 ? ['… и други налози (картица на контото)'] : []));
    refs.push(`Картица на конто ${f.account} за ${period}`);
    links.push({ label: `Картица на конто ${f.account}`, href: `/kkart?k=${encodeURIComponent(f.account)}&from=${from}&to=${to}` });
  }
  if (!links.length) links.push({ label: 'Бруто биланс', href: '/bilanc' }, { label: 'Налози за книжење', href: '/nalozi' });

  const types = AREA_AUDIT[area];
  const AL = await tx.select({ at: auditLog.at, user: users.name, et: auditLog.entityType }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.firmId, firmId), gte(auditLog.at, new Date(`${from}T00:00:00Z`)), lte(auditLog.at, new Date(`${to}T23:59:59Z`)), types ? inArray(auditLog.entityType, types) : undefined));
  const byU = new Map<string, number>();
  for (const a of AL) byU.set(a.user ?? '—', (byU.get(a.user ?? '—') ?? 0) + 1);
  const times = AL.map((a) => a.at.toISOString()).sort();
  return {
    links, recalc, checks, refs,
    audit: { n: AL.length, users: [...byU].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n), first: times[0] ?? null, last: times[times.length - 1] ?? null },
  };
}

/* ---------------- The documents of a disputed case (versions in `data.versions`) ---------------- */

export interface KontrolaCase { k: Kontrola; F: KontrolaFinding[]; firm: Firm; ev: FindingEvidence[]; input: CaseInput }

/** The office's choice of document type (`data.subType`) instead of the program's. */
export const kontrolaSubType = (k: Pick<Kontrola, 'data'>): SubmissionType | null => {
  const t = ((k.data ?? {}) as { subType?: unknown }).subType;
  return isSubmissionType(t) ? t : null;
};

const toFindingRow = (f: KontrolaFinding): Finding => ({
  no: f.no, area: (isFindingArea(f.area) ? f.area : 'other') as FindingArea, text: f.text, article: f.article,
  claimed: toCents(f.claimed), interest: toCents(f.interest), fine: toCents(f.fine), ours: f.ours == null ? null : toCents(f.ours),
  verdict: isVerdict(f.verdict) ? f.verdict : null, officeOk: f.officeOk, systemError: f.systemError, analysis: f.analysis,
  recommendation: isRec(f.recommendation) ? f.recommendation : null,
});

/**
 * Everything the two documents of a case need: the case, its findings, the firm (ЕДБ / ЕМБС / address / manager),
 * the office as полномошник, and per finding the evidence of the controlled period (documents, checks, audit trail).
 */
export async function loadKontrolaCase(tx: Tx, firmId: string, kid: string, today = todaySkopje()): Promise<KontrolaCase | null> {
  const [k] = /^[0-9a-f-]{36}$/i.test(kid) ? await tx.select().from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firmId))).limit(1) : [];
  if (!k || !isKontrolaAuth(k.auth) || !isKontrolaDoc(k.doc)) return null;
  const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return null;
  const F = await tx.select().from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, kid)).orderBy(asc(kontrolaFindings.no));
  const ev: FindingEvidence[] = [];
  for (const f of F) ev.push(await findingEvidence(tx, firmId, k, f));
  // 🎭 a demo firm's полномошник is the demo office, never the real one
  const O = await officeProfileForFirm(tx, firm);
  const st = (firm.settings ?? {}) as { manager?: string; signer?: string; officeFirm?: boolean };
  const input: CaseInput = {
    auth: k.auth, doc: k.doc, docNo: k.docNo, docDate: k.docDate, delivered: k.delivered, dueOverride: kontrolaDue(k), periodFrom: k.periodFrom, periodTo: k.periodTo,
    subject: k.subject, firm: { name: firm.name, edb: firm.edb, embs: firm.embs, address: firm.address, city: firm.city, manager: st.manager || st.signer || null },
    // the office is the полномошник of a client firm (not of itself)
    office: O.name && !st.officeFirm ? { name: O.name, edb: O.edb ?? null, address: O.address ?? null, city: O.city ?? null, rep: O.rep ?? null } : null,
    items: F.map((f, i) => ({ f: toFindingRow(f), refs: ev[i]!.refs, oursSource: f.oursSource, checks: ev[i]!.checks, audit: ev[i]!.audit })),
    today, override: kontrolaSubType(k),
  };
  return { k, F, firm, ev, input };
}

/** The generated documents (optionally with an accepted AI analysis). */
export function kontrolaDocs(c: Pick<KontrolaCase, 'input'>, ai?: KontrolaAiAnalysis | null): { external: CaseDoc; internal: CaseDoc } {
  const P = ai ? aiPatches(ai) : null;
  return { external: kontrolaSubmission(c.input, P?.external), internal: kontrolaInternal(c.input, P?.internal) };
}

export interface KontrolaTexts { draft?: string; internalDraft?: string }
export const kontrolaTexts = (k: Pick<Kontrola, 'data'>): KontrolaTexts => {
  const d = (k.data ?? {}) as KontrolaTexts;
  return { draft: typeof d.draft === 'string' ? d.draft : undefined, internalDraft: typeof d.internalDraft === 'string' ? d.internalDraft : undefined };
};

/** Patch `data` of a case under a row lock (versions / AI state are read-modify-write); `fn` returning null = no change. */
async function patchData(tx: Tx, firmId: string, kid: string, fn: (d: Record<string, unknown>) => Record<string, unknown> | null, userId: string | null): Promise<Record<string, unknown> | null> {
  const [k] = await tx.select({ data: kontroli.data }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firmId))).for('update').limit(1);
  if (!k) throw new OfficeError('Контролата не е пронајдена.');
  const next = fn({ ...(k.data ?? {}) });
  if (!next) return null;
  await tx.update(kontroli).set({ data: next, ...(userId ? { updatedBy: userId } : {}) }).where(eq(kontroli.id, kid));
  return next;
}

/**
 * Store the current generated documents as an `auto` version when at least one finding is disputed and the text
 * changed since the last auto version (called after every change of the case). Returns whether a version was added.
 */
export async function snapshotKontrolaDocs(tx: Tx, firmId: string, kid: string, userId: string | null, today = todaySkopje()): Promise<boolean> {
  const c = await loadKontrolaCase(tx, firmId, kid, today);
  if (!c || !c.input.items.some((it) => isDisputed(it.f))) return false;
  const D = kontrolaDocs(c);
  let added = false;
  await patchData(tx, firmId, kid, (d) => {
    const r = addVersion(versionsOf(d), { id: randomUUID(), at: new Date().toISOString(), kind: 'auto', type: D.external.choice.type, external: docText(D.external), internal: docText(D.internal), by: userId });
    added = r.added;
    return r.added ? { ...d, versions: r.list } : null;
  }, null);
  if (added) await audit(tx, { userId, firmId, action: 'kontrolaDocAuto', entityType: 'kontrola', entityId: kid, data: { type: D.external.choice.type } });
  return added;
}

/** The user's edited text (external or internal); empty = back to the generated text. Kept as an `edit` version. */
export async function saveKontrolaText(tx: Tx, firmId: string, kid: string, which: 'external' | 'internal', text: string, userId: string | null): Promise<void> {
  const t = text.slice(0, 100_000);
  const c = await loadKontrolaCase(tx, firmId, kid);
  if (!c) throw new OfficeError('Контролата не е пронајдена.');
  const D = kontrolaDocs(c);
  await patchData(tx, firmId, kid, (d) => {
    const key = which === 'external' ? 'draft' : 'internalDraft';
    const next: Record<string, unknown> = { ...d, [key]: t.trim() ? t : undefined };
    if (t.trim()) {
      const cur = kontrolaTexts({ data: next });
      next.versions = addVersion(versionsOf(d), { id: randomUUID(), at: new Date().toISOString(), kind: 'edit', type: D.external.choice.type, external: cur.draft ?? docText(D.external), internal: cur.internalDraft ?? docText(D.internal), by: userId }).list;
    }
    return next;
  }, userId);
  await audit(tx, { userId, firmId, action: 'kontrolaDraft', entityType: 'kontrola', entityId: kid, data: { which, chars: t.length } });
}

/** The document type the office picks (null = the program's choice). */
export async function setKontrolaSubType(tx: Tx, firmId: string, kid: string, type: string | null, userId: string | null): Promise<void> {
  const t = type && isSubmissionType(type) ? type : null;
  await patchData(tx, firmId, kid, (d) => ({ ...d, subType: t ?? undefined }), userId);
  await audit(tx, { userId, firmId, action: 'kontrolaSubType', entityType: 'kontrola', entityId: kid, data: { type: t } });
}

/** ↺ / ✓ Прифати: a stored version becomes the case's text (an AI version is marked accepted). */
export async function acceptKontrolaVersion(tx: Tx, firmId: string, kid: string, vid: string, userId: string | null): Promise<KontrolaVersion> {
  let v: KontrolaVersion | undefined;
  await patchData(tx, firmId, kid, (d) => {
    const L = versionsOf(d);
    v = L.find((x) => x.id === vid);
    if (!v) return null;
    return { ...d, draft: v.external, internalDraft: v.internal, versions: L.map((x) => (x.id === vid && x.kind === 'ai' ? { ...x, state: 'accepted' as const } : x)) };
  }, userId);
  if (!v) throw new OfficeError('Верзијата не е пронајдена.');
  await audit(tx, { userId, firmId, action: 'kontrolaVersionAccept', entityType: 'kontrola', entityId: kid, data: { version: vid, kind: v.kind, model: v.model ?? null } });
  return v;
}

/** ✕ Отфрли an AI version (it stays in the list, marked discarded). */
export async function discardKontrolaVersion(tx: Tx, firmId: string, kid: string, vid: string, userId: string | null): Promise<void> {
  let found = false;
  await patchData(tx, firmId, kid, (d) => {
    const L = versionsOf(d);
    found = L.some((x) => x.id === vid);
    return found ? { ...d, versions: L.map((x) => (x.id === vid ? { ...x, state: 'discarded' as const } : x)) } : null;
  }, userId);
  if (!found) throw new OfficeError('Верзијата не е пронајдена.');
  await audit(tx, { userId, firmId, action: 'kontrolaVersionDiscard', entityType: 'kontrola', entityId: kid, data: { version: vid } });
}

/** State of the „💲 AI правна анализа“ of a case (`data.ai`). */
export interface KontrolaAiState { status: 'queued' | 'done' | 'error'; reqId: string; at: string; deep?: boolean; by?: string | null; versionId?: string; model?: string; costUsd?: number; error?: string }
export const kontrolaAiState = (k: Pick<Kontrola, 'data'>): KontrolaAiState | null => ((k.data ?? {}) as { ai?: KontrolaAiState }).ai ?? null;

/** Ask for the AI analysis (the caller checks `office` and the AI budget, then enqueues `kontrola.ai`). */
export async function queueKontrolaAi(tx: Tx, firmId: string, kid: string, deep: boolean, userId: string | null): Promise<string> {
  const reqId = randomUUID();
  await patchData(tx, firmId, kid, (d) => {
    const cur = (d.ai ?? null) as KontrolaAiState | null;
    if (cur?.status === 'queued' && Date.now() - Date.parse(cur.at) < 10 * 60_000) throw new OfficeError('AI анализата веќе се изработува – почекајте.');
    return { ...d, ai: { status: 'queued', reqId, at: new Date().toISOString(), deep, by: userId } satisfies KontrolaAiState };
  }, userId);
  await audit(tx, { userId, firmId, action: 'kontrolaAiStart', entityType: 'kontrola', entityId: kid, data: { deep, reqId } });
  return reqId;
}

/** The worker's result: a new `ai` version (model, cost, the analysis and both improved documents) — nothing is applied until the user accepts it. */
export async function saveKontrolaAiResult(tx: Tx, firmId: string, kid: string, r: { reqId: string; analysis: KontrolaAiAnalysis; model: string; costUsd: number; userId: string | null }): Promise<string | null> {
  const c = await loadKontrolaCase(tx, firmId, kid);
  if (!c) return null;
  const D = kontrolaDocs(c, r.analysis);
  const id = randomUUID();
  const next = await patchData(tx, firmId, kid, (d) => {
    if (((d.ai ?? {}) as KontrolaAiState).reqId !== r.reqId) return null; // superseded by a newer request
    const L = addVersion(versionsOf(d), { id, at: new Date().toISOString(), kind: 'ai', type: D.external.choice.type, external: docText(D.external), internal: docText(D.internal), by: r.userId, model: r.model, costUsd: r.costUsd, ai: r.analysis, state: 'new' }).list;
    return { ...d, versions: L, ai: { ...(d.ai as KontrolaAiState), status: 'done', versionId: id, model: r.model, costUsd: r.costUsd, at: new Date().toISOString() } };
  }, null);
  if (!next) return null;
  await audit(tx, { userId: r.userId, firmId, action: 'kontrolaAi', entityType: 'kontrola', entityId: kid, data: { version: id, model: r.model, costUsd: r.costUsd, unverified: r.analysis.unverified.length } });
  return id;
}

export async function failKontrolaAi(tx: Tx, firmId: string, kid: string, reqId: string, error: string): Promise<void> {
  await patchData(tx, firmId, kid, (d) => (((d.ai ?? {}) as KontrolaAiState).reqId === reqId ? { ...d, ai: { ...(d.ai as KontrolaAiState), status: 'error', error: error.slice(0, 500) } } : null), null);
}

/* ====================================================================================================== */
/* Personal data                                                                                           */
/* ====================================================================================================== */

/** Add the default processing activities of an accounting client that are not yet recorded (ЗЗЛП чл. 34). */
export async function seedProcessingActivities(tx: Tx, firmId: string, userId: string | null, today = todaySkopje()): Promise<number> {
  const have = new Set((await tx.select({ data: gdprRecords.data }).from(gdprRecords).where(and(eq(gdprRecords.firmId, firmId), eq(gdprRecords.kind, 'activity'))))
    .map((r) => String((r.data as { key?: string }).key ?? '')));
  const add = DEFAULT_ACTIVITIES.filter((a) => !have.has(a.key));
  if (add.length) {
    await tx.insert(gdprRecords).values(add.map((a) => ({ kind: 'activity', firmId, subject: a.name, date: today, status: 'signed', data: { ...a } as Record<string, unknown>, createdBy: userId })));
  }
  await audit(tx, { userId, firmId, action: 'ropaSeed', entityType: 'gdpr_record', data: { added: add.map((a) => a.key) } });
  return add.length;
}
