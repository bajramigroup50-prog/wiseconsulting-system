/**
 * Data for the outgoing-document print template (`invoicePrintHtml` in `@wise/core/sales`), shared by the web
 * print view `/print/doc/[id]` and the worker's `invoice.mail` job. Access checks are the caller's: check
 * `invoice.firmId` before rendering.
 */
import { asc, eq } from 'drizzle-orm';
import { invoicePrintKind, type InvoicePrintInput } from '@wise/core/sales';
import type { Tx } from '../audit';
import { codes, firms, invoiceAdvances, invoiceLines, invoices, items, partners, type Firm, type Invoice, type Partner } from '../schema/index';
import { loadAdvances } from './invoices';

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
  return {
    invoice: doc, firm: f, partner: p ?? null,
    input: {
      kind,
      doc: {
        kind: doc.kind, number: doc.number, date: doc.date, pdate: doc.pdate, due: doc.due, advance: doc.advance, art32: doc.art32,
        export: doc.export, currency: doc.currency, fx: doc.fx, note: doc.note, data: (doc.data ?? {}) as Record<string, unknown>,
      },
      firm: { name: f.name, address: f.address, city: f.city, phone: f.phone, email: f.email, edb: f.edb, embs: f.embs, vatRegistered: f.vatRegistered, settings: f.settings },
      partner: p ? { name: p.name, address: p.address, city: p.city, edb: p.edb } : null,
      lines: L.map(({ l, code }) => ({ name: l.name, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, unit: l.unit, code: l.code, itemCode: code, account: l.account })),
      advances,
      ref: ref ? { number: ref.number, date: ref.date } : null,
      from: from ? { kind: from.kind, number: from.number } : null,
      warehouse: loc ? { code: loc.code, name: loc.name } : null,
    },
  };
}
