/**
 * Where the VAT module gets its documents from.
 *
 * `@wise/core` `ddvFor` / `ddv04` / `vatBookOut` / `vatBookIn` take a `VatDocuments` bag (invoices, Z
 * reports / cash sales, purchases, cash vouchers, supplier credits). This module maps the document tables to
 * those shapes behind one small interface:
 *
 *   const { docs, partners } = await defaultVatSource.load(tx, firm, from, to, ctx);
 *   const D = ddvFor(docs, period, firm.vatPeriod, ctx);
 *
 * Implementations here:
 * - {@link documentsVatSource}: the document tables — invoices / credit notes / advance invoices (Phase 3),
 *   purchases with VAT groups, import, art. 32-a, non-deductible and landed costs (Phase 3), supplier returns /
 *   credits (Phase 3), POS days and Z reports `sales_daily` (Phase 7), cash vouchers (Phase 4). Client-submitted
 *   rows come with `pend` (core skips them); proformas and dispatch notes are not VAT documents.
 * - {@link manualLedgerVatSource}: journals on VAT kontos that are NOT posted by one of those documents
 *   (`VAT_SOURCE_TYPES`): manual nalozi, bank statements, compensations… rebuilt as VAT-equivalent documents;
 * - {@link defaultVatSource}: documents + manual ledger — what the screens, the close service and the estimate use.
 *   Nothing is counted twice: a document's own journal is never read back from the ledger.
 * - {@link ledgerVatSource}: every journal on the VAT kontos (no documents) — diagnostics / data imported as journals;
 * - {@link fixtureVatSource}: in-memory documents for tests.
 */
import { and, asc, between, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  schemeOn, schemeValue, vatAccount,
  type CashVoucher, type CostSlot, type InvoiceDoc, type InvoiceItem, type PartnerInfo, type PostingContext, type PurchaseCostKey,
  type PurchaseDoc, type SalesDoc, type SupplierCreditDoc, type TravelMarginOptions, type VatDocuments,
} from '@wise/core';
import type { Tx } from './audit';
import {
  cashVouchers, firms, invoiceAdvances, invoiceLines, invoices, journalLines, journals, partners, purchaseCosts, purchases, purchaseVatGroups,
  salesDaily, supplierCreditLines, supplierCredits, type Firm,
} from './schema/index';
import { loadAdvances } from './sales/invoices';
import { voucherToCore } from './bank/cash';
import { travelMarginInputs } from './industry/travel';
import { VAT_CLOSE_SOURCE, VAT_SOURCE_TYPES } from './vat-lock';

export { VAT_CLOSE_SOURCE };

export type VatSourceOrigin = 'documents' | 'ledger' | 'fixture';

export interface VatSourceData {
  /** Documents dated in the requested range (pending ones may be included — core skips `pend`). */
  docs: VatDocuments;
  /** Partner name / tax number by partner id, for the VAT books. */
  partners: Record<string, PartnerInfo>;
  /** Travel-arrangement totals for margin VAT (чл. 38), when the firm uses the travel module. */
  travel?: TravelMarginOptions;
  origin: VatSourceOrigin;
  /** Journals rebuilt from the ledger (manual / non-document postings on VAT kontos), when a ledger source took part. */
  ledgerJournals?: number;
}

export interface VatDocumentSource {
  /** All VAT-relevant documents of `firm` dated in [from, to] inclusive. */
  load(tx: Tx, firm: Pick<Firm, 'id'>, from: string, to: string, ctx: PostingContext): Promise<VatSourceData>;
}

/* ------------------------------------------------------------------ fixture */

const inRange = (d: { date: string }, from: string, to: string) => d.date >= from && d.date <= to;

/** In-memory source for tests: filters the given documents by date. */
export function fixtureVatSource(data: { docs: VatDocuments; partners?: Record<string, PartnerInfo>; travel?: TravelMarginOptions }): VatDocumentSource {
  return {
    async load(_tx, _firm, from, to) {
      const f = <T extends { date: string }>(L: readonly T[] | undefined) => (L ?? []).filter((d) => inRange(d, from, to));
      const D = data.docs;
      return {
        docs: {
          invoices: f(D.invoices), sales: f(D.sales), purchases: f(D.purchases),
          cashVouchers: f(D.cashVouchers), supplierCredits: f(D.supplierCredits),
        },
        partners: data.partners ?? {},
        travel: data.travel,
        origin: 'fixture',
      };
    },
  };
}

/* ------------------------------------------------------------------ documents */

const num = (v: unknown) => Number(v) || 0;
const group = <T, K>(rows: readonly T[], key: (r: T) => K) => {
  const M = new Map<K, T[]>();
  for (const r of rows) M.set(key(r), [...(M.get(key(r)) ?? []), r]);
  return M;
};

/** Invoices and credit notes (proformas / dispatch notes are not VAT documents). Prices are converted to MKD with `fx`. */
async function loadInvoices(tx: Tx, firmId: string, from: string, to: string): Promise<InvoiceDoc[]> {
  const H = await tx.select().from(invoices).where(and(
    eq(invoices.firmId, firmId), inArray(invoices.kind, ['invoice', 'credit']), inArray(invoices.status, ['posted', 'pending']),
    between(invoices.date, from, to),
  )).orderBy(asc(invoices.date), asc(invoices.number));
  if (!H.length) return [];
  const ids = H.map((h) => h.id);
  const [L, A] = await Promise.all([
    tx.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.lineNo)),
    tx.select().from(invoiceAdvances).where(inArray(invoiceAdvances.invoiceId, ids)),
  ]);
  const LB = group(L, (l) => l.invoiceId), AB = group(A, (a) => a.invoiceId);
  const out: InvoiceDoc[] = [];
  for (const h of H) {
    const fx = num(h.fx) || 1;
    const items: InvoiceItem[] = (LB.get(h.id) ?? []).map((l) => ({
      name: l.name, itemId: l.itemId ?? undefined, unit: l.unit ?? undefined, qty: num(l.qty), price: num(l.price) * fx, disc: num(l.disc), rate: l.rate, konto: l.account,
    }));
    const adv = h.kind === 'invoice' && !h.advance ? AB.get(h.id) ?? [] : [];
    out.push({
      id: h.id, date: h.date, number: h.number, partner: h.partnerId ?? undefined, items,
      art32: h.art32, credit: h.kind === 'credit', advance: h.advance, export: h.export,
      ...(h.refInvoiceId ? { refInv: h.refInvoiceId } : {}),
      // Phase 10 travel agency: margin-scheme invoices (чл. 38) and their arrangement.
      ...(h.data?.tourM ? { tourM: true, ...(h.data.arrangementId ? { arrangementId: h.data.arrangementId } : {}) } : {}),
      ...(adv.length ? { advances: await loadAdvances(tx, adv, fx) } : {}),
      ...(h.status === 'pending' ? { pend: true } : {}),
    });
  }
  return out;
}

/** Purchases with their VAT groups and landed costs (import, art. 32-a, cash, non-deductible flags as stored). */
async function loadPurchases(tx: Tx, firmId: string, from: string, to: string): Promise<PurchaseDoc[]> {
  const H = await tx.select().from(purchases).where(and(
    eq(purchases.firmId, firmId), inArray(purchases.status, ['posted', 'pending']), between(purchases.date, from, to),
  )).orderBy(asc(purchases.date), asc(purchases.createdAt));
  if (!H.length) return [];
  const ids = H.map((h) => h.id);
  const [G, C] = await Promise.all([
    tx.select().from(purchaseVatGroups).where(inArray(purchaseVatGroups.purchaseId, ids)).orderBy(asc(purchaseVatGroups.lineNo)),
    tx.select().from(purchaseCosts).where(inArray(purchaseCosts.purchaseId, ids)),
  ]);
  const GB = group(G, (g) => g.purchaseId), CB = group(C, (c) => c.purchaseId);
  return H.map((h) => {
    const costs: Partial<Record<PurchaseCostKey, CostSlot>> = {};
    for (const c of CB.get(h.id) ?? []) {
      costs[c.slot] = { amt: num(c.amount), fx: c.fx ?? undefined, doc: c.doc ?? undefined, partner: c.partnerId ?? undefined, byQty: c.byQty, foreign: c.foreign, lines: c.lines };
    }
    return {
      id: h.id, date: h.date, number: h.number, partner: h.partnerId ?? undefined, supplierName: h.supplierName ?? undefined,
      groups: (GB.get(h.id) ?? []).map((g) => ({ konto: g.account, rate: g.rate, base: num(g.base), vat: num(g.vat) })),
      art32: h.art32, imp: h.imp, cash: h.cash, noDed: h.noDed, supKonto: h.supplierAccount ?? undefined, fx: num(h.fx) || 1, costs,
      ...(h.status === 'pending' ? { pend: true } : {}),
    };
  });
}

/** Supplier returns / credits (reduce input VAT). */
async function loadSupplierCredits(tx: Tx, firmId: string, from: string, to: string): Promise<SupplierCreditDoc[]> {
  const H = await tx.select().from(supplierCredits).where(and(
    eq(supplierCredits.firmId, firmId), inArray(supplierCredits.status, ['posted', 'pending']), between(supplierCredits.date, from, to),
  )).orderBy(asc(supplierCredits.date), asc(supplierCredits.number));
  if (!H.length) return [];
  const L = await tx.select().from(supplierCreditLines).where(inArray(supplierCreditLines.creditId, H.map((h) => h.id))).orderBy(asc(supplierCreditLines.lineNo));
  const LB = group(L, (l) => l.creditId);
  return H.map((h) => ({
    id: h.id, kind: h.kind, date: h.date, number: h.number, supNo: h.supNo ?? undefined, partner: h.partnerId, wh: h.warehouseId ?? undefined,
    rows: (LB.get(h.id) ?? []).map((l) => ({ item: l.itemId ?? undefined, name: l.name, qty: num(l.qty), price: num(l.price), rate: l.rate, konto: l.account })),
    ...(h.status === 'pending' ? { pend: true } : {}),
  }));
}

/** POS days and Z / periodic fiscal reports. */
async function loadSales(tx: Tx, firmId: string, from: string, to: string): Promise<SalesDoc[]> {
  const H = await tx.select().from(salesDaily).where(and(eq(salesDaily.firmId, firmId), between(salesDaily.date, from, to)))
    .orderBy(asc(salesDaily.date), asc(salesDaily.createdAt));
  return H.map((h) => ({
    id: h.id, date: h.date, number: h.number ?? (h.fisk?.z ? 'Z ' + h.fisk.z : undefined), wh: h.locationId ?? undefined, total: num(h.total),
    groups: (h.groups ?? []).map((g) => ({ rate: g.rate, konto: g.konto, base: num(g.base), vat: num(g.vat) })),
    card: num(h.card), cardKonto: h.cardAccount ?? undefined,
    ...(h.pending ? { pend: true } : {}),
  }));
}

/** Cash register vouchers (input VAT of fiscal receipts paid in cash). */
async function loadCashVouchers(tx: Tx, firmId: string, from: string, to: string): Promise<CashVoucher[]> {
  const H = await tx.select().from(cashVouchers).where(and(eq(cashVouchers.firmId, firmId), between(cashVouchers.date, from, to)))
    .orderBy(asc(cashVouchers.date), asc(cashVouchers.number));
  return H.map(voucherToCore);
}

/** The document tables (no ledger): invoices, purchases, supplier credits, Z reports, cash vouchers. */
export const documentsVatSource: VatDocumentSource = {
  async load(tx, firm, from, to) {
    const [inv, pur, scr, sales, blg] = await Promise.all([
      loadInvoices(tx, firm.id, from, to), loadPurchases(tx, firm.id, from, to), loadSupplierCredits(tx, firm.id, from, to),
      loadSales(tx, firm.id, from, to), loadCashVouchers(tx, firm.id, from, to),
    ]);
    const pids = new Set<string>();
    for (const d of [...inv, ...pur, ...scr]) if (d.partner) pids.add(d.partner);
    // Phase 10: arrangement totals `{rev, cost, own}` for the margin-scheme invoices of the travel module.
    let travel: TravelMarginOptions | undefined;
    if (inv.some((i) => i.tourM)) {
      const [f] = await tx.select().from(firms).where(eq(firms.id, firm.id)).limit(1);
      if (f) travel = await travelMarginInputs(tx, f);
    }
    return {
      docs: { invoices: inv, purchases: pur, supplierCredits: scr, sales, cashVouchers: blg },
      partners: await partnerInfo(tx, firm.id, [...pids]),
      ...(travel ? { travel } : {}),
      origin: 'documents',
    };
  },
};

/** Several sources merged (document lists concatenated, partner maps joined). The first source decides the origin. */
export function combineVatSources(...sources: VatDocumentSource[]): VatDocumentSource {
  return {
    async load(tx, firm, from, to, ctx) {
      const R: VatSourceData[] = [];
      for (const s of sources) R.push(await s.load(tx, firm, from, to, ctx));
      const cat = <K extends keyof VatDocuments>(k: K) => R.flatMap((r) => [...(r.docs[k] ?? [])]) as NonNullable<VatDocuments[K]>;
      const ledger = R.filter((r) => r.ledgerJournals != null);
      return {
        docs: { invoices: cat('invoices'), sales: cat('sales'), purchases: cat('purchases'), cashVouchers: cat('cashVouchers'), supplierCredits: cat('supplierCredits') },
        partners: Object.assign({}, ...R.map((r) => r.partners)) as Record<string, PartnerInfo>,
        travel: R.find((r) => r.travel)?.travel,
        origin: R[0]?.origin ?? 'documents',
        ...(ledger.length ? { ledgerJournals: ledger.reduce((s, r) => s + (r.ledgerJournals ?? 0), 0) } : {}),
      };
    },
  };
}

/* ------------------------------------------------------------------ ledger fallback */

type Role = { kind: 'out' | 'in' | 'imp' | 'r32in'; rate: number };

/** Map every VAT konto of the firm to its role (output / input / import VAT per rate, art. 32-a input). */
export function vatAccountRoles(ctx: PostingContext): Map<string, Role> {
  const M = new Map<string, Role>();
  for (const rate of [18, 10, 5]) {
    for (const kind of ['out', 'in', 'imp'] as const) {
      const k = vatAccount(ctx, kind, rate);
      if (k && !M.has(k)) M.set(k, { kind, rate });
    }
  }
  const r32 = schemeOn(ctx, 'r32in') ? schemeValue(ctx, 'r32in') : '';
  if (r32 && !M.has(r32)) M.set(r32, { kind: 'r32in', rate: 18 });
  return M;
}

const cents = (v: string | number) => Math.round(Number(v) * 100);
/** Base implied by a VAT amount: VAT × 100 / rate, to the cent (core recomputes exactly the same VAT from it). */
const impliedBase = (vatC: number, rate: number) => Math.round((vatC * 100) / rate) / 100;

/** Ledger source over every journal except the VAT-close journal and journals of the given source types. */
export function ledgerVatSourceExcept(sourceTypes: readonly string[]): VatDocumentSource {
  return { load: (tx, firm, from, to, ctx) => loadLedger(tx, firm, from, to, ctx, sourceTypes) };
}

/**
 * Fallback source that reads posted journals instead of documents.
 *
 * Every journal (except VAT-close journals) with lines on the firm's VAT kontos becomes one synthetic
 * document per direction:
 * - output VAT kontos (230018/230010/23005) → an invoice with one line per rate (credit note when the
 *   net is a debit), partner taken from the journal's 12x line;
 * - input VAT kontos (130018/…) → a purchase with one group per rate, partner from the 22x line;
 * - import VAT kontos → an import purchase with the VAT as a customs (`car`) cost line;
 * - the art. 32-a input konto (`r32in`, 1309) → an art. 32-a purchase (output side is implied by core).
 *
 * The base of each rate is implied from the VAT (VAT × 100 / rate); with per-line rounding on the
 * original documents this differs by a few cents at most, which disappears in the whole-denar
 * ДДВ-04 fields. What the ledger cannot show: zero-rated / exempt / export sales (no VAT line), art. 32-a
 * sales, non-deductible purchases and travel-margin details — which is why documents come from
 * {@link documentsVatSource} and only non-document journals from the ledger ({@link defaultVatSource}).
 */
export const ledgerVatSource: VatDocumentSource = ledgerVatSourceExcept([]);

/**
 * Ledger fallback restricted to journals that are not posted by a VAT document (`VAT_SOURCE_TYPES`): manual nalozi,
 * bank statements, compensations, payroll… that touch a VAT konto.
 */
export const manualLedgerVatSource: VatDocumentSource = ledgerVatSourceExcept([...VAT_SOURCE_TYPES]);

/**
 * The VAT source of the app: documents ({@link documentsVatSource}) + journals on VAT kontos that no VAT document
 * posted ({@link manualLedgerVatSource}). Used by the ДДВ-04 / VAT book screens, `closeVatPeriod` and `vatDueEstimate`.
 */
export const defaultVatSource: VatDocumentSource = combineVatSources(documentsVatSource, manualLedgerVatSource);

async function loadLedger(tx: Tx, firm: Pick<Firm, 'id'>, from: string, to: string, ctx: PostingContext, exclude: readonly string[]): Promise<VatSourceData> {
  const roles = vatAccountRoles(ctx);
  const vatK = [...roles.keys()];
  const none: VatSourceData = { docs: {}, partners: {}, origin: 'ledger', ledgerJournals: 0 };
  if (!vatK.length) return none;
  const src = or(isNull(journals.sourceType), notInArray(journals.sourceType, [VAT_CLOSE_SOURCE, ...exclude]));
  const J = await tx.selectDistinct({ id: journals.id }).from(journalLines)
    .innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firm.id), sql`${journals.date} between ${from} and ${to}`, inArray(journalLines.account, vatK), src));
  if (!J.length) return none;
  const rows = await tx.select({
    jid: journals.id, date: journals.date, number: journals.number, description: journals.description,
    account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, partnerId: journalLines.partnerId,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(inArray(journals.id, J.map((j) => j.id)))
    .orderBy(journals.date, journals.createdAt, journalLines.lineNo);

  const byJ = new Map<string, typeof rows>();
  for (const r of rows) byJ.set(r.jid, [...(byJ.get(r.jid) ?? []), r]);

  const invoices: InvoiceDoc[] = [];
  const purchases: PurchaseDoc[] = [];
  const pids = new Set<string>();
  for (const [jid, L] of byJ) {
    const h = L[0]!;
    const no = h.number + (h.description ? ' · ' + h.description : '');
    const partnerOf = (re: RegExp) => L.find((l) => l.partnerId && re.test(l.account))?.partnerId ?? L.find((l) => l.partnerId)?.partnerId ?? undefined;
    // Net per role/rate in cents: output = credit − debit, input = debit − credit.
    const net = new Map<string, { role: Role; c: number }>();
    for (const l of L) {
      const role = roles.get(l.account);
      if (!role) continue;
      const key = `${role.kind}|${role.rate}`;
      const sign = role.kind === 'out' ? cents(l.credit) - cents(l.debit) : cents(l.debit) - cents(l.credit);
      const o = net.get(key) ?? { role, c: 0 };
      o.c += sign;
      net.set(key, o);
    }
    const N = [...net.values()].filter((x) => x.c !== 0);
    const outs = N.filter((x) => x.role.kind === 'out');
    for (const credit of [false, true]) {
      const part = outs.filter((x) => (x.c < 0) === credit);
      if (!part.length) continue;
      const partner = partnerOf(/^12/);
      if (partner) pids.add(partner);
      invoices.push({
        id: `${jid}:out${credit ? ':cr' : ''}`, date: h.date, number: no, partner, credit,
        items: part.map((x) => ({ name: 'ДДВ ' + x.role.rate + '%', qty: 1, price: impliedBase(Math.abs(x.c), x.role.rate), rate: x.role.rate })),
      });
    }
    const ins = N.filter((x) => x.role.kind === 'in');
    const imps = N.filter((x) => x.role.kind === 'imp');
    const r32 = N.filter((x) => x.role.kind === 'r32in');
    const supplier = partnerOf(/^22/);
    if ((ins.length || imps.length || r32.length) && supplier) pids.add(supplier);
    if (ins.length) {
      purchases.push({
        id: `${jid}:in`, date: h.date, number: no, partner: supplier,
        groups: ins.map((x) => ({ rate: x.role.rate, base: impliedBase(x.c, x.role.rate), vat: x.c / 100 })),
      });
    }
    if (imps.length) {
      purchases.push({
        id: `${jid}:imp`, date: h.date, number: no, partner: supplier, imp: true, groups: [],
        costs: { car: { lines: imps.map((x) => ({ rate: x.role.rate, base: impliedBase(x.c, x.role.rate), vat: x.c / 100 })) } },
      });
    }
    if (r32.length) {
      purchases.push({
        id: `${jid}:r32`, date: h.date, number: no, partner: supplier, art32: true,
        groups: r32.map((x) => ({ rate: 18, base: impliedBase(x.c, 18), vat: 0 })),
      });
    }
  }
  return { docs: { invoices, purchases }, partners: await partnerInfo(tx, firm.id, [...pids]), origin: 'ledger', ledgerJournals: byJ.size };
}

/** Partner names / tax numbers for the VAT books. */
export async function partnerInfo(tx: Tx, firmId: string, ids: readonly string[]): Promise<Record<string, PartnerInfo>> {
  if (!ids.length) return {};
  const P = await tx.select({ id: partners.id, name: partners.name, edb: partners.edb }).from(partners)
    .where(and(eq(partners.firmId, firmId), inArray(partners.id, [...ids])));
  return Object.fromEntries(P.map((p) => [p.id, { name: p.name, edb: p.edb ?? '' }]));
}
