/**
 * Phase 9 office services shared by the web app and the worker: numbering, office settings, firm snapshots
 * for the autopilot / inspection checks, the autopilot run, recurring invoice issuing, client-entry approval
 * and reminder dispatch.
 *
 * Data owned by other modules (invoices with paid amounts, employees and payroll runs, VAT closes and the VAT
 * due estimate, fiscal Z reports) is read through `OfficeDataSources`; `defaultSources` reads the real tables.
 * A source may still return `null` ("not available") — the check is then skipped rather than guessed.
 */
import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import {
  alCompute, apExtra, apRisk, CLIENT_ENTRY_KINDS, dmy, DOS_CAT, fmtMk, INBOX_ROUTE_TARGET, recIssue, todaySkopje, type ClientMessage, type DraftInvoice, type Finding,
  type FirmSnapshot, type InboxRoute, type InspEmployee, type InspLoans, type RecDay, type RecEvery, type SnapshotEmployee, type SnapshotInvoice, type SnapshotVatEstimate,
} from '@wise/core/office';
import { audit, type Tx } from './audit';
import { documentPayments } from './bank/open-items';
import { effectiveChart, loadLedgerLines } from './ledger-queries';
import { loanStateOf } from './lawrep';
import { firstMailAddress, queueMailRow, textMailHtml } from './mail-queue';
import { saveInvoice } from './sales/invoices';
import { fileAlreadyUsed, savePurchase } from './sales/purchases';
import { saveSalesDay } from './stock-docs';
import { vatDueEstimate } from './vat-estimate';
import {
  aiDocuments, appSettings, autopilotFindings, autopilotMessages, autopilotMetrics, autopilotRuns, clientEntries, dossierDocs, employees, fileLinks, files,
  firmDeadlines, firms, inboxItems, invoices, officeCounters, officeTasks, partners, payrollRuns, recurringInvoices, reminders,
  salesDaily, users, vatPeriods, OFFICE_FILE_ENTITY,
} from './schema/index';

/* ---------------- Numbering (FIX #8) ---------------- */

/**
 * Next number of a per-year office counter. Atomic (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) — legacy
 * `kdNextNo` incremented a shared document without a transaction and fell back to `length + 1`, producing
 * duplicate contract numbers.
 */
export async function nextOfficeNumber(tx: Tx, key: string, year: number): Promise<number> {
  const [r] = await tx.insert(officeCounters).values({ key, year, value: 1 })
    .onConflictDoUpdate({ target: [officeCounters.key, officeCounters.year], set: { value: sql`${officeCounters.value} + 1` } })
    .returning({ value: officeCounters.value });
  return r!.value;
}

/** Contract number `СУ-001/2026` (legacy `kdNextNo`). */
export const contractNumber = (n: number, year: number, prefix = 'СУ') => `${prefix}-${String(n).padStart(3, '0')}/${year}`;

/* ---------------- Office settings (FIX #7) ---------------- */

export interface OfficeProfile {
  name?: string; edb?: string; address?: string; city?: string; rep?: string; repRole?: string;
  eurRate?: number; email?: string; phone?: string;
  /** Autopilot: message types sent automatically to the client portal. */
  apAuto?: Partial<Record<ClientMessage['type'], boolean>>;
  /** Autopilot: create an office task for new `bad` findings. */
  apTasks?: boolean;
  zzlp?: { chk?: Record<string, boolean> };
}

export async function getOfficeProfile(tx: Tx): Promise<OfficeProfile> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'office')).limit(1);
  return (r?.v as OfficeProfile | undefined) ?? {};
}

/**
 * Merge a patch into the office profile with a single `jsonb ||` statement. Legacy overwrote the whole
 * `appsettings/office` document from 12 writers, so concurrent edits clobbered each other.
 */
export async function patchOfficeProfile(tx: Tx, patch: Partial<OfficeProfile>, userId: string | null): Promise<void> {
  const p = JSON.stringify(patch);
  await tx.insert(appSettings).values({ key: 'office', value: patch, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${appSettings.value} || ${p}::jsonb`, updatedBy: userId } });
}

/* ---------------- Data from other phases ---------------- */

export interface OfficeDataSources {
  /** Phase 3: issued invoices of the year with paid amounts. */
  invoices(tx: Tx, firmId: string, year: number): Promise<SnapshotInvoice[] | null>;
  /** Phase 6: employees (with HR dates for the inspection checks). */
  employees(tx: Tx, firmId: string): Promise<(SnapshotEmployee & InspEmployee)[] | null>;
  /** Phase 6: months `YYYY-MM` with a computed payroll. */
  payrollMonths(tx: Tx, firmId: string, year: number): Promise<string[] | null>;
  /** Phase 5: VAT periods (start dates) whose ДДВ-04 is posted. */
  vatClosedPeriods(tx: Tx, firmId: string, year: number): Promise<string[] | null>;
  /** Phase 7: days with a fiscal Z report. */
  fiscalDays(tx: Tx, firmId: string, year: number): Promise<string[] | null>;
  /** Phase 5: VAT due for the current / just-ended period (legacy `apExtra` step 4); null = none. */
  vatEstimate(tx: Tx, firmId: string, today: string): Promise<SnapshotVatEstimate | null>;
}

const yearRange = (y: number) => sql`between ${`${y}-01-01`} and ${`${y}-12-31`}`;

/**
 * Issued invoices and credit notes of the year with paid amounts. Paid / total come from the bank open-items
 * service (`documentPayments`: bank lines, credit notes, compensations, cash vouchers, journal refs); drafts and
 * client-submitted invoices only take part in the numbering check (they are not receivables yet).
 */
export async function officeInvoices(tx: Tx, firmId: string, year: number): Promise<SnapshotInvoice[]> {
  const I = await tx.select({
    id: invoices.id, kind: invoices.kind, status: invoices.status, number: invoices.number, date: invoices.date, due: invoices.due,
    advance: invoices.advance, total: invoices.total, fx: invoices.fx,
  }).from(invoices).where(and(eq(invoices.firmId, firmId), inArray(invoices.kind, ['invoice', 'credit']), sql`${invoices.date} ${yearRange(year)}`))
    .orderBy(asc(invoices.date), asc(invoices.number));
  const pay = await documentPayments(tx, firmId, { invoiceIds: I.filter((i) => i.kind === 'invoice' && i.status === 'posted').map((i) => i.id) });
  return I.map((i) => {
    const p = pay.get(i.id);
    const total = p ? p.total : Math.round(Number(i.total) * (Number(i.fx) || 1) * 100) / 100;
    return {
      number: i.number, date: i.date, due: i.due, credit: i.kind === 'credit', advance: i.advance,
      total, paid: p ? p.paid : total,
    };
  });
}

/** Employees with the HR dates the inspection checks need. */
export async function officeEmployees(tx: Tx, firmId: string): Promise<(SnapshotEmployee & InspEmployee)[]> {
  const E = await tx.select().from(employees).where(eq(employees.firmId, firmId)).orderBy(asc(employees.name));
  return E.map((e) => ({
    name: e.name, active: e.active, start: e.start, end: e.end, embg: e.embg, position: e.position,
    m1Date: e.m1Date, lekDate: e.lekDate, bzrDate: e.bzrDate, leaveDays: e.leaveDays,
  }));
}

/** Real readers over the module tables. */
export const defaultSources: OfficeDataSources = {
  invoices: officeInvoices,
  employees: officeEmployees,
  // a computed payroll (draft or posted run) counts, like legacy `S.data.payroll.some(p => p.month === m)`
  payrollMonths: async (tx, firmId, year) => (await tx.select({ m: payrollRuns.month }).from(payrollRuns)
    .where(and(eq(payrollRuns.firmId, firmId), sql`${payrollRuns.month} like ${`${year}-%`}`))).map((r) => r.m).sort(),
  // ДДВ-04 posted = the VAT period is closed; identified by its start date
  vatClosedPeriods: async (tx, firmId, year) => (await tx.select({ d: vatPeriods.dateFrom }).from(vatPeriods)
    .where(and(eq(vatPeriods.firmId, firmId), eq(vatPeriods.status, 'closed'), sql`${vatPeriods.dateFrom} ${yearRange(year)}`))).map((r) => r.d).sort(),
  // days with a fiscal daily report (legacy `sales.filter(z => z.fisk)`)
  fiscalDays: async (tx, firmId, year) => [...new Set((await tx.select({ d: salesDaily.date }).from(salesDaily)
    .where(and(eq(salesDaily.firmId, firmId), eq(salesDaily.kind, 'fisk'), sql`${salesDaily.date} ${yearRange(year)}`))).map((r) => r.d))].sort(),
  vatEstimate: (tx, firmId, today) => vatDueEstimate(tx, firmId, today),
};

const settingsOf = (f: typeof firms.$inferSelect) => f.settings as {
  short?: string; nkd?: string; alOff?: Record<string, boolean>; alAck?: Record<string, string>; kasaCash?: string;
  akontDD?: number | string; muni?: string;
};

/** Pending client entries + undone client inbox messages for a firm (legacy part of `alCompute`). */
export async function pendingClientCount(tx: Tx, firmId: string): Promise<number> {
  const [a] = await tx.select({ n: sql<number>`count(*)::int` }).from(clientEntries).where(and(eq(clientEntries.firmId, firmId), eq(clientEntries.status, 'pending')));
  const [b] = await tx.select({ n: sql<number>`count(*)::int` }).from(inboxItems)
    .where(and(eq(inboxItems.firmId, firmId), eq(inboxItems.done, false), eq(inboxItems.fromOffice, false)));
  return (a?.n ?? 0) + (b?.n ?? 0);
}

/** Everything the pure checks need for one firm. */
export async function buildFirmSnapshot(
  tx: Tx, firmId: string, o: { today?: string; sources?: OfficeDataSources; eurRate?: number; officeName?: string } = {},
): Promise<(FirmSnapshot & { inspEmployees: InspEmployee[] | null; inspLoans: InspLoans | null }) | null> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) return null;
  const today = o.today ?? todaySkopje();
  const y = Number(today.slice(0, 4));
  const src = o.sources ?? defaultSources;
  const st = settingsOf(f);
  // sequential: the readers share the caller's transaction (one connection)
  const ledger = await loadLedgerLines(tx, firmId, `${y}-01-01`, `${y}-12-31`);
  const P = await tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firmId));
  const dossier = await tx.select({ category: dossierDocs.category, title: dossierDocs.title, validTo: dossierDocs.validTo }).from(dossierDocs).where(eq(dossierDocs.firmId, firmId));
  const pend = await pendingClientCount(tx, firmId);
  const invoices = await src.invoices(tx, firmId, y);
  const emps = await src.employees(tx, firmId);
  const pm = await src.payrollMonths(tx, firmId, y);
  const vat = await src.vatClosedPeriods(tx, firmId, y);
  const fisk = await src.fiscalDays(tx, firmId, y);
  let vatEstimate: SnapshotVatEstimate | null = null;
  // legacy wrapped the VAT step in try/catch: an estimate that cannot be computed must not stop the other checks
  if (f.vatRegistered) try { vatEstimate = await src.vatEstimate(tx, firmId, today); } catch { vatEstimate = null; }
  return {
    firm: {
      id: f.id, name: f.name, short: st.short ?? null, vatRegistered: f.vatRegistered,
      vatPeriod: f.vatPeriod === 'month' ? 'month' : 'quarter', nkd: st.nkd ?? f.activity, alOff: st.alOff, alAck: st.alAck,
      akontDD: Number(st.akontDD) || null, muni: st.muni ?? null,
    },
    today, ledger, partnerNames: Object.fromEntries(P.map((p) => [p.id, p.name])), dossier, pendingClient: pend,
    cashAccounts: [...new Set(['1020', st.kasaCash ?? '1020'])],
    invoices, employees: emps, payrollMonths: pm, vatClosedPeriods: vat, fiscalDays: fisk, vatEstimate,
    // the inspection looks at the people currently employed
    inspEmployees: emps ? emps.filter((e) => e.active) : null, eurRate: o.eurRate, officeName: o.officeName,
    inspLoans: await (async () => {
      try {
        const chart = await effectiveChart(tx, firmId);
        const S = await loanStateOf(tx, f, ledger, Object.fromEntries(chart.map((c) => [c.code, c.name])), today);
        return { rows: S.rows.map((r) => ({ bal: r.bal, over: r.over, noSig: r.noSig })), unlinked: S.unlinked.map((m) => ({ date: m.date, amt: m.amt })) };
      } catch { return null; }
    })(),
  };
}

/* ---------------- Autopilot ---------------- */

export interface AutopilotResult { runId: string; firms: number; findings: number; newBad: number; messages: number; autoSent: number; mailIds: string[] }

/**
 * One autopilot pass (legacy `apRun` 16295): every active firm except the office's own, findings upserted
 * by key (new / still present / resolved), metrics + peer risk, proposed client messages (deduped by key,
 * like `office_apsent`), optional auto-send to the portal / e-mail and optional tasks for new `bad` findings.
 * Returns the queued `mail_log` ids of auto-sent messages for the caller to dispatch.
 */
export async function runAutopilot(db: Tx, o: { trigger?: 'cron' | 'manual'; today?: string; sources?: OfficeDataSources; userId?: string | null } = {}): Promise<AutopilotResult> {
  const today = o.today ?? todaySkopje();
  const off = await getOfficeProfile(db);
  const [run] = await db.insert(autopilotRuns).values({ trigger: o.trigger ?? 'cron' }).returning({ id: autopilotRuns.id });
  const runId = run!.id;
  const F = (await db.select().from(firms).where(eq(firms.active, true)).orderBy(asc(firms.name)))
    .filter((f) => !(f.settings as { officeFirm?: boolean }).officeFirm);
  const rows: { id: string; m: Record<string, number | string | null> }[] = [];
  let findings = 0, newBad = 0, messages = 0, autoSent = 0;
  const mailIds: string[] = [];
  const now = new Date();
  for (const f of F) {
    const S = await buildFirmSnapshot(db, f.id, { today, sources: o.sources, eurRate: off.eurRate, officeName: off.name });
    if (!S) continue;
    const A: Finding[] = alCompute(S);
    const X = apExtra(S);
    const all = [...A, ...X.adds];
    rows.push({ id: f.id, m: X.m });
    findings += all.length;
    await db.transaction(async (tx) => {
      const existing = await tx.select({ key: autopilotFindings.key, resolvedAt: autopilotFindings.resolvedAt })
        .from(autopilotFindings).where(eq(autopilotFindings.firmId, f.id));
      const open = new Set(existing.filter((e) => !e.resolvedAt).map((e) => e.key));
      for (const a of all) {
        if (a.lvl === 'bad' && !open.has(a.key)) newBad++;
        await tx.insert(autopilotFindings).values({ firmId: f.id, key: a.key, lvl: a.lvl, cat: a.cat, txt: a.txt, go: a.go })
          .onConflictDoUpdate({
            target: [autopilotFindings.firmId, autopilotFindings.key],
            set: { lvl: a.lvl, txt: a.txt, go: a.go, lastSeen: now, resolvedAt: null },
          });
        if (a.lvl === 'bad' && !open.has(a.key) && off.apTasks) {
          await tx.insert(officeTasks).values({
            title: `${f.name}: ${a.cat}`, description: a.txt, firmId: f.id, type: 'Друго', inst: 'Друго', prio: 'high',
            sourceKey: `ap:${f.id}:${a.key}`.slice(0, 500), hist: [{ at: now.toISOString(), by: 'автопилот', st: 'new', note: '' }],
          }).onConflictDoNothing();
        }
      }
      const keys = all.map((a) => a.key);
      await tx.update(autopilotFindings).set({ resolvedAt: now })
        .where(and(eq(autopilotFindings.firmId, f.id), isNull(autopilotFindings.resolvedAt), keys.length ? notInArray(autopilotFindings.key, keys) : undefined));
      for (const g of X.msgs) {
        const [ins] = await tx.insert(autopilotMessages).values({ key: g.key, firmId: f.id, type: g.type, subject: g.subj, body: g.body })
          .onConflictDoNothing().returning({ key: autopilotMessages.key });
        if (!ins) continue;
        messages++;
        if (off.apAuto?.[g.type]) {
          mailIds.push(...(await sendAutopilotMessage(tx, g.key, { portal: true, mail: true }, null, 'автопилот')).mailIds);
          autoSent++;
        }
      }
    });
  }
  const R = apRisk(rows);
  for (const r of rows) {
    const k = R.get(r.id)!;
    await db.insert(autopilotMetrics).values({ firmId: r.id, runId, metrics: r.m, risk: k.score, riskWhy: k.why })
      .onConflictDoUpdate({ target: autopilotMetrics.firmId, set: { runId, metrics: r.m, risk: k.score, riskWhy: k.why } });
  }
  await db.update(autopilotRuns).set({ finishedAt: new Date(), firms: F.length, findings }).where(eq(autopilotRuns.id, runId));
  await audit(db, { userId: o.userId ?? null, action: 'apRun', entityType: 'autopilot_run', entityId: runId, data: { firms: F.length, findings, newBad, messages, autoSent } });
  return { runId, firms: F.length, findings, newBad, messages, autoSent, mailIds };
}

/** Result of a delivery: channels used (`портал`, `е-пошта`) and queued `mail_log` ids to dispatch after COMMIT. */
export interface Delivered { channels: string[]; mailIds: string[] }

/** E-mail of a firm (first valid address of `firms.email`). */
/** First valid e-mail address of the firm (client), or null. */
export async function firmMail(tx: Tx, firmId: string): Promise<string | null> {
  const [f] = await tx.select({ email: firms.email }).from(firms).where(eq(firms.id, firmId)).limit(1);
  return firstMailAddress(f?.email);
}

/**
 * Legacy `apSend`: deliver a proposed client message to the portal (an office → client inbox item) and, when
 * `ch.mail` and the firm has an e-mail, queue it as a `mail_log` row of the *addressed* firm (FIX #11 — legacy
 * logged it under the open firm). The caller dispatches `mailIds` after COMMIT (web `dispatchMail`, worker
 * `mail.send`); undelivered rows are sent by `mail.flush`.
 */
export async function sendAutopilotMessage(tx: Tx, key: string, ch: { portal: boolean; mail: boolean }, userId: string | null, byName: string): Promise<Delivered> {
  const [g] = await tx.select().from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
  if (!g || g.status === 'sent') return { channels: [], mailIds: [] };
  const ok: string[] = [], mailIds: string[] = [];
  if (ch.portal) {
    await tx.insert(inboxItems).values({ firmId: g.firmId, fromOffice: true, done: true, subject: g.subject, note: g.body, fromUserId: userId, fromName: byName });
    ok.push('портал');
  }
  const to = ch.mail ? await firmMail(tx, g.firmId) : null;
  if (to) {
    mailIds.push(await queueMailRow(tx, { firmId: g.firmId, to, subject: g.subject, html: textMailHtml(g.body), entityType: 'autopilot_message', entityId: key, userId }));
    ok.push('е-пошта');
  }
  await tx.update(autopilotMessages).set({ status: 'sent', channels: ok.join(', '), sentBy: byName, sentAt: new Date() }).where(eq(autopilotMessages.key, key));
  await audit(tx, { userId, firmId: g.firmId, action: 'apSendOne', entityType: 'autopilot_message', entityId: key, data: { type: g.type, channels: ok } });
  return { channels: ok, mailIds };
}

/* ---------------- Recurring invoices ---------------- */

/** Job that renders an issued invoice as PDF and e-mails it to the buyer (worker `invoice.mail`). */
export const INVOICE_MAIL_JOB = 'invoice.mail';
/** Payload of {@link INVOICE_MAIL_JOB}; without `to` the job uses the buyer's e-mail. */
export interface InvoiceMailRequest { invoiceId: string; to?: string; userId?: string | null }

/** Where issued recurring invoices go. Phase 3 owns invoices (numbering, posting via `invoiceEntries`). */
export interface InvoiceDraftSink {
  /**
   * Create the invoice in the firm's books: a `draft` (number taken, not booked) or, with `post`, an issued and
   * booked invoice. Returns the reference stored on the definition and the invoice id.
   */
  createDraft(tx: Tx, firmId: string, inv: DraftInvoice, userId: string | null, o?: { post?: boolean }): Promise<{ ref: string; invoiceId: string }>;
}

/** Phase 3 invoice service (`saveInvoice`): one line per item, VAT rate from the definition, `draft` unless posted. */
export const phase3InvoiceSink: InvoiceDraftSink = {
  async createDraft(tx, firmId, inv, userId, o = {}) {
    const r = await saveInvoice(tx, firmId, {
      kind: 'invoice', date: inv.date, pdate: inv.date, due: inv.due, partnerId: inv.partnerId, note: inv.note, draft: !o.post,
      lines: inv.items.map((l) => ({ itemId: l.itemId || null, name: l.name, unit: l.unit ?? null, qty: l.qty, price: l.price, rate: l.vat })),
    }, { userId, role: 'acc' });
    return { ref: `invoice:${r.id}`, invoiceId: r.id };
  },
};

export interface RecurringResult {
  issued: number;
  definitions: number;
  /** Issued invoices to e-mail (enqueue {@link INVOICE_MAIL_JOB} after COMMIT). */
  mail: InvoiceMailRequest[];
  /** Definitions that could not be issued (e.g. locked period, deleted buyer) — the others still run. */
  errors: { id: string; firmId: string; error: string }[];
}

/**
 * Legacy `recIssue` / `recAutoCheck`: issue every due definition, catching up period by period (max 12),
 * each definition in its own transaction with an audit row.
 *
 * The invoices are Phase 3 `draft` invoices (number assigned, not booked) that the office approves in the invoice
 * list (`approveInvoice` books them). Definitions with `mail` are issued *and booked* right away, like legacy
 * `recIssue` did for every invoice: an invoice sent to the buyer must be in the books. Those are returned in
 * `mail` for the caller to enqueue `invoice.mail` (legacy `recMail`).
 */
export async function issueDueRecurring(db: Tx, o: { today?: string; sink?: InvoiceDraftSink; firmId?: string; userId?: string | null } = {}): Promise<RecurringResult> {
  const today = o.today ?? todaySkopje();
  const sink = o.sink ?? phase3InvoiceSink;
  const due = await db.select().from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.next, today), o.firmId ? eq(recurringInvoices.firmId, o.firmId) : undefined));
  let issued = 0;
  const mail: InvoiceMailRequest[] = [], errors: RecurringResult['errors'] = [];
  for (const r0 of due) {
    try {
      const out = await db.transaction(async (tx) => {
        // Re-read under lock so two runners can't issue the same period twice.
        const [r] = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.id, r0.id)).for('update');
        if (!r) return null;
        let next = r.next, active = r.active, last = r.last, lastRef = r.lastRef, n = 0;
        const M: InvoiceMailRequest[] = [];
        const [p] = r.mail ? await tx.select({ email: partners.email }).from(partners).where(eq(partners.id, r.partnerId)).limit(1) : [];
        const to = firstMailAddress(p?.email);
        for (let i = 0; i < 12; i++) {
          const day: RecDay = r.day === 'L' ? 'L' : Number(r.day) || 1;
          const x = recIssue({ id: r.id, partnerId: r.partnerId, items: r.items, active, next, end: r.end, every: r.every as RecEvery, day, dueDays: r.dueDays, note: r.note }, today);
          if (!x) break;
          const c = await sink.createDraft(tx, r.firmId, x.invoice, o.userId ?? null, { post: r.mail });
          lastRef = c.ref;
          if (r.mail) M.push({ invoiceId: c.invoiceId, ...(to ? { to } : {}), userId: o.userId ?? null });
          last = x.invoice.date; next = x.next; n++;
          if (x.finished) { active = false; break; }
        }
        await tx.update(recurringInvoices).set({ next, active, last, lastRef }).where(eq(recurringInvoices.id, r.id));
        await audit(tx, { userId: o.userId ?? null, firmId: r.firmId, action: 'recRun', entityType: 'recurring_invoice', entityId: r.id, data: { next, last, lastRef, issued: n, mail: M.length } });
        return { n, M };
      });
      if (out) { issued += out.n; mail.push(...out.M); }
    } catch (e) {
      errors.push({ id: r0.id, firmId: r0.firmId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { issued, definitions: due.length, mail, errors };
}

/* ---------------- Client entries ---------------- */

/** Turns an approved client entry into the owning module's document. */
export interface ClientEntryHandler {
  approve(tx: Tx, e: typeof clientEntries.$inferSelect, userId: string): Promise<{ targetType: string; targetId: string }>;
}

/** What `klSend` `submitEntry` stores for a purchase / invoice / daily sale. */
interface ClientDocData { number?: string | null; date?: string | null; partnerName?: string | null; partnerEdb?: string | null; total?: number; vat?: number; due?: string | null; note?: string | null }

const VAT_RATES = [18, 10, 5, 0] as const;
const r2c = (n: number) => Math.round(n * 100) / 100;

/** Base, VAT and the VAT rate closest to vat / base (the client enters only the total and the VAT). */
export function clientVatSplit(total: number, vat: number): { base: number; vat: number; rate: number } {
  const t = r2c(Number(total) || 0), v = r2c(Number(vat) || 0);
  const base = r2c(t - v);
  if (!v || base <= 0) return { base: t, vat: 0, rate: 0 };
  const pct = (v / base) * 100;
  const rate = [...VAT_RATES].sort((a, b) => Math.abs(a - pct) - Math.abs(b - pct))[0]!;
  return { base, vat: v, rate };
}

/** Partner of the firm by ЕДБ, else by name; created when missing (the office sees it in the warnings / partner list). */
async function clientPartner(tx: Tx, firmId: string, name: string | null | undefined, edb: string | null | undefined, userId: string): Promise<string | null> {
  const n = String(name ?? '').trim(), e = String(edb ?? '').trim();
  if (e) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.edb, e))).limit(1);
    if (p) return p.id;
  }
  if (n) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), sql`lower(${partners.name}) = lower(${n})`)).limit(1);
    if (p) return p.id;
    const [c] = await tx.insert(partners).values({ firmId, name: n, edb: e || null }).returning({ id: partners.id });
    await audit(tx, { userId, firmId, action: 'addPartner', entityType: 'partner', entityId: c!.id, data: { name: n, edb: e || null, from: 'client_entry' } });
    return c!.id;
  }
  return null;
}

const entryFiles = async (tx: Tx, id: string) =>
  (await tx.select({ f: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.clientEntry), eq(fileLinks.entityId, id)))).map((r) => r.f);

const docDate = (e: typeof clientEntries.$inferSelect, d: ClientDocData) => d.date || e.submittedAt.toISOString().slice(0, 10);
const officeActor = (userId: string) => ({ userId, role: 'acc' });

/**
 * Approval of a client entry (legacy `klAppr` 9141: approve = save + post). Each handler creates the owning module's
 * document *and* books it through that module's service, in the caller's transaction (the service writes its own
 * audit row): purchases and invoices through Phase 3 (`savePurchase` / `saveInvoice`), daily sales (Z report)
 * through Phase 7 (`saveSalesDay`), dossier documents here. The entry's files follow the document.
 */
export const clientEntryHandlers: Record<string, ClientEntryHandler> = {
  dossier: {
    async approve(tx, e, userId) {
      const d = e.data as { category?: string; title?: string; number?: string; date?: string; validTo?: string; note?: string };
      const [doc] = await tx.insert(dossierDocs).values({
        firmId: e.firmId, category: d.category || 'Друго', title: d.title || null, number: d.number || null,
        date: d.date || null, validTo: d.validTo || null, note: d.note || null, createdBy: userId,
      }).returning({ id: dossierDocs.id });
      await relinkFiles(tx, OFFICE_FILE_ENTITY.clientEntry, e.id, OFFICE_FILE_ENTITY.dossier, doc!.id);
      return { targetType: OFFICE_FILE_ENTITY.dossier, targetId: doc!.id };
    },
  },
  purchase: {
    async approve(tx, e, userId) {
      const d = e.data as ClientDocData;
      const v = clientVatSplit(d.total ?? 0, d.vat ?? 0);
      const partnerId = await clientPartner(tx, e.firmId, d.partnerName, d.partnerEdb, userId);
      const r = await savePurchase(tx, e.firmId, {
        number: d.number ?? null, date: docDate(e, d), docDate: d.date ?? null, due: d.due ?? null, partnerId, ptype: 'cost',
        groups: [{ rate: v.rate, base: v.base, vat: v.vat }], fileIds: await entryFiles(tx, e.id), scanned: true,
      }, officeActor(userId));
      return { targetType: 'purchase', targetId: r.id };
    },
  },
  invoice: {
    async approve(tx, e, userId) {
      const d = e.data as ClientDocData;
      const v = clientVatSplit(d.total ?? 0, d.vat ?? 0);
      const partnerId = await clientPartner(tx, e.firmId, d.partnerName, d.partnerEdb, userId);
      if (!partnerId) throw new OfficeError('Внесете купувач во записот.');
      const r = await saveInvoice(tx, e.firmId, {
        kind: 'invoice', number: d.number ?? null, date: docDate(e, d), due: d.due ?? null, partnerId, note: d.note ?? null, scanned: true,
        lines: [{ name: d.note?.trim() || 'Според приложената фактура', qty: 1, price: v.base, rate: v.rate }],
      }, officeActor(userId));
      await relinkFiles(tx, OFFICE_FILE_ENTITY.clientEntry, e.id, 'invoice', r.id);
      return { targetType: 'invoice', targetId: r.id };
    },
  },
  sale: {
    async approve(tx, e, userId) {
      const d = e.data as ClientDocData;
      const v = clientVatSplit(d.total ?? 0, d.vat ?? 0);
      const r = await saveSalesDay(tx, { firmId: e.firmId, userId }, {
        kind: 'fisk', date: docDate(e, d), number: d.number ?? null, gross: { [v.rate]: r2c(v.base + v.vat) }, total: r2c(v.base + v.vat), note: d.note ?? null,
      });
      await relinkFiles(tx, OFFICE_FILE_ENTITY.clientEntry, e.id, 'sales_daily', r.id);
      return { targetType: 'sales_daily', targetId: r.id };
    },
  },
};

/** Copy file links from one entity to another (the original links stay for traceability). */
export async function relinkFiles(tx: Tx, fromType: string, fromId: string, toType: string, toId: string): Promise<void> {
  const L = await tx.select().from(fileLinks).where(and(eq(fileLinks.entityType, fromType), eq(fileLinks.entityId, fromId)));
  if (L.length) await tx.insert(fileLinks).values(L.map((l) => ({ fileId: l.fileId, entityType: toType, entityId: toId, role: l.role }))).onConflictDoNothing();
}

export class OfficeError extends Error {}

/**
 * Approve or reject a pending client entry. The caller must have checked `requireCan('office', firmId)`.
 * A rejection leaves a portal message with the reason (legacy `klRej`). Either way the client is notified by
 * e-mail (the submitting user's address, else the firm's): the `mail_log` row is queued in this transaction and
 * its id returned for the caller to dispatch after COMMIT (`dispatchMail`; `mail.flush` otherwise).
 */
export async function decideClientEntry(tx: Tx, id: string, firmId: string, decision: 'approve' | 'reject', userId: string, note?: string): Promise<{ mailIds: string[]; target: { targetType: string; targetId: string } | null }> {
  const [e] = await tx.select().from(clientEntries).where(and(eq(clientEntries.id, id), eq(clientEntries.firmId, firmId))).for('update');
  if (!e) throw new OfficeError('Записот не постои.');
  if (e.status !== 'pending') throw new OfficeError('Записот е веќе обработен.');
  let target: { targetType: string; targetId: string } | null = null;
  if (decision === 'approve') {
    const h = clientEntryHandlers[e.kind];
    if (!h) throw new OfficeError('Непознат вид на запис.');
    target = await h.approve(tx, e, userId);
  }
  await tx.update(clientEntries).set({
    status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: userId, decidedAt: new Date(), decisionNote: note ?? null,
    targetType: target?.targetType ?? null, targetId: target?.targetId ?? null,
  }).where(eq(clientEntries.id, id));
  await audit(tx, { userId, firmId, action: decision === 'approve' ? 'klAppr' : 'klRej', entityType: 'client_entry', entityId: id, data: { kind: e.kind, ...target } });

  const d = e.data as ClientDocData & { title?: string };
  const what = `${CLIENT_ENTRY_KINDS[e.kind as keyof typeof CLIENT_ENTRY_KINDS] ?? 'Документ'}${d.number ? ` бр. ${d.number}` : d.title ? ` „${d.title}“` : ''}${d.date ? ` од ${dmy(d.date)}` : ''}`;
  const subject = decision === 'approve' ? `✓ Одобрено: ${what}` : `❌ Одбиено од канцеларијата: ${what}`;
  const body = decision === 'approve'
    ? `Почитувани,\n\n${what}${d.total ? ` (${fmtMk(d.total)} ден.)` : ''} е одобрен и прокнижен од канцеларијата.${note ? `\n\nЗабелешка: ${note}` : ''}`
    : `Почитувани,\n\n${what} е одбиен од канцеларијата.${note ? `\n\nПричина: ${note}` : ''}\n\nПроверете го и испратете го повторно преку порталот.`;
  if (decision === 'reject') {
    await tx.insert(inboxItems).values({ firmId, fromOffice: true, done: true, subject, note: note ?? null, fromUserId: userId, fromName: 'Канцеларија' });
  }
  const [u] = e.submittedBy ? await tx.select({ email: users.email }).from(users).where(eq(users.id, e.submittedBy)).limit(1) : [];
  const to = firstMailAddress(u?.email) ?? await firmMail(tx, firmId);
  const mailIds = to ? [await queueMailRow(tx, { firmId, to, subject, html: textMailHtml(body), entityType: 'client_entry', entityId: id, userId })] : [];
  return { mailIds, target };
}

/* ---------------- Client inbox routing ---------------- */

export interface InboxRouteResult {
  /** What was created (`dossier_doc:<id>` / `ai_document:<id>,…`), stored on the inbox item. */
  ref: string | null;
  /** Screen where the office continues (null = nothing more to do). */
  go: string | null;
  /** `ai_documents` queued for reading — enqueue `ai.read-document` `{docId}` after COMMIT. */
  aiDocIds: string[];
  /** Files skipped because the same file is already attached to a purchase / invoice. */
  skipped: string[];
}

/**
 * Legacy `irGo` / `irRoute` / `irArch` (14024–14041): send the files of a client inbox message (one file by its index
 * in upload order, or all of them) to the module that books them — purchases / issued invoices are queued for AI
 * reading into the scan review (`/skan`), the rest is archived in the firm dossier under the route's category
 * (dossier: the chosen category). Marks the message handled with the route, audited. The caller has checked
 * `requireCan('office', firmId)`.
 */
export async function routeInboxFiles(tx: Tx, a: { itemId: string; firmId: string; fileIdx: number | null; kind: InboxRoute; category?: string | null; userId: string }): Promise<InboxRouteResult> {
  const T = INBOX_ROUTE_TARGET[a.kind];
  if (!T) throw new OfficeError('Непозната цел.');
  const [i] = await tx.select().from(inboxItems).where(and(eq(inboxItems.id, a.itemId), eq(inboxItems.firmId, a.firmId))).for('update').limit(1);
  if (!i) throw new OfficeError('Пораката не постои.');
  const all = await tx.select({ id: files.id, name: files.name }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.inbox), eq(fileLinks.entityId, i.id))).orderBy(asc(files.createdAt), asc(files.name));
  const F = a.fileIdx == null ? all : all.slice(a.fileIdx, a.fileIdx + 1);
  if (a.fileIdx != null && !F.length) throw new OfficeError('Документот не постои.');
  const out: InboxRouteResult = { ref: null, go: T.go, aiDocIds: [], skipped: [] };
  if (T.ai) {
    if (!F.length) throw new OfficeError('Пораката нема прикачен документ.');
    for (const f of F) {
      const used = await fileAlreadyUsed(tx, a.firmId, [f.id]);
      if (used) { out.skipped.push(`${f.name}: веќе е прикачен на ${used.entityType === 'purchase' ? 'влезна фактура' : 'излезна фактура'}`); continue; }
      const [d] = await tx.insert(aiDocuments).values({ firmId: a.firmId, fileId: f.id, kind: T.ai, createdBy: a.userId, options: { inboxId: i.id } })
        .returning({ id: aiDocuments.id });
      out.aiDocIds.push(d!.id);
    }
    out.ref = out.aiDocIds.length ? `ai_document:${out.aiDocIds.join(',')}` : null;
  } else {
    const cat = a.kind === 'dossier' && a.category && (DOS_CAT as readonly string[]).includes(a.category) ? a.category : T.dossier ?? 'Друго';
    const one = F.length === 1 ? F[0]!.name : null;
    const [d] = await tx.insert(dossierDocs).values({
      firmId: a.firmId, category: cat, title: (one ? `${cat} – ${one}` : i.subject ?? i.note?.slice(0, 80) ?? cat).slice(0, 200),
      date: i.createdAt.toISOString().slice(0, 10), fromInboxId: i.id, createdBy: a.userId,
    }).returning({ id: dossierDocs.id });
    if (F.length) await tx.insert(fileLinks).values(F.map((f) => ({ fileId: f.id, entityType: OFFICE_FILE_ENTITY.dossier, entityId: d!.id }))).onConflictDoNothing();
    out.ref = `dossier_doc:${d!.id}`;
  }
  await tx.update(inboxItems).set({ done: true, doneBy: a.userId, doneAt: new Date(), route: a.kind, routeRef: out.ref }).where(eq(inboxItems.id, i.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'irGo', entityType: 'inbox_item', entityId: i.id, data: { route: a.kind, fileIdx: a.fileIdx, ref: out.ref, skipped: out.skipped.length } });
  return out;
}

/* ---------------- Reminders ---------------- */

/**
 * Raise reminders for firm deadlines that enter their window, then deliver every due reminder:
 * `portal` → office message in the client inbox; `app` → stays visible in the office (marked sent);
 * `mail` → a queued `mail_log` row to the reminder's user (else the firm's e-mail); the ids are returned for the
 * caller to send (worker `mail.send`; the `mail.flush` sweep picks up anything left `queued`).
 */
export async function dispatchReminders(db: Tx, now = new Date()): Promise<{ created: number; sent: number; mailIds: string[] }> {
  const today = todaySkopje(now);
  const D = await db.select().from(firmDeadlines)
    .where(and(eq(firmDeadlines.done, false), sql`${firmDeadlines.due} - ${firmDeadlines.remindDays} <= ${today}::date`));
  let created = 0;
  for (const d of D) {
    const r = await db.insert(reminders).values({
      firmId: d.firmId, title: `Рок: ${d.title}`, body: d.note, dueAt: now, channel: 'app', key: `deadline:${d.id}:${d.due}`,
    }).onConflictDoNothing().returning({ id: reminders.id });
    created += r.length;
  }
  const due = await db.select().from(reminders).where(and(eq(reminders.status, 'pending'), lte(reminders.dueAt, now)));
  const mailIds: string[] = [];
  for (const r of due) {
    await db.transaction(async (tx) => {
      if (r.channel === 'portal' && r.firmId) {
        await tx.insert(inboxItems).values({ firmId: r.firmId, fromOffice: true, done: true, subject: r.title, note: r.body, fromName: 'Канцеларија' });
      }
      if (r.channel === 'mail') {
        const [u] = r.userId ? await tx.select({ email: users.email }).from(users).where(eq(users.id, r.userId)).limit(1) : [];
        const to = firstMailAddress(u?.email) ?? (r.firmId ? await firmMail(tx, r.firmId) : null);
        if (to) mailIds.push(await queueMailRow(tx, { firmId: r.firmId, to, subject: r.title, html: textMailHtml(r.body ?? r.title), entityType: 'reminder', entityId: r.id, userId: null }));
      }
      await tx.update(reminders).set({ status: 'sent', sentAt: now }).where(eq(reminders.id, r.id));
    });
  }
  return { created, sent: due.length, mailIds };
}

/** Open findings per firm for dashboards. */
export async function openFindings(tx: Tx, firmIds?: string[]) {
  return tx.select().from(autopilotFindings)
    .where(and(isNull(autopilotFindings.resolvedAt), firmIds ? inArray(autopilotFindings.firmId, firmIds) : undefined));
}
