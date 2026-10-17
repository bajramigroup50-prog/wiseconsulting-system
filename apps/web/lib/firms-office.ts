import 'server-only';
/**
 * Server helpers shared by the firm / office screens ported after Phase 9 (opomeni, mailhist, home, klDash, …).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { OpFirmFull } from '@wise/core/firms/dunning';
import { documentPayments, firms, opCostOf, openInvoices, opRateOf, partnerNamesOf, payDaysOf, purchases, type Firm, type OpenDocRow, type Tx } from '@wise/db';
import { db } from './db';

/** Firm options these screens read from `firms.settings` (legacy firm fields). */
export interface FirmMiscSettings {
  payDays?: number | string; opRate?: number | string; opCost?: number | string; payManual?: boolean;
  bankAccount?: string; bankName?: string; signer?: string; signerRole?: string; manager?: string; short?: string; phone2?: string;
}
export const firmMisc = (f: Pick<Firm, 'settings'>): FirmMiscSettings => (f.settings ?? {}) as FirmMiscSettings;
/** Legacy `firm.payDays` (default 15), `opRate` (%), `opCost` (den.) — shared with the worker (`@wise/db` automation/dunning.ts). */
export { opCostOf, opRateOf, payDaysOf };

export function opFirmOf(f: Firm): OpFirmFull {
  const s = firmMisc(f);
  return {
    name: f.name, short: s.short, bankAccount: s.bankAccount, bankName: s.bankName, signer: s.signer ?? s.manager, signerRole: s.signerRole,
    phone: f.phone ?? undefined, phone2: s.phone2, email: f.email ?? undefined, address: f.address, city: f.city, edb: f.edb, embs: f.embs,
  };
}

export type { OpenDocRow };

const cents = (v: number) => Math.round(v * 100);

/**
 * Issued invoices (not drafts, not client-pending) with paid / remaining (legacy `invTotal − paidFor`), optionally up to
 * a date. Only rows with something still open are returned unless `all`. (`@wise/db` `openInvoices`.)
 */
export const invoicesWithPayments = (firmId: string, o: { until?: string; all?: boolean } = {}, tx: Tx = db()): Promise<OpenDocRow[]> => openInvoices(tx, firmId, o);

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
export const partnerNames = (firmId: string, ids: readonly (string | null)[], tx: Tx = db()) => partnerNamesOf(tx, firmId, ids);

/** Merge keys into `firms.settings` with one `jsonb ||` (no read-modify-write races). */
export async function patchFirmSettings(tx: Tx, firmId: string, patch: Record<string, unknown>): Promise<void> {
  await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(firms.id, firmId));
}
