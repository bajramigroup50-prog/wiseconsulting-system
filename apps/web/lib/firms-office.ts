import 'server-only';
/**
 * Server helpers shared by the firm / office screens ported after Phase 9 (opomeni, mailhist, home, klDash, …).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { OpFirmFull } from '@wise/core/firms/dunning';
import { documentPayments, firms, invoices, partners, purchases, type Firm, type Tx } from '@wise/db';
import { db } from './db';

/** Firm options these screens read from `firms.settings` (legacy firm fields). */
export interface FirmMiscSettings {
  payDays?: number | string; opRate?: number | string; opCost?: number | string; payManual?: boolean;
  bankAccount?: string; bankName?: string; signer?: string; signerRole?: string; manager?: string; short?: string; phone2?: string;
}
export const firmMisc = (f: Pick<Firm, 'settings'>): FirmMiscSettings => (f.settings ?? {}) as FirmMiscSettings;
const numOr = (v: unknown, d: number) => { const n = Number(String(v ?? '').replace(',', '.')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : d; };
/** Legacy `firm.payDays` (default 15), `opRate` (%), `opCost` (den.). */
export const payDaysOf = (f: Pick<Firm, 'settings'>) => numOr(firmMisc(f).payDays, 15);
export const opRateOf = (f: Pick<Firm, 'settings'>) => numOr(firmMisc(f).opRate, 0);
export const opCostOf = (f: Pick<Firm, 'settings'>) => numOr(firmMisc(f).opCost, 0);

export function opFirmOf(f: Firm): OpFirmFull {
  const s = firmMisc(f);
  return {
    name: f.name, short: s.short, bankAccount: s.bankAccount, bankName: s.bankName, signer: s.signer ?? s.manager, signerRole: s.signerRole,
    phone: f.phone ?? undefined, phone2: s.phone2, email: f.email ?? undefined, address: f.address, city: f.city, edb: f.edb, embs: f.embs,
  };
}

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
export async function invoicesWithPayments(firmId: string, o: { until?: string; all?: boolean } = {}, tx: Tx = db()): Promise<OpenDocRow[]> {
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

/** Purchases with paid / remaining (legacy `purTotal − paidFor`; a cash purchase is paid). */
export async function purchasesWithPayments(firmId: string, o: { until?: string; all?: boolean } = {}, tx: Tx = db()): Promise<OpenDocRow[]> {
  const I = await tx.select({ id: purchases.id, number: purchases.number, date: purchases.date, due: purchases.due, partnerId: purchases.partnerId })
    .from(purchases).where(and(eq(purchases.firmId, firmId), ne(purchases.status, 'draft'), ne(purchases.status, 'pending')));
  const L = o.until ? I.filter((i) => i.date <= o.until!) : I;
  const P = await documentPayments(tx, firmId, { purchaseIds: L.map((i) => i.id) });
  const out: OpenDocRow[] = [];
  for (const i of L) {
    const p = P.get(i.id);
    if (!p) continue;
    const r = { ...i, number: i.number ?? '', pdate: null, total: cents(p.total), paid: cents(p.paid) };
    if (o.all || r.total - r.paid > 0) out.push(r);
  }
  return out;
}

/** id → name for partners. */
export async function partnerNames(firmId: string, ids: readonly (string | null)[], tx: Tx = db()) {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map<string, { name: string; email: string | null; phone: string | null; address: string | null; city: string | null; edb: string | null }>();
  const R = await tx.select({ id: partners.id, name: partners.name, email: partners.email, phone: partners.phone, address: partners.address, city: partners.city, edb: partners.edb })
    .from(partners).where(and(eq(partners.firmId, firmId), inArray(partners.id, want)));
  return new Map(R.map((r) => [r.id, r]));
}

/** Merge keys into `firms.settings` with one `jsonb ||` (no read-modify-write races). */
export async function patchFirmSettings(tx: Tx, firmId: string, patch: Record<string, unknown>): Promise<void> {
  await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(firms.id, firmId));
}
