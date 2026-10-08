/**
 * Phase 9 office services shared by the web app and the worker: numbering, office settings, firm snapshots
 * for the autopilot / inspection checks, the autopilot run, recurring invoice issuing, client-entry approval
 * and reminder dispatch.
 *
 * Data owned by phases that are built in parallel (invoices, payroll, VAT closes, fiscal reports) is read
 * through `OfficeDataSources`; the defaults return `null` ("not available") so checks are skipped rather
 * than guessed. TODO(merge): the coordinator plugs the real readers in `defaultSources` after merging.
 */
import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import {
  alCompute, apExtra, apRisk, recIssue, todaySkopje, type ClientMessage, type DraftInvoice, type Finding, type FirmSnapshot,
  type InspEmployee, type RecDay, type RecEvery, type SnapshotEmployee, type SnapshotInvoice,
} from '@wise/core/office';
import { audit, type Tx } from './audit';
import { loadLedgerLines } from './ledger-queries';
import {
  appSettings, autopilotFindings, autopilotMessages, autopilotMetrics, autopilotRuns, clientEntries, dossierDocs, fileLinks,
  firmDeadlines, firmDocs, firms, inboxItems, officeCounters, officeTasks, partners, recurringInvoices, reminders, OFFICE_FILE_ENTITY,
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
}

/**
 * Defaults until Phases 3, 5, 6 and 7 are merged.
 * TODO(merge): Phase 3 `invoices` (+ paid amounts), Phase 6 `employees` / `payroll_runs`, Phase 5 VAT close
 * journals (kind `ddv`), Phase 7 `sales_daily` Z reports.
 */
export const defaultSources: OfficeDataSources = {
  invoices: async () => null,
  employees: async () => null,
  payrollMonths: async () => null,
  vatClosedPeriods: async () => null,
  fiscalDays: async () => null,
};

const settingsOf = (f: typeof firms.$inferSelect) => f.settings as {
  short?: string; nkd?: string; alOff?: Record<string, boolean>; alAck?: Record<string, string>; kasaCash?: string;
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
): Promise<(FirmSnapshot & { inspEmployees: InspEmployee[] | null }) | null> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) return null;
  const today = o.today ?? todaySkopje();
  const y = Number(today.slice(0, 4));
  const src = o.sources ?? defaultSources;
  const st = settingsOf(f);
  const [ledger, P, dossier, pend, invoices, emps, pm, vat, fisk] = await Promise.all([
    loadLedgerLines(tx, firmId, `${y}-01-01`, `${y}-12-31`),
    tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firmId)),
    tx.select({ category: dossierDocs.category, title: dossierDocs.title, validTo: dossierDocs.validTo }).from(dossierDocs).where(eq(dossierDocs.firmId, firmId)),
    pendingClientCount(tx, firmId),
    src.invoices(tx, firmId, y), src.employees(tx, firmId), src.payrollMonths(tx, firmId, y),
    src.vatClosedPeriods(tx, firmId, y), src.fiscalDays(tx, firmId, y),
  ]);
  return {
    firm: {
      id: f.id, name: f.name, short: st.short ?? null, vatRegistered: f.vatRegistered,
      vatPeriod: f.vatPeriod === 'month' ? 'month' : 'quarter', nkd: st.nkd ?? f.activity, alOff: st.alOff, alAck: st.alAck,
    },
    today, ledger, partnerNames: Object.fromEntries(P.map((p) => [p.id, p.name])), dossier, pendingClient: pend,
    cashAccounts: [...new Set(['1020', st.kasaCash ?? '1020'])],
    invoices, employees: emps, payrollMonths: pm, vatClosedPeriods: vat, fiscalDays: fisk,
    inspEmployees: emps, eurRate: o.eurRate, officeName: o.officeName,
  };
}

/* ---------------- Autopilot ---------------- */

export interface AutopilotResult { runId: string; firms: number; findings: number; newBad: number; messages: number; autoSent: number }

/**
 * One autopilot pass (legacy `apRun` 16295): every active firm except the office's own, findings upserted
 * by key (new / still present / resolved), metrics + peer risk, proposed client messages (deduped by key,
 * like `office_apsent`), optional auto-send to the portal and optional tasks for new `bad` findings.
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
          await sendAutopilotMessage(tx, g.key, { portal: true, mail: true }, null, 'автопилот');
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
  return { runId, firms: F.length, findings, newBad, messages, autoSent };
}

/**
 * Legacy `apSend`: deliver a proposed client message to the portal (an office → client inbox item) and log it.
 * TODO(mail): when `ch.mail` and the firm has an e-mail, enqueue Phase 6 `mail.send` ({to, subject, body,
 * firmId}) here; legacy also logged it in `maillog` under the *addressed* firm (FIX #11).
 */
export async function sendAutopilotMessage(tx: Tx, key: string, ch: { portal: boolean; mail: boolean }, userId: string | null, byName: string): Promise<string[]> {
  const [g] = await tx.select().from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
  if (!g || g.status === 'sent') return [];
  const ok: string[] = [];
  if (ch.portal) {
    await tx.insert(inboxItems).values({ firmId: g.firmId, fromOffice: true, done: true, subject: g.subject, note: g.body, fromUserId: userId, fromName: byName });
    ok.push('портал');
  }
  await tx.update(autopilotMessages).set({ status: 'sent', channels: ok.join(', '), sentBy: byName, sentAt: new Date() }).where(eq(autopilotMessages.key, key));
  await audit(tx, { userId, firmId: g.firmId, action: 'apSendOne', entityType: 'autopilot_message', entityId: key, data: { type: g.type, channels: ok } });
  return ok;
}

/* ---------------- Recurring invoices ---------------- */

/** Where issued recurring invoices go. Phase 3 owns invoices (numbering, posting via `invoiceEntries`). */
export interface InvoiceDraftSink {
  /** Create a *draft* invoice in the firm's books; returns a reference shown on the definition. */
  createDraft(tx: Tx, firmId: string, inv: DraftInvoice, userId: string | null): Promise<string>;
}

/**
 * Default sink until Phase 3 is merged: the draft is kept as `firm_docs(type='invoice_draft')`.
 * TODO(merge): replace with Phase 3's invoice service (draft status, number on approval, `postJournal`).
 */
export const firmDocInvoiceSink: InvoiceDraftSink = {
  async createDraft(tx, firmId, inv, userId) {
    const [d] = await tx.insert(firmDocs).values({ firmId, type: 'invoice_draft', date: inv.date, data: inv as unknown as Record<string, unknown>, status: 'draft', createdBy: userId })
      .returning({ id: firmDocs.id });
    return `firm_doc:${d!.id}`;
  },
};

export interface RecurringResult { issued: number; definitions: number; mail: string[] }

/**
 * Legacy `recIssue` / `recAutoCheck`: issue every due definition, catching up period by period (max 12),
 * each in its own transaction with an audit row. Returns ids of issued invoices that should be e-mailed.
 */
export async function issueDueRecurring(db: Tx, o: { today?: string; sink?: InvoiceDraftSink; firmId?: string; userId?: string | null } = {}): Promise<RecurringResult> {
  const today = o.today ?? todaySkopje();
  const sink = o.sink ?? firmDocInvoiceSink;
  const due = await db.select().from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.next, today), o.firmId ? eq(recurringInvoices.firmId, o.firmId) : undefined));
  let issued = 0;
  const mail: string[] = [];
  for (const r0 of due) {
    await db.transaction(async (tx) => {
      // Re-read under lock so two runners can't issue the same period twice.
      const [r] = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.id, r0.id)).for('update');
      if (!r) return;
      let next = r.next, active = r.active, last = r.last, lastRef = r.lastRef;
      for (let i = 0; i < 12; i++) {
        const day: RecDay = r.day === 'L' ? 'L' : Number(r.day) || 1;
        const x = recIssue({ id: r.id, partnerId: r.partnerId, items: r.items, active, next, end: r.end, every: r.every as RecEvery, day, dueDays: r.dueDays, note: r.note }, today);
        if (!x) break;
        lastRef = await sink.createDraft(tx, r.firmId, x.invoice, o.userId ?? null);
        if (r.mail) mail.push(lastRef); // TODO(mail): enqueue Phase 6 `mail.send` with the invoice PDF (legacy `recMail`).
        last = x.invoice.date; next = x.next; issued++;
        if (x.finished) { active = false; break; }
      }
      await tx.update(recurringInvoices).set({ next, active, last, lastRef }).where(eq(recurringInvoices.id, r.id));
      await audit(tx, { userId: o.userId ?? null, firmId: r.firmId, action: 'recRun', entityType: 'recurring_invoice', entityId: r.id, data: { next, last, lastRef } });
    });
  }
  return { issued, definitions: due.length, mail };
}

/* ---------------- Client entries ---------------- */

/** Turns an approved client entry into the owning module's document. */
export interface ClientEntryHandler {
  approve(tx: Tx, e: typeof clientEntries.$inferSelect, userId: string): Promise<{ targetType: string; targetId: string }>;
}

/**
 * Approval of a client entry (legacy `klAppr` 9141). Dossier documents are created here; purchases,
 * invoices and daily sales belong to Phases 3 / 7.
 * TODO(merge): register Phase 3 (`purchase`, `invoice`) and Phase 7 (`sale`) handlers — they must create the
 * document *and* post it with `postJournal` in this same transaction. Until then the data is kept as a
 * `firm_docs` draft (`client_<kind>`) for the office to re-enter.
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
};

const fallbackHandler: ClientEntryHandler = {
  async approve(tx, e, userId) {
    const [d] = await tx.insert(firmDocs).values({ firmId: e.firmId, type: `client_${e.kind}`, data: e.data, status: 'draft', createdBy: userId })
      .returning({ id: firmDocs.id });
    await relinkFiles(tx, OFFICE_FILE_ENTITY.clientEntry, e.id, 'firm_doc', d!.id);
    return { targetType: 'firm_doc', targetId: d!.id };
  },
};

/** Copy file links from one entity to another (the original links stay for traceability). */
export async function relinkFiles(tx: Tx, fromType: string, fromId: string, toType: string, toId: string): Promise<void> {
  const L = await tx.select().from(fileLinks).where(and(eq(fileLinks.entityType, fromType), eq(fileLinks.entityId, fromId)));
  if (L.length) await tx.insert(fileLinks).values(L.map((l) => ({ fileId: l.fileId, entityType: toType, entityId: toId, role: l.role }))).onConflictDoNothing();
}

export class OfficeError extends Error {}

/** Approve or reject a pending client entry. The caller must have checked `requireCan('office', firmId)`. */
export async function decideClientEntry(tx: Tx, id: string, firmId: string, decision: 'approve' | 'reject', userId: string, note?: string): Promise<void> {
  const [e] = await tx.select().from(clientEntries).where(and(eq(clientEntries.id, id), eq(clientEntries.firmId, firmId))).for('update');
  if (!e) throw new OfficeError('Записот не постои.');
  if (e.status !== 'pending') throw new OfficeError('Записот е веќе обработен.');
  let target: { targetType: string; targetId: string } | null = null;
  if (decision === 'approve') target = await (clientEntryHandlers[e.kind] ?? fallbackHandler).approve(tx, e, userId);
  await tx.update(clientEntries).set({
    status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: userId, decidedAt: new Date(), decisionNote: note ?? null,
    targetType: target?.targetType ?? null, targetId: target?.targetId ?? null,
  }).where(eq(clientEntries.id, id));
  await audit(tx, { userId, firmId, action: decision === 'approve' ? 'klAppr' : 'klRej', entityType: 'client_entry', entityId: id, data: { kind: e.kind, ...target } });
  // TODO(mail): notify the client (`mail.send`) that the entry was approved / rejected.
}

/* ---------------- Reminders ---------------- */

/**
 * Raise reminders for firm deadlines that enter their window, then deliver every due reminder:
 * `portal` → office message in the client inbox; `app` → stays visible in the office (marked sent);
 * `mail` → TODO(mail): enqueue Phase 6 `mail.send`.
 */
export async function dispatchReminders(db: Tx, now = new Date()): Promise<{ created: number; sent: number }> {
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
  for (const r of due) {
    await db.transaction(async (tx) => {
      if (r.channel === 'portal' && r.firmId) {
        await tx.insert(inboxItems).values({ firmId: r.firmId, fromOffice: true, done: true, subject: r.title, note: r.body, fromName: 'Канцеларија' });
      }
      // TODO(mail): r.channel === 'mail' → enqueue Phase 6 `mail.send` to the user's / firm's e-mail.
      await tx.update(reminders).set({ status: 'sent', sentAt: now }).where(eq(reminders.id, r.id));
    });
  }
  return { created, sent: due.length };
}

/** Open findings per firm for dashboards. */
export async function openFindings(tx: Tx, firmIds?: string[]) {
  return tx.select().from(autopilotFindings)
    .where(and(isNull(autopilotFindings.resolvedAt), firmIds ? inArray(autopilotFindings.firmId, firmIds) : undefined));
}
