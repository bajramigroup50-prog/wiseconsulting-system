/**
 * „📊 Месечен извештај за клиентот“ (read side + store) and the people notified about a „📷 Испрати документ“.
 *
 * The numbers are deterministic, from the books only (`@wise/core/office` `buildClientReport`): ledger lines of the
 * previous month's year up to the month end, the open issued invoices / purchases (payments matched in the bank as
 * everywhere: `documentPayments`), and the VAT period that contains the month end (a filed return's frozen field 31,
 * otherwise the computation with the period's corrections).
 */
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { periodDue, periodOf, perRange } from '@wise/core';
import { buildClientReport, monthBounds, prevMonth, type ClientReportData, type OpenDoc, type ReportVat } from '@wise/core/office';
import type { Tx } from './audit';
import { documentPayments } from './bank/open-items';
import { loadLedgerLines } from './ledger-queries';
import { firstMailAddress } from './mail-queue';
import { getOfficeProfile } from './office';
import { isDemoFirm } from '@wise/core/demo';
import { clientReports, firms, invoices, purchases, userFirms, users, vatPeriods, type Firm } from './schema/index';
import { computeVatPeriod, firmVatPeriodKind } from './vat-service';
import { defaultVatSource } from './vat-source';

/** VAT of the period that contains the month end (`partial` when the quarter goes on after the month). */
export async function reportVat(tx: Tx, firm: Firm, monthEnd: string): Promise<ReportVat | null> {
  if (!firm.vatRegistered) return null;
  const period = periodOf(monthEnd, firmVatPeriodKind(firm));
  const [, pend] = perRange(period);
  const [row] = await tx.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.period, period))).limit(1);
  const partial = monthEnd < pend;
  if (row?.status === 'closed' && row.ddv04) return { period, amount: row.ddv04.fields['31'] ?? 0, due: periodDue(period), closed: true, partial };
  const C = await computeVatPeriod(tx, firm, period, defaultVatSource, row?.corrections ?? {});
  return { period, amount: C.fields['31'] ?? 0, due: periodDue(period), closed: false, partial };
}

/** Issued invoices / purchases (not drafts, not client-pending) dated up to `to`, with what is still open. */
async function openDocs(tx: Tx, firmId: string, to: string): Promise<{ inv: OpenDoc[]; pur: OpenDoc[] }> {
  const [I, P] = await Promise.all([
    tx.select({ id: invoices.id, date: invoices.date, due: invoices.due }).from(invoices)
      .where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), notInArray(invoices.status, ['draft', 'pending']))),
    tx.select({ id: purchases.id, date: purchases.date, due: purchases.due }).from(purchases)
      .where(and(eq(purchases.firmId, firmId), notInArray(purchases.status, ['draft', 'pending']))),
  ]);
  const Ii = I.filter((x) => x.date <= to), Pp = P.filter((x) => x.date <= to);
  const M = await documentPayments(tx, firmId, { invoiceIds: Ii.map((x) => x.id), purchaseIds: Pp.map((x) => x.id) });
  const map = (L: { id: string; date: string; due: string | null }[]) => L.flatMap((x) => {
    const p = M.get(x.id);
    return p ? [{ remaining: p.remaining, date: x.date, due: x.due }] : [];
  });
  return { inv: map(Ii), pur: map(Pp) };
}

/** The report's numbers for a firm and month ('YYYY-MM'). Nothing is written. */
export async function computeClientReport(tx: Tx, firmId: string, period: string): Promise<ClientReportData> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new Error('Фирмата не постои.');
  const [, to] = monthBounds(period);
  const from = `${prevMonth(period).slice(0, 4)}-01-01`;
  const [lines, D, vat] = await Promise.all([loadLedgerLines(tx, firmId, from, to), openDocs(tx, firmId, to), reportVat(tx, firm, to).catch(() => null)]);
  return buildClientReport({ period, lines, invoices: D.inv, purchases: D.pur, vat });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * (Re)compute and store the report of a firm and month. When the numbers changed the AI summary is dropped (it was
 * written from the old numbers); a published / sent report stays visible to the client with the new numbers.
 */
export async function saveClientReport(tx: Tx, a: { firmId: string; period: string; userId: string | null; lang: 'mk' | 'sq' }): Promise<{ id: string; changed: boolean; created: boolean }> {
  const data = await computeClientReport(tx, a.firmId, a.period);
  const [old] = await tx.select().from(clientReports).where(and(eq(clientReports.firmId, a.firmId), eq(clientReports.period, a.period))).limit(1);
  if (!old) {
    const [r] = await tx.insert(clientReports).values({ firmId: a.firmId, period: a.period, data: data as never, lang: a.lang, createdBy: a.userId }).returning({ id: clientReports.id });
    return { id: r!.id, changed: true, created: true };
  }
  const changed = !same(old.data, data);
  if (changed || old.lang !== a.lang) {
    await tx.update(clientReports).set({ data: data as never, lang: a.lang, summary: null, aiStatus: 'none', aiError: null, aiModel: null }).where(eq(clientReports.id, old.id));
  }
  return { id: old.id, changed, created: false };
}

/**
 * Who is told about a document a client sent: the firm's responsible colleague (`firms.owner_id`) and the office users
 * explicitly assigned to the firm (active, not client / field / view-only), by e-mail; with nobody reachable the office
 * e-mail from the office profile (legacy `alBell` mail).
 */
export async function inboxRecipients(tx: Tx, firmId: string): Promise<string[]> {
  const [f] = await tx.select({ ownerId: firms.ownerId, name: firms.name, settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
  // 🎭 nobody is e-mailed about a demo firm (never the real office's address)
  if (isDemoFirm(f)) return [];
  const assigned = (await tx.select({ id: userFirms.userId }).from(userFirms).where(eq(userFirms.firmId, firmId))).map((r) => r.id);
  const ids = [...new Set([...(f?.ownerId ? [f.ownerId] : []), ...assigned])];
  const U = ids.length
    ? await tx.select({ email: users.email }).from(users)
      .where(and(inArray(users.id, ids), eq(users.active, true), notInArray(users.role, ['klient', 'teren', 'view'] as never[]), ne(users.email, '')))
    : [];
  const to = [...new Set(U.map((u) => firstMailAddress(u.email)).filter((x): x is string => !!x))];
  if (to.length) return to;
  const o = firstMailAddress((await getOfficeProfile(tx)).email);
  return o ? [o] : [];
}
