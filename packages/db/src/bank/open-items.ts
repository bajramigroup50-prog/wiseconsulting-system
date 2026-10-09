/**
 * Where bank matching, manual linking, compensations, advances and payment-order suggestions get their open
 * invoices / purchases from.
 *
 * Default: {@link documentOpenItemsSource} — the Phase 3 document tables, with legacy `paidFor` semantics
 * (3602 → refs patch 12481): a document's total is `invTotal` (invoice total less deducted advances) /
 * `purTotal`; paid outside bank statements (`paidOther`) = credit notes (`refInvoiceId`), supplier credits
 * (`refPurchaseId`), journals carrying `meta.ref = {type, id, amt}`, cash vouchers with `data.ref` to an invoice
 * and compensation rows. Bank payments linked to the document are counted from the bank lines (`bankPaid` in
 * `@wise/core`), so they are not in `paidOther`. A cash purchase is fully paid. FIX(4.4 #7): the virtual FIFO
 * advances legacy added (`bkVirt`) are not applied — open amounts are real.
 *
 * Bank lines / compensation rows linked to a ledger open item (`L|konto|partner|doc` ids, written while the
 * ledger source was the default) are re-pointed on the fly: the item is the document of the same partner with the
 * same number, and the amount counts as paid on it (in `paidOther`, since `bankPaid` does not see those ids).
 *
 * {@link ledgerOpenItemsSource} (partner balances on 120–128 / 220–228 per document reference) stays available for
 * firms whose open items only exist in the ledger (opening balances, imported books).
 */
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { advDeduct, bankPaid, ledgerOpenItems, parseLedgerItemId, r2, type DocType, type OpenDoc } from '@wise/core';
import type { Tx } from '../audit';
import { loadLedgerLines } from '../ledger-queries';
import {
  bankLines, cashVouchers, compensations, invoiceAdvances, invoices, journals, purchases, supplierCredits,
} from '../schema/index';
import { loadAdvances } from '../sales/invoices';
import { cents, den } from './context';
import { toBankRow } from './rows';

export interface OpenItems { invoices: OpenDoc[]; purchases: OpenDoc[] }

export interface OpenItemsOptions {
  /** Ignore what these journals booked (e.g. the compensation being edited). */
  excludeJournalIds?: readonly string[];
}

export interface OpenItemsSource {
  readonly name: string;
  /** Open (and recently closed) documents of the firm for the business year. Amounts in cents. */
  load(tx: Tx, firmId: string, year: number, opts?: OpenItemsOptions): Promise<OpenItems>;
}

export const BANK_SOURCE_TYPE = 'bank_statement';

/** Open items from the persisted ledger (for books without documents). */
export const ledgerOpenItemsSource: OpenItemsSource = {
  name: 'ledger',
  async load(tx, firmId, year, opts) {
    const L = await loadLedgerLines(tx, firmId, `${year}-01-01`, `${year}-12-31`);
    const ex = new Set(opts?.excludeJournalIds ?? []);
    return ledgerOpenItems(L, { exclude: (l) => l.sourceType === BANK_SOURCE_TYPE || (!!l.journalId && ex.has(l.journalId)) });
  },
};

/* ---------------- documents ---------------- */

interface DocFilter { invoiceIds?: readonly string[]; purchaseIds?: readonly string[]; until?: string; excludeJournalIds?: readonly string[] }

const normNo = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const num = (v: unknown) => Number(v) || 0;

/**
 * Documents with `total` and `paidOther` (cents) plus the bank part (`bank`, cents) — the one implementation behind
 * {@link documentOpenItemsSource} and {@link documentPayments}.
 */
async function loadDocs(tx: Tx, firmId: string, f: DocFilter): Promise<{ invoices: OpenDoc[]; purchases: OpenDoc[]; bank: Map<string, number> }> {
  const byIds = !!(f.invoiceIds || f.purchaseIds);
  const iIds = [...new Set(f.invoiceIds ?? [])], pIds = [...new Set(f.purchaseIds ?? [])];
  const [I, P] = await Promise.all([
    byIds && !iIds.length ? [] : tx.select().from(invoices).where(and(
      eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'),
      byIds ? inArray(invoices.id, iIds) : sql`${invoices.date} <= ${f.until!}`,
    )),
    byIds && !pIds.length ? [] : tx.select().from(purchases).where(and(
      eq(purchases.firmId, firmId), ne(purchases.status, 'draft'),
      byIds ? inArray(purchases.id, pIds) : sql`${purchases.date} <= ${f.until!}`,
    )),
  ]);
  const invIds = I.map((i) => i.id), purIds = P.map((p) => p.id);

  // Excluded journals: their compensations and journal refs do not count.
  const exJ = [...(f.excludeJournalIds ?? [])];
  const exKomp = new Set(exJ.length ? (await tx.select({ s: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, 'compensation'), inArray(journals.id, exJ)))).map((j) => j.s) : []);

  const [ADV, CR, SC, JR, CV, KO, BL] = await Promise.all([
    invIds.length ? tx.select().from(invoiceAdvances).where(inArray(invoiceAdvances.invoiceId, invIds)) : [],
    invIds.length ? tx.select({ ref: invoices.refInvoiceId, total: invoices.total, fx: invoices.fx }).from(invoices)
      .where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'credit'), ne(invoices.status, 'draft'), inArray(invoices.refInvoiceId, invIds))) : [],
    purIds.length ? tx.select({ ref: supplierCredits.refPurchaseId, total: supplierCredits.total }).from(supplierCredits)
      .where(and(eq(supplierCredits.firmId, firmId), ne(supplierCredits.status, 'draft'), inArray(supplierCredits.refPurchaseId, purIds))) : [],
    tx.select({ id: journals.id, meta: journals.meta }).from(journals).where(and(eq(journals.firmId, firmId), sql`${journals.meta}->'ref' is not null`)),
    tx.select({ amt: cashVouchers.amt, fx: cashVouchers.fx, data: cashVouchers.data }).from(cashVouchers)
      .where(and(eq(cashVouchers.firmId, firmId), sql`${cashVouchers.data}->'ref' is not null`)),
    tx.select({ id: compensations.id, rows: compensations.rows }).from(compensations).where(eq(compensations.firmId, firmId)),
    tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), or(isNotNull(bankLines.refId), isNotNull(bankLines.refs)))),
  ]);

  const other = new Map<string, number>(); // `${type}|${id}` → cents
  const add = (type: DocType, id: string | null | undefined, c: number) => {
    if (!id || !c) return;
    const k = type + '|' + id;
    other.set(k, (other.get(k) ?? 0) + c);
  };

  // Ledger-item refs (`L|konto|partner|doc`) → the document of that partner with that number.
  const byNo = new Map<string, string>();
  for (const i of I) byNo.set(`invoice|${i.partnerId}|${normNo(i.number)}`, i.id);
  for (const p of P) byNo.set(`purchase|${p.partnerId}|${normNo(p.number)}`, p.id);
  const resolve = (type: DocType, id: string): string | null => {
    const L = parseLedgerItemId(id);
    return L && L.ref ? byNo.get(`${type}|${L.partnerId}|${normNo(L.ref)}`) ?? null : null;
  };

  for (const c of CR) add('invoice', c.ref, cents(Math.abs(num(c.total)) * (num(c.fx) || 1)));
  for (const c of SC) add('purchase', c.ref, cents(Math.abs(num(c.total))));
  for (const j of JR) {
    if (exJ.includes(j.id)) continue;
    const r = (j.meta as { ref?: { type?: DocType; id?: string; amt?: number | string } }).ref;
    if (r && (r.type === 'invoice' || r.type === 'purchase') && r.id) add(r.type, r.id, cents(r.amt));
  }
  for (const v of CV) {
    const r = (v.data as { ref?: { type?: string; id?: string } }).ref;
    if (r?.type === 'invoice' && r.id) add('invoice', r.id, cents(num(v.amt) * (num(v.fx) || 1)));
  }
  for (const k of KO) {
    if (exKomp.has(k.id)) continue;
    for (const r of k.rows ?? []) {
      if (!r.refId) continue;
      const type: DocType = r.side === 'rec' ? 'invoice' : 'purchase';
      add(type, r.refId.startsWith('L|') ? resolve(type, r.refId) : r.refId, cents(r.amt));
    }
  }
  // Bank lines: document refs via `bankPaid`; ledger-item refs re-pointed into `paidOther`.
  const rows = BL.map(toBankRow);
  for (const b of rows) {
    if (!b.ref) continue;
    if (b.refs?.length) {
      for (const r of b.refs) if (r.id.startsWith('L|')) add(r.type, resolve(r.type, r.id), r.amt);
    } else if (b.ref.id.startsWith('L|')) add(b.ref.type, resolve(b.ref.type, b.ref.id), b.settle != null ? b.settle : Math.abs(b.amount));
  }

  // Advance deductions (legacy `invTotal` = total − advDeduct), in the invoice currency.
  const advBy = new Map<string, { advanceId: string; amount: string }[]>();
  for (const a of ADV) (advBy.get(a.invoiceId) ?? advBy.set(a.invoiceId, []).get(a.invoiceId)!).push(a);

  const outI: OpenDoc[] = [];
  for (const i of I) {
    const fx = num(i.fx) || 1;
    let tot = num(i.total);
    const A = !i.advance ? advBy.get(i.id) : undefined;
    if (A?.length) tot = r2(tot - advDeduct(await loadAdvances(tx, A)).total);
    outI.push({
      id: i.id, number: i.number, date: i.date, ...(i.partnerId ? { partner: i.partnerId } : {}),
      total: cents(tot * fx), paidOther: other.get('invoice|' + i.id) ?? 0,
      ...(i.status === 'pending' ? { pend: true } : {}),
      ...(i.currency !== 'MKD' ? { cur: i.currency, fx } : {}),
    });
  }
  const outP: OpenDoc[] = P.map((p) => ({
    id: p.id, number: p.number, date: p.date, ...(p.partnerId ? { partner: p.partnerId } : {}),
    total: cents(p.total), paidOther: other.get('purchase|' + p.id) ?? 0,
    ...(p.cash ? { cash: true } : {}), ...(p.status === 'pending' ? { pend: true } : {}),
    ...(p.imp ? { imp: true, ...(p.supplierAccount ? { supKonto: p.supplierAccount } : {}) } : {}),
    ...(p.currency !== 'MKD' ? { cur: p.currency, fx: num(p.fx) || 1 } : {}),
  }));

  const bank = new Map<string, number>();
  for (const d of outI) bank.set('invoice|' + d.id, bankPaid(rows, 'invoice', d.id));
  for (const d of outP) bank.set('purchase|' + d.id, bankPaid(rows, 'purchase', d.id));
  return { invoices: outI, purchases: outP, bank };
}

/** Paid (bank + other) of a document in cents; a cash purchase is fully paid (legacy `paidFor`). */
const paidOf = (type: DocType, d: OpenDoc, bank: Map<string, number>) =>
  type === 'purchase' && d.cash ? d.total : (d.paidOther ?? 0) + (bank.get(type + '|' + d.id) ?? 0);

/** Open items from the Phase 3 documents: every document up to the end of `year` that is from that year or still open. */
export const documentOpenItemsSource: OpenItemsSource = {
  name: 'documents',
  async load(tx, firmId, year, opts) {
    const y0 = `${year}-01-01`;
    const D = await loadDocs(tx, firmId, { until: `${year}-12-31`, excludeJournalIds: opts?.excludeJournalIds });
    const keep = (type: DocType) => (d: OpenDoc) => d.date >= y0 || d.total - paidOf(type, d, D.bank) > 0;
    return { invoices: D.invoices.filter(keep('invoice')), purchases: D.purchases.filter(keep('purchase')) };
  },
};

/** Paid / remaining of one document, in denars (2 decimals; for FX documents the MKD counter-value). */
export interface DocPayment {
  type: DocType;
  /** Amount to pay (invoice total less deducted advances / purchase total). */
  total: number;
  /** Bank + credit notes / supplier credits + compensations + cash vouchers + journal refs. */
  paid: number;
  /** `total − paid` (negative = overpaid). */
  remaining: number;
}

/**
 * Paid and remaining amount per invoice / purchase id (legacy `paidFor` / `invTotal − paidFor`), for lists and
 * reports. Ids that are not documents of the firm (drafts, proformas, credit notes) are absent from the map.
 */
export async function documentPayments(tx: Tx, firmId: string, ids: { invoiceIds?: readonly string[]; purchaseIds?: readonly string[] }): Promise<Map<string, DocPayment>> {
  const out = new Map<string, DocPayment>();
  if (!ids.invoiceIds?.length && !ids.purchaseIds?.length) return out;
  const D = await loadDocs(tx, firmId, { invoiceIds: ids.invoiceIds ?? [], purchaseIds: ids.purchaseIds ?? [] });
  const put = (type: DocType) => (d: OpenDoc) => {
    const paid = paidOf(type, d, D.bank);
    out.set(d.id, { type, total: den(d.total), paid: den(paid), remaining: den(d.total - paid) });
  };
  D.invoices.forEach(put('invoice'));
  D.purchases.forEach(put('purchase'));
  return out;
}

let current: OpenItemsSource = documentOpenItemsSource;

/** The source used by matching, manual linking, advances and payment-order suggestions. */
export const openItemsSource = (): OpenItemsSource => current;
/** Switch the source (e.g. `ledgerOpenItemsSource` for books without documents; tests). */
export const setOpenItemsSource = (s: OpenItemsSource): void => { current = s; };
