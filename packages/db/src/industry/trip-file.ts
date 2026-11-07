/**
 * „Досие на патување“ (🚛 Излез – транспорт): one trip = one place and ONE nalog. The trip (`freight_tours`) holds
 * - its documents: the transport invoice (`invoiceId`), the CMR and the travel order (`file_links`, entity
 *   `freight_tour`, role `cmr` / `travel` / `doc`) — the travel order read by AI gives the countries → per diems;
 * - its road expenses: fuel / toll / parking … receipts from ANY country (`doc_reads` kind `tripcost`, `refId` = the
 *   trip, read with the multi-country receipt reader): each in its own currency → MKD at the NBRM rate of the receipt
 *   date; a foreign receipt is a cost with its VAT (not deductible), a Macedonian one splits the input VAT for a VAT payer.
 * „📒 Книжи го патувањето“ books everything in one nalog „ПАТ <број>“: the per diems (Д 44001 / П 2411), the
 * expenses (Д трошок [+ Д влезен ДДВ] / П the account they were paid from: the driver 2411, cash 1020 or the bank
 * 1000) and the invoice moved into the same nalog (re-posted with `nalogNo`; one in a closed period stays where it is).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { blgEntries, cashExpenseAccount, fxRate, type CashVoucher } from '@wise/core';
import { receiptDraftProblem, receiptDrafts, type ReceiptDraft } from '@wise/core/ai/receipts';
import { CASH_EXPENSE_CATEGORIES } from '@wise/core';
import { audit, type Tx } from '../audit';
import { missingAccounts, postJournal, unpostSource } from '../posting';
import { docReads, freightTours, invoices, journals } from '../schema/index';
import { firmPostingContext, loadFirm, type FxSources } from '../bank/context';
import { repostInvoice } from '../sales/invoices';
import { IndustryError, type IndActor } from './context';
import { bookTourPerDiems } from './travel-reads';

export const TRIP_FILE_ENTITY = 'freight_tour';
export const TRIP_COST_SOURCE = 'freight_cost';
/** Accounts the road expenses can be paid from. */
export const TRIP_PAY_KONTA: readonly [string, string][] = [
  ['2411', 'возачот (од аконтација / свои пари – пресметка на патниот налог)'],
  ['1020', 'благајна'],
  ['1000', 'жиро сметка / фирмена картичка'],
];
const COST_KONTA = [...new Set(['44010', '44011', '44021', ...Object.values(CASH_EXPENSE_CATEGORIES).flatMap((c) => [...c[1]])])];

export class TripError extends IndustryError {}

export const tripNalogNo = (tourNumber: string) => `ПАТ ${tourNumber}`;

/** Receipt reads of the given trips (newest first). */
export const tripCostReads = (tx: Pick<Tx, 'select'>, firmId: string, tourIds: readonly string[]) =>
  tourIds.length
    ? tx.select().from(docReads).where(and(eq(docReads.firmId, firmId), eq(docReads.kind, 'tripcost'), inArray(docReads.refId, [...tourIds]))).orderBy(desc(docReads.createdAt))
    : Promise.resolve([]);

export interface TripCost extends ReceiptDraft { readId: string; i: number; mkd: number; problem: string | null }

/** The receipts of read `tripcost` rows as booking drafts (konto by category against the chart, NBRM rate). */
export function tripCostDrafts(reads: readonly { id: string; status: string; result: unknown }[], o: { fx: FxSources; missing: ReadonlySet<string>; today: string }): TripCost[] {
  const has = (k: string) => !o.missing.has(k);
  return reads.filter((r) => r.status === 'done').flatMap((r) => receiptDrafts(r.result, {
    today: o.today,
    kontoFor: (cat, abroad) => cashExpenseAccount(cat, abroad, has),
    fxFor: (cur, d) => { try { return fxRate(cur, d, o.fx) || 0; } catch { return 0; } },
  }).map((d, i) => ({ ...d, readId: r.id, i, mkd: Math.round((+d.amt || 0) * (d.cur === 'MKD' ? 1 : +d.fx || 0) * 100) / 100, problem: receiptDraftProblem(d, has) })));
}

export interface TripBookResult { nalog: string; perDiems: number; costs: number; invoice: string | null; skipped: string[] }

/**
 * Book a whole trip in one nalog. `perDiem` = the per diems computed by the caller (firm rates, NBRM rate; 0 = none),
 * `payK` = the account the road expenses were paid from. Re-booking replaces the same journals.
 */
export async function bookTrip(tx: Tx, a: IndActor, tourId: string, o: { perDiem: { mkd: number; detail: string }; payK: string; fx: FxSources; today: string }): Promise<TripBookResult> {
  const [t] = await tx.select().from(freightTours).where(and(eq(freightTours.id, tourId), eq(freightTours.firmId, a.firmId))).for('update').limit(1);
  if (!t) throw new TripError('Патувањето не постои.');
  if (!TRIP_PAY_KONTA.some((k) => k[0] === o.payK)) throw new TripError('Изберете од каде се платени трошоците.');
  const N = tripNalogNo(t.number);
  const date = t.retDate || t.unloadDate || t.date;
  const skipped: string[] = [];
  // 1. per diems
  let perDiems = 0;
  if (o.perDiem.mkd > 0) { await bookTourPerDiems(tx, a, tourId, o.perDiem.mkd, o.perDiem.detail, N); perDiems = Math.round(o.perDiem.mkd * 100) / 100; }
  else await unpostSource(tx, { firmId: a.firmId, sourceType: 'freight_perdiem', sourceId: tourId, userId: a.userId });
  // 2. road expenses
  const missing = new Set(await missingAccounts(tx, a.firmId, [...COST_KONTA, o.payK]));
  if (missing.has(o.payK)) throw new TripError(`Контото ${o.payK} не постои во контниот план.`);
  const C = tripCostDrafts(await tripCostReads(tx, a.firmId, [tourId]), { fx: o.fx, missing, today: o.today });
  const ok = C.filter((c) => !c.problem);
  for (const c of C) if (c.problem) skipped.push(`${c.merchant || 'сметка'} ${c.docNo} (${c.problem})`.trim());
  let costs = 0;
  if (ok.length) {
    const f = await loadFirm(tx, a.firmId);
    const ctx = await firmPostingContext(tx, f);
    const lines = ok.flatMap((c) => {
      const v: CashVoucher = { kind: 'out', date: c.date, docNo: c.docNo, merchant: c.merchant, vatId: c.vatId, country: c.country, cur: c.cur, amt: c.amt, fx: c.fx, rate: c.rate, vat: c.vat === '' ? null : c.vat, cat: c.cat, konto: c.konto, payK: o.payK };
      return blgEntries(v, ctx, { konto: o.payK, cur: 'MKD' }, { accountExists: (k) => !missing.has(k) })
        .map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: `${l.note ?? ''} ${c.date.slice(8, 10)}.${c.date.slice(5, 7)}`.trim(), doc: c.docNo || null, currency: l.cur ?? null, amountCur: l.amtCur ?? null }));
    });
    costs = Math.round(ok.reduce((s, c) => s + c.mkd, 0) * 100) / 100;
    await postJournal(tx, {
      firmId: a.firmId, date, kind: 'frdn', sourceType: TRIP_COST_SOURCE, sourceId: tourId, userId: a.userId, number: N,
      description: `Трошоци на патот (${ok.length} сметки) – патување ${t.number}`, lines, auditAction: 'frTripCost',
    });
  } else await unpostSource(tx, { firmId: a.firmId, sourceType: TRIP_COST_SOURCE, sourceId: tourId, userId: a.userId });
  // 3. the invoice in the same nalog
  let invoice: string | null = null;
  if (t.invoiceId && (perDiems || costs)) {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, t.invoiceId), eq(invoices.firmId, a.firmId))).limit(1);
    if (inv && inv.status === 'posted') {
      const data = (inv.data ?? {}) as Record<string, unknown>;
      if (data.nalogNo === N) invoice = inv.number;
      else {
        try {
          await tx.transaction(async (sp) => {
            await sp.update(invoices).set({ data: { ...data, nalogNo: N } }).where(eq(invoices.id, inv.id));
            await repostInvoice(sp as unknown as Tx, await loadFirm(sp as unknown as Tx, a.firmId), inv.id, a.userId);
          });
          invoice = inv.number;
        } catch (e) { skipped.push(`фактура ${inv.number} останува во својот налог (${(e as Error).message})`); }
      }
    }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frTripBook', entityType: 'freight_tour', entityId: tourId, data: { nalog: N, perDiems, costs, invoice, payK: o.payK } });
  return { nalog: N, perDiems, costs, invoice, skipped };
}

/** The journals of a trip's nalog (for the dossier: booked or not). */
export const tripJournals = (tx: Pick<Tx, 'select'>, firmId: string, numbers: readonly string[]) =>
  numbers.length ? tx.select({ number: journals.number, sourceType: journals.sourceType, sourceId: journals.sourceId }).from(journals).where(and(eq(journals.firmId, firmId), inArray(journals.number, [...numbers]))) : Promise.resolve([]);
