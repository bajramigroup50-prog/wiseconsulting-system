/**
 * „🧾 Месечна фактура за сметководствени услуги“ (office owner only) — the monthly invoices of the office firm
 * (БАЈРАМИ ГРОУП, „Фирма на канцеларијата“, `kdOfficeFirm`) to every client with a contract fee:
 * - `feePreview`: the plan of a month (`kdRecPlan` fees → `feePlan`): new / already issued / recurring / outside the contract;
 * - `issueFeeInvoices`: one booked invoice per client in the office firm's series (Phase 3 `saveInvoice`, number of the
 *   issued series, posted), one `fee_invoices` row per client and month (unique — never billed twice), the client's
 *   partner created in the office firm when missing; each client in its own transaction;
 * - `feePortalItem`: the portal message of the client firm the PDF is attached to (worker `fee.deliver`);
 * - `feeRows`: the issued invoices with paid / remaining from the office firm's bank statements (`documentPayments`);
 * - `runFeeReminders`: the polite overdue reminders (portal + e-mail) after N days, every M days, at most K.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  FEE_DEF, feeDue, feeInvoiceText, feeLineName, feePlan, feeReminderDue, feeReminderText, feeToIssue, type FeePlanRow, type FeeSettings,
} from '@wise/core/firms/kdfee';
import { kdOfficeFirm, kdRecPlan, kdVat, KD_SVC, type KdOffice, type KdRecExisting } from '@wise/core/firms/kdog';
import { todaySkopje } from '@wise/core/office';
import { audit, type Tx } from './audit';
import { documentPayments } from './bank/open-items';
import { firstMailAddress, queueMailRow, textMailHtml } from './mail-queue';
import { getOfficeProfile, OfficeError } from './office';
import { saveInvoice } from './sales/invoices';
import { feeInvoices, firms, inboxItems, invoices, items, partners, recurringInvoices, serviceContracts, type Firm } from './schema/index';

export const FEE_DELIVER_JOB = 'fee.deliver';

export interface FeeCtx { O: KdOffice; off: Firm; rate: number; S: FeeSettings }

/** Office settings, the office firm and the VAT rate; null when the office firm is not set. */
export async function feeContext(db: Tx): Promise<FeeCtx | null> {
  const O = (await getOfficeProfile(db)) as KdOffice & { feeInv?: FeeSettings };
  const off = kdOfficeFirm(await db.select().from(firms), O);
  if (!off) return null;
  return { O, off, rate: kdVat(O), S: { ...FEE_DEF, ...(O.feeInv ?? {}), remind: { ...FEE_DEF.remind, ...(O.feeInv?.remind ?? {}) } } };
}

/** The plan of month `ym`. */
export async function feePreview(db: Tx, ym: string, ctx?: FeeCtx | null): Promise<{ ctx: FeeCtx; plan: FeePlanRow[]; noFee: number } | null> {
  const c = ctx ?? await feeContext(db);
  if (!c) return null;
  const [F, P, R, I] = await Promise.all([
    db.select({ id: firms.id, name: firms.name, edb: firms.edb, embs: firms.embs, active: firms.active, settings: firms.settings }).from(firms),
    db.select({ id: partners.id, edb: partners.edb, embs: partners.embs }).from(partners).where(eq(partners.firmId, c.off.id)),
    db.select().from(recurringInvoices).where(eq(recurringInvoices.firmId, c.off.id)),
    db.select({ client: feeInvoices.clientFirmId, id: feeInvoices.invoiceId, number: feeInvoices.number }).from(feeInvoices).where(eq(feeInvoices.period, ym)),
  ]);
  const ex = new Map<string, KdRecExisting>(R.map((r) => [r.id, { id: r.id, price: Number(r.items[0]?.price) || 0, end: r.end }]));
  const rows = kdRecPlan(F, c.off.id, P, ex, c.rate);
  const active = new Set(R.filter((r) => r.active).map((r) => r.id));
  const rec = new Map<string, string>();
  for (const x of rows) { const id = (x.firm.settings as { kdRecId?: string } | null)?.kdRecId; if (id && active.has(id)) rec.set(x.firm.id, id); }
  const clients = F.filter((f) => f.id !== c.off.id && f.active !== false && !(f.settings as { example?: boolean; archived?: boolean })?.example && !(f.settings as { archived?: boolean })?.archived);
  return { ctx: c, plan: feePlan(rows, ym, c.rate, new Map(I.map((i) => [i.client, { id: i.id, number: i.number }])), rec), noFee: clients.length - rows.length };
}

const nextCode = (existing: readonly (string | null | undefined)[]): string => {
  const L = existing.map((x) => String(x ?? '').trim()).filter((v) => /^\d+$/.test(v));
  let w = 0, mx = 0;
  for (const v of L) { mx = Math.max(mx, +v); if (v.length > 1 && v[0] === '0') w = Math.max(w, v.length); }
  return w ? String(mx + 1).padStart(w, '0') : String(mx + 1);
};

/** The client's partner in the office firm (by ЕДБ / ЕМБС), created from the client firm when missing. */
async function clientPartner(tx: Tx, offId: string, client: Firm, userId: string | null): Promise<string> {
  const dig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
  const P = await tx.select({ id: partners.id, edb: partners.edb, embs: partners.embs, code: partners.code }).from(partners).where(eq(partners.firmId, offId));
  const p = P.find((x) => (dig(client.edb) && dig(x.edb) === dig(client.edb)) || (dig(client.embs) && dig(x.embs) === dig(client.embs)));
  if (p) return p.id;
  const [np] = await tx.insert(partners).values({
    firmId: offId, code: nextCode(P.map((x) => x.code)), name: client.name, edb: client.edb, embs: client.embs, address: client.address, city: client.city,
    email: client.email, phone: client.phone, vatRegistered: client.vatRegistered, bankAccount: ((client.settings ?? {}) as { bankAccount?: string }).bankAccount ?? null,
  }).returning({ id: partners.id });
  await audit(tx, { userId, firmId: offId, action: 'partnerNew', entityType: 'partner', entityId: np!.id, data: { name: client.name, source: 'feeIssue' } });
  return np!.id;
}

/** The office firm's item „Сметководствени услуги“ (`settings.recItem`, else by name), or none (line without an item). */
async function feeItem(tx: Tx, off: Firm) {
  const recItem = (off.settings as { recItem?: string }).recItem;
  const [a] = recItem && /^[0-9a-f-]{36}$/i.test(recItem) ? await tx.select().from(items).where(and(eq(items.id, recItem), eq(items.firmId, off.id))).limit(1) : [];
  if (a) return a;
  const [b] = await tx.select().from(items).where(and(eq(items.firmId, off.id), eq(items.active, true), sql`${items.name} ~* 'сметководствени\\s+услуги'`)).limit(1);
  return b ?? null;
}

export interface FeeIssued { feeId: string; invoiceId: string; number: string; clientFirmId: string; name: string }
export interface FeeIssueResult { issued: FeeIssued[]; errors: { firmId: string; name: string; error: string }[]; skipped: number }

/**
 * Issue (book) the invoices of month `ym` dated `date` for the plan rows to issue (`feeToIssue`). With
 * `includeRecurring`, the client's old recurring definition is switched off in the same transaction. The caller
 * enqueues `fee.deliver` for each issued row (PDF to the portal and by e-mail).
 */
export async function issueFeeInvoices(db: Tx, a: {
  ym: string; date?: string; userId: string | null; role?: string; only?: readonly string[]; includeRecurring?: boolean; source?: 'manual' | 'auto';
}): Promise<FeeIssueResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(a.ym)) throw new OfficeError('Неважечки месец.');
  const date = a.date ?? todaySkopje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OfficeError('Неважечки датум на фактурата.');
  const pv = await feePreview(db, a.ym);
  if (!pv) throw new OfficeError('Прво одредете ја фирмата на канцеларијата – од неа се фактурираат услугите.');
  const { ctx, plan } = pv;
  const todo = feeToIssue(plan, { includeRecurring: a.includeRecurring, only: a.only });
  const out: FeeIssueResult = { issued: [], errors: [], skipped: plan.length - todo.length };
  for (const r of todo) {
    try {
      const x = await db.transaction(async (tx) => {
        // the unique (client, month) row is the lock: a second click / the automatic run finds it and stops
        const [ex] = await tx.select({ id: feeInvoices.id }).from(feeInvoices).where(and(eq(feeInvoices.clientFirmId, r.firmId), eq(feeInvoices.period, a.ym))).limit(1);
        if (ex) return null;
        const [client] = await tx.select().from(firms).where(eq(firms.id, r.firmId)).limit(1);
        if (!client) throw new OfficeError('Фирмата не постои.');
        const pid = r.partnerId ?? await clientPartner(tx, ctx.off.id, client, a.userId);
        const it = await feeItem(tx, ctx.off);
        const kd = ((client.settings ?? {}) as { kdog?: { payDay?: number | string; no?: string } }).kdog ?? {};
        const due = feeDue(date, a.ym, kd.payDay);
        const [k] = await tx.select({ data: serviceContracts.data }).from(serviceContracts)
          .where(and(eq(serviceContracts.firmId, client.id), sql`${serviceContracts.status} <> 'draft'`)).orderBy(desc(serviceContracts.date)).limit(1);
        const svc = (k?.data as { svc?: string[] } | undefined)?.svc;
        const svcTxt = Array.isArray(svc) && svc.length ? ' Услуги: ' + KD_SVC.filter((s) => svc.includes(s[0])).map((s) => s[1]).join('; ') + '.' : '';
        const s = await saveInvoice(tx, ctx.off.id, {
          kind: 'invoice', date, pdate: date, due, partnerId: pid, svc: true,
          note: `${r.no ? `Според договор ${r.no}.` : ''}${svcTxt}`.trim() || null,
          lines: [{ itemId: it?.id ?? null, name: feeLineName(a.ym), unit: it?.unit || 'ком', qty: 1, price: (r.net / 100).toFixed(2), rate: r.rate }],
        }, { userId: a.userId, role: a.role ?? 'admin' });
        const [inv] = await tx.select({ total: invoices.total, base: invoices.base, vat: invoices.vat }).from(invoices).where(eq(invoices.id, s.id)).limit(1);
        const [row] = await tx.insert(feeInvoices).values({
          officeFirmId: ctx.off.id, clientFirmId: r.firmId, period: a.ym, invoiceId: s.id, partnerId: pid, number: s.number, date, due,
          net: inv?.base ?? (r.net / 100).toFixed(2), vat: inv?.vat ?? (r.vat / 100).toFixed(2), gross: inv?.total ?? (r.gross / 100).toFixed(2),
          source: a.source ?? 'manual', createdBy: a.userId,
        }).returning({ id: feeInvoices.id });
        if (r.st === 'периодична' && r.recurring) {
          await tx.update(recurringInvoices).set({ active: false }).where(and(eq(recurringInvoices.id, r.recurring), eq(recurringInvoices.firmId, ctx.off.id)));
          await audit(tx, { userId: a.userId, firmId: ctx.off.id, action: 'recOff', entityType: 'recurring_invoice', entityId: r.recurring, data: { reason: 'feeIssue', client: r.name } });
        }
        await audit(tx, { userId: a.userId, firmId: ctx.off.id, action: 'feeIssue', entityType: 'invoice', entityId: s.id, data: { client: r.name, clientFirmId: r.firmId, period: a.ym, number: s.number, net: r.net / 100, source: a.source ?? 'manual' } });
        return { feeId: row!.id, invoiceId: s.id, number: s.number, clientFirmId: r.firmId, name: r.name };
      });
      if (x) out.issued.push(x); else out.skipped++;
    } catch (e) {
      out.errors.push({ firmId: r.firmId, name: r.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/**
 * The client-portal message of an issued fee invoice (created once; `portal_item_id`), its text and the client's
 * e-mail. The worker attaches the PDF to the message (`file_links` `inbox_item`) and e-mails it.
 */
export async function feePortalItem(tx: Tx, feeId: string): Promise<{ itemId: string | null; invoiceId: string; clientFirmId: string; to: string | null; subject: string; body: string } | null> {
  const [f] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, feeId)).for('update').limit(1);
  if (!f?.invoiceId) return null;
  const ctx = await feeContext(tx);
  const [client] = await tx.select().from(firms).where(eq(firms.id, f.clientFirmId)).limit(1);
  if (!ctx || !client) return null;
  const bank = ((ctx.off.settings ?? {}) as { bankAccount?: string }).bankAccount ?? ctx.O.bank ?? null;
  const t = feeInvoiceText({ number: f.number ?? '', date: f.date, due: f.due, gross: Math.round(Number(f.gross) * 100), ym: f.period, office: ctx.off.name, bank });
  let itemId = f.portalItemId;
  if (!itemId && ctx.S.portal !== false) {
    const [it] = await tx.insert(inboxItems).values({ firmId: client.id, fromOffice: true, done: true, subject: t.subject, note: t.body, fromName: ctx.off.name }).returning({ id: inboxItems.id });
    itemId = it!.id;
    await tx.update(feeInvoices).set({ portalItemId: itemId }).where(eq(feeInvoices.id, f.id));
  }
  return { itemId, invoiceId: f.invoiceId, clientFirmId: client.id, to: ctx.S.mail !== false ? firstMailAddress(client.email) : null, subject: t.subject, body: t.body };
}

export interface FeeListRow { id: string; clientFirmId: string; client: string; period: string; number: string | null; date: string; due: string; gross: number; paid: number; remaining: number; reminders: number; lastReminder: string | null; mailedAt: Date | null; portal: boolean; invoiceId: string | null }

/** Issued fee invoices (newest first) with paid / remaining (cents) from the office firm's bank statements. */
export async function feeRows(db: Tx, o: { offId: string; periods?: readonly string[]; limit?: number }): Promise<FeeListRow[]> {
  const R = await db.select({ f: feeInvoices, client: firms.name }).from(feeInvoices).innerJoin(firms, eq(firms.id, feeInvoices.clientFirmId))
    .where(and(eq(feeInvoices.officeFirmId, o.offId), o.periods?.length ? inArray(feeInvoices.period, [...o.periods]) : undefined))
    .orderBy(desc(feeInvoices.period), firms.name).limit(o.limit ?? 2000);
  const ids = R.map((r) => r.f.invoiceId).filter((x): x is string => !!x);
  const pay = await documentPayments(db, o.offId, { invoiceIds: ids });
  return R.map(({ f, client }) => {
    const p = f.invoiceId ? pay.get(f.invoiceId) : undefined;
    const gross = Math.round(Number(f.gross) * 100);
    const paid = p ? Math.round(p.paid * 100) : 0;
    return {
      id: f.id, clientFirmId: f.clientFirmId, client, period: f.period, number: f.number, date: f.date, due: f.due, gross, paid,
      remaining: p ? Math.round(p.remaining * 100) : gross - paid, reminders: f.reminders, lastReminder: f.lastReminder, mailedAt: f.mailedAt,
      portal: !!f.portalItemId, invoiceId: f.invoiceId,
    };
  });
}

/**
 * Send the polite overdue reminders due today (portal message to the client firm + e-mail when `mail`). Returns the
 * queued `mail_log` ids for the caller to dispatch after COMMIT.
 */
export async function runFeeReminders(db: Tx, o: { today?: string; mail: boolean; userId?: string | null; only?: readonly string[] }): Promise<{ sent: number; mailIds: string[] }> {
  const today = o.today ?? todaySkopje();
  const ctx = await feeContext(db);
  if (!ctx || !ctx.S.remind?.on) return { sent: 0, mailIds: [] };
  const rows = (await feeRows(db, { offId: ctx.off.id })).filter((r) => (!o.only?.length || o.only.includes(r.id)) && feeReminderDue(r, today, ctx.S.remind));
  const bank = ((ctx.off.settings ?? {}) as { bankAccount?: string }).bankAccount ?? ctx.O.bank ?? null;
  let sent = 0;
  const mailIds: string[] = [];
  for (const r of rows) {
    await db.transaction(async (tx) => {
      const [f] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, r.id)).for('update').limit(1);
      if (!f || f.reminders !== r.reminders) return; // another run got here first
      const n = f.reminders + 1;
      const t = feeReminderText({ n, number: f.number ?? '', date: f.date, due: f.due, remaining: r.remaining, ym: f.period, client: r.client, office: ctx.off.name, bank });
      const ch: string[] = [];
      if (ctx.S.portal !== false) { await tx.insert(inboxItems).values({ firmId: f.clientFirmId, fromOffice: true, done: true, subject: t.subject, note: t.body, fromName: ctx.off.name }); ch.push('портал'); }
      const [cl] = await tx.select({ email: firms.email }).from(firms).where(eq(firms.id, f.clientFirmId)).limit(1);
      const to = o.mail ? firstMailAddress(cl?.email) : null;
      if (to) { mailIds.push(await queueMailRow(tx, { firmId: ctx.off.id, to, subject: t.subject, html: textMailHtml(t.body), entityType: 'fee_reminder', entityId: f.id, userId: o.userId ?? null })); ch.push('е-пошта'); }
      if (!ch.length) return;
      await tx.update(feeInvoices).set({ reminders: n, lastReminder: today }).where(eq(feeInvoices.id, f.id));
      await audit(tx, { userId: o.userId ?? null, firmId: ctx.off.id, action: 'feeRemind', entityType: 'fee_invoice', entityId: f.id, data: { client: r.client, number: f.number, n, remaining: r.remaining / 100, channels: ch } });
      sent++;
    });
  }
  return { sent, mailIds };
}
