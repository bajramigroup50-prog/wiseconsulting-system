/**
 * P43 — „⏰ Неплатени фактури и опомени“ prepared weekly: per firm, the customers with overdue unpaid invoices and the
 * suggested letter level (legacy `opData` / `opLvAuto`, `@wise/core/firms/dunning` `opGroups`), stored as one draft
 * per firm (`automation_drafts` kind `dunning`, period `-`). NOTHING is sent: the letters stay the office's click on
 * the opomeni screen. The open-invoice and partner queries are shared with that screen (`apps/web/lib/firms-office.ts`).
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { opGroups, opOnlyFilter, type OpLetter } from '@wise/core/firms/dunning';
import { todaySkopje } from '@wise/core/office';
import type { Tx } from '../audit';
import { documentPayments } from '../bank/open-items';
import { dunningLetters, invoices, partners, type Firm } from '../schema/index';
import { autoFirms, autoOn, dropDraft, noteAutoRun, upsertDraft } from './common';

export const DUN_KIND = 'dunning';

const numOr = (v: unknown, d: number) => { const n = Number(String(v ?? '').replace(',', '.')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : d; };
const misc = (f: Pick<Firm, 'settings'>) => (f.settings ?? {}) as { payDays?: unknown; opRate?: unknown; opCost?: unknown };
/** Legacy `firm.payDays` (default 15), `opRate` (%), `opCost` (den.). */
export const payDaysOf = (f: Pick<Firm, 'settings'>) => numOr(misc(f).payDays, 15);
export const opRateOf = (f: Pick<Firm, 'settings'>) => numOr(misc(f).opRate, 0);
export const opCostOf = (f: Pick<Firm, 'settings'>) => numOr(misc(f).opCost, 0);

export interface OpenDocRow {
  id: string; number: string; date: string; pdate: string | null; due: string | null; partnerId: string | null;
  /** Cents (MKD counter-value). */
  total: number; paid: number;
}
const cents = (v: number) => Math.round(v * 100);

/**
 * Issued invoices (not drafts, not client-pending) with paid / remaining (legacy `invTotal − paidFor`), optionally up to
 * a date. Only rows with something still open are returned unless `all`.
 */
export async function openInvoices(tx: Tx, firmId: string, o: { until?: string; all?: boolean } = {}): Promise<OpenDocRow[]> {
  const I = await tx.select({ id: invoices.id, number: invoices.number, date: invoices.date, pdate: invoices.pdate, due: invoices.due, partnerId: invoices.partnerId })
    .from(invoices).where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), ne(invoices.status, 'pending')));
  const L = o.until ? I.filter((i) => i.date <= o.until!) : I;
  const P = await documentPayments(tx, firmId, { invoiceIds: L.map((i) => i.id) });
  const out: OpenDocRow[] = [];
  for (const i of L) {
    const p = P.get(i.id);
    if (!p) continue;
    const r = { ...i, total: cents(p.total), paid: cents(p.paid) };
    if (o.all || r.total - r.paid > 0) out.push(r);
  }
  return out;
}

export interface PartnerInfo { name: string; email: string | null; phone: string | null; address: string | null; city: string | null; edb: string | null }

/** id → name / contacts of the firm's partners. */
export async function partnerNamesOf(tx: Pick<Tx, 'select'>, firmId: string, ids: readonly (string | null)[]): Promise<Map<string, PartnerInfo & { id: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const R = await tx.select({ id: partners.id, name: partners.name, email: partners.email, phone: partners.phone, address: partners.address, city: partners.city, edb: partners.edb })
    .from(partners).where(and(eq(partners.firmId, firmId), inArray(partners.id, want)));
  return new Map(R.map((r) => [r.id, r]));
}

/** Legacy `opData`: the open invoices grouped by customer with the suggested level, and the partners. */
export async function dunningGroups(tx: Tx, firm: Firm, today: string, only: readonly string[] | null = null) {
  const [inv, letters] = await Promise.all([
    openInvoices(tx, firm.id),
    tx.select().from(dunningLetters).where(eq(dunningLetters.firmId, firm.id)).orderBy(desc(dunningLetters.createdAt)),
  ]);
  const L: OpLetter[] = letters.map((d) => ({ partnerId: d.partnerId, invoiceIds: d.invoiceIds, level: d.level, channel: d.channel, date: d.date, total: Math.round(Number(d.total) * 100) }));
  const G = opGroups(opOnlyFilter(inv, only), L, payDaysOf(firm), today);
  const P = await partnerNamesOf(tx, firm.id, G.map((g) => (g.pid === '—' ? null : g.pid)));
  const pOf = (pid: string): PartnerInfo => P.get(pid) ?? { name: '(без купувач)', email: null, phone: null, address: null, city: null, edb: null };
  return { G, pOf };
}

export interface AutoDunningResult { firms: number; customers: number; total: number; byLevel: [number, number, number]; skipped: boolean }

/** Weekly (Monday 06:30): the suggested letters per firm — prepared, never sent. */
export async function runAutoDunning(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoDunningResult> {
  const out: AutoDunningResult = { firms: 0, customers: 0, total: 0, byLevel: [0, 0, 0], skipped: false };
  if (!o.force && !(await autoOn(db, 'dunning'))) return { ...out, skipped: true };
  const today = o.today ?? todaySkopje();
  for (const f of await autoFirms(db)) {
    const { G, pOf } = await dunningGroups(db, f, today);
    const over = G.filter((g) => g.over > 0);
    await db.transaction(async (tx) => {
      if (!over.length) { await dropDraft(tx, DUN_KIND, f.id, '-'); return; }
      const rows = over.map((g) => ({ pid: g.pid, name: pOf(g.pid).name, email: !!pOf(g.pid).email, over: g.over, lvl: g.lvlAuto }));
      const byLevel: [number, number, number] = [0, 0, 0];
      for (const r of rows) byLevel[Math.min(2, Math.max(0, r.lvl))]!++;
      await upsertDraft(tx, { kind: DUN_KIND, firmId: f.id, period: '-', data: { at: today, rows, total: rows.reduce((s, r) => s + r.over, 0), byLevel } });
      out.firms++;
      out.customers += rows.length;
      out.total += rows.reduce((s, r) => s + r.over, 0);
      for (let i = 0; i < 3; i++) out.byLevel[i]! += byLevel[i]!;
    });
  }
  await noteAutoRun(db, 'dunning', `${out.firms} фирми · ${out.customers} купувачи за опомена (1.: ${out.byLevel[0]}, 2.: ${out.byLevel[1]}, последна: ${out.byLevel[2]})`, { customers: out.customers });
  return out;
}
