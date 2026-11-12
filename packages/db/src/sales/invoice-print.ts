/**
 * Data for the outgoing-document print template (`invoicePrintHtml` in `@wise/core/sales`), shared by the web
 * print view `/print/doc/[id]` and the worker's `invoice.mail` job. Access checks are the caller's: check
 * `invoice.firmId` before rendering.
 */
import { and, asc, eq, lte, ne, notInArray } from 'drizzle-orm';
import { invoicePrintKind, type InvoicePrintInput } from '@wise/core/sales';
import type { Tx } from '../audit';
import { codes, firms, invoiceAdvances, invoiceLines, invoices, items, partners, type Firm, type Invoice, type Partner } from '../schema/index';
import { documentPayments } from '../bank/open-items';
import { loadAdvances } from './invoices';
import { partnerAccounts } from '@wise/core/bank/partner-accounts';

export interface InvoicePrintData {
  invoice: Invoice;
  firm: Firm;
  partner: Partner | null;
  /** Template input without the image resolver (web / worker supply their own). */
  input: Omit<InvoicePrintInput, 'img'>;
}

/** Load everything the template needs; `k` = `dispatch` / `waybill` prints that variant. `null` when not found. */
export async function loadInvoicePrintData(tx: Tx, id: string, k?: string | null): Promise<InvoicePrintData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [doc] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!doc) return null;
  const [[f], [p], L, A, [ref], [from]] = await Promise.all([
    tx.select().from(firms).where(eq(firms.id, doc.firmId)).limit(1),
    doc.partnerId ? tx.select().from(partners).where(eq(partners.id, doc.partnerId)).limit(1) : Promise.resolve([] as Partner[]),
    tx.select({ l: invoiceLines, code: items.code }).from(invoiceLines).leftJoin(items, eq(items.id, invoiceLines.itemId))
      .where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
    tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
    doc.refInvoiceId ? tx.select().from(invoices).where(eq(invoices.id, doc.refInvoiceId)).limit(1) : Promise.resolve([] as Invoice[]),
    doc.fromDocId ? tx.select().from(invoices).where(eq(invoices.id, doc.fromDocId)).limit(1) : Promise.resolve([] as Invoice[]),
  ]);
  if (!f) return null;
  const kind = invoicePrintKind(doc.kind, k);
  const [loc] = kind === 'dispatch' && doc.warehouseId ? await tx.select().from(codes).where(eq(codes.id, doc.warehouseId)).limit(1) : [];
  const advances = doc.kind === 'invoice' && !doc.advance ? await loadAdvances(tx, A) : [];
  const debt = doc.kind === 'invoice' && doc.partnerId ? await buyerDebt(tx, doc) : null;
  return {
    invoice: doc, firm: f, partner: p ?? null,
    input: {
      kind,
      doc: {
        kind: doc.kind, number: doc.number, date: doc.date, pdate: doc.pdate, due: doc.due, advance: doc.advance, art32: doc.art32,
        export: doc.export, currency: doc.currency, fx: doc.fx, note: doc.note, data: (doc.data ?? {}) as Record<string, unknown>,
      },
      firm: { name: f.name, address: f.address, city: f.city, phone: f.phone, email: f.email, edb: f.edb, embs: f.embs, vatRegistered: f.vatRegistered, settings: f.settings },
      partner: p ? { name: p.name, address: p.address, city: p.city, edb: p.edb, ...buyerAccount(p) } : null,
      lines: L.map(({ l, code }) => ({ name: l.name, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, unit: l.unit, code: l.code, itemCode: code, account: l.account, vatFix: l.vatFix })),
      advances,
      ref: ref ? { number: ref.number, date: ref.date } : null,
      from: from ? { kind: from.kind, number: from.number } : null,
      warehouse: loc ? { code: loc.code, name: loc.name } : null,
      debt,
    },
  };
}

/**
 * The buyer's earlier invoices (issued, up to this invoice's date, not this one) still unpaid – remaining after bank
 * payments, compensations and credit notes (`documentPayments`, the same as the open-items / dunning screens).
 */
async function buyerDebt(tx: Tx, doc: Invoice): Promise<InvoicePrintInput['debt']> {
  try {
    const I0 = await tx.select({ id: invoices.id, number: invoices.number, date: invoices.date, due: invoices.due, data: invoices.data }).from(invoices)
      .where(and(eq(invoices.firmId, doc.firmId), eq(invoices.partnerId, doc.partnerId!), eq(invoices.kind, 'invoice'), ne(invoices.id, doc.id),
        notInArray(invoices.status, ['draft', 'pending']), lte(invoices.date, doc.date)))
      .orderBy(asc(invoices.date), asc(invoices.number));
    const I = I0.filter((i) => !(i.data as { cancelled?: unknown } | null)?.cancelled); // a cancelled (сторно) invoice is no debt
    if (!I.length) return null;
    const P = await documentPayments(tx, doc.firmId, { invoiceIds: I.map((i) => i.id) });
    const list = I.map((i) => ({ number: i.number, date: i.date, due: i.due, open: Math.round((P.get(i.id)?.remaining ?? 0) * 100) / 100 })).filter((x) => x.open > 0.005);
    return list.length ? { list, total: Math.round(list.reduce((a, x) => a + x.open, 0) * 100) / 100 } : null;
  } catch {
    return null; // the debt line is a courtesy: the invoice prints without it
  }
}

/** The buyer's (default) bank account for the payment slip under the invoice. */
function buyerAccount(p: Partner): { bankAcc?: string; bankName?: string } {
  try {
    const A = partnerAccounts({ bankAccount: (p as { bankAccount?: string | null }).bankAccount ?? null, bankName: (p as { bankName?: string | null }).bankName ?? null, data: (p.data ?? null) as Record<string, unknown> | null });
    const a = A.find((x) => x.def) ?? A[0];
    return a ? { bankAcc: a.iban || a.acc, ...(a.bank ? { bankName: a.bank } : {}) } : {};
  } catch { return {}; }
}
