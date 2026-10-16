/**
 * UBL 2.1 of issued invoices / credit notes, for the single download (`/api/ubl/{id}`) and the bulk e-Фактура ZIP
 * (`/api/ubl/zip`, P34). Loads the lines, advances, buyer and corrected invoice of a batch of invoices of ONE firm.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { ublXml } from '@wise/core/sales';
import { invoiceAdvances, invoiceLines, invoices, items, loadAdvances, partners, type Firm, type Invoice, type Partner } from '@wise/db';
import { db } from '@/lib/db';

export interface UblDoc { inv: Invoice; partner: Partner | null; xml: string }

/** Seller bank account as stored on the firm (Излез › Изглед на фактура). */
export const firmBank = (f: Pick<Firm, 'settings'>): string => String(((f.settings ?? {}) as Record<string, unknown>).bank ?? '');

/** `eFaktura_<number>.xml`. */
export const ublFileName = (number: string): string => 'eFaktura_' + number.replace(/[^\p{L}\p{N}]+/gu, '_') + '.xml';

/** UBL XML of each invoice (all of `firm`, kind invoice / credit). */
export async function buildUbl(firm: Firm, list: readonly Invoice[]): Promise<UblDoc[]> {
  if (!list.length) return [];
  const ids = list.map((i) => i.id);
  const pIds = [...new Set(list.map((i) => i.partnerId).filter((x): x is string => !!x))];
  const rIds = [...new Set(list.map((i) => i.refInvoiceId).filter((x): x is string => !!x))];
  const [P, L, A, R] = await Promise.all([
    pIds.length ? db().select().from(partners).where(inArray(partners.id, pIds)) : Promise.resolve([] as Partner[]),
    db().select({ l: invoiceLines, code: items.code }).from(invoiceLines).leftJoin(items, eq(items.id, invoiceLines.itemId))
      .where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.lineNo)),
    db().select().from(invoiceAdvances).where(inArray(invoiceAdvances.invoiceId, ids)),
    rIds.length ? db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(inArray(invoices.id, rIds)) : Promise.resolve([] as { id: string; n: string }[]),
  ]);
  const seller = { name: firm.name, address: firm.address, city: firm.city, edb: firm.edb, embs: firm.embs, vatRegistered: firm.vatRegistered };
  const out: UblDoc[] = [];
  for (const inv of list) {
    const p = P.find((x) => x.id === inv.partnerId) ?? null;
    const adv = A.filter((a) => a.invoiceId === inv.id);
    const xml = ublXml({
      number: inv.number, date: inv.date, pdate: inv.pdate, due: inv.due, credit: inv.kind === 'credit', art32: inv.art32, cur: inv.currency,
      refNumber: R.find((r) => r.id === inv.refInvoiceId)?.n ?? null,
      advances: inv.kind === 'invoice' && !inv.advance ? await loadAdvances(db(), adv) : [],
      items: L.filter(({ l }) => l.invoiceId === inv.id).map(({ l, code }) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), disc: Number(l.disc), rate: l.rate, unit: l.unit ?? '', code: l.code || code })),
    }, seller,
    { name: p?.name ?? '', address: p?.address, city: p?.city, edb: p?.edb, embs: p?.embs, vatRegistered: p?.vatRegistered, country: p?.country },
    { nonVat: !firm.vatRegistered, bankAccount: firmBank(firm) });
    out.push({ inv, partner: p, xml });
  }
  return out;
}
