/**
 * Where the VAT module gets its documents from.
 *
 * `@wise/core` `ddvFor` / `ddv04` / `vatBookOut` / `vatBookIn` take a `VatDocuments` bag (invoices, Z
 * reports / cash sales, purchases, cash vouchers, supplier credits). Those document tables are built in
 * parallel by Phases 3, 4 and 7, so this module only depends on the small interface below:
 *
 *   const src: VatDocumentSource = …;
 *   const { docs, partners } = await src.load(tx, firm, from, to, ctx);
 *   const D = ddvFor(docs, period, firm.vatPeriod, ctx);
 *
 * Implementations here:
 * - {@link ledgerVatSource}: fallback that rebuilds VAT-equivalent documents from posted `journal_lines`
 *   on the VAT kontos (see its doc comment for what it can and cannot see);
 * - {@link fixtureVatSource}: in-memory documents for tests.
 *
 * TODO(merge): the coordinator plugs in the real document tables (invoices / purchases from Phase 3,
 * cash vouchers from Phase 4, Z reports from Phase 7) as a `documentsVatSource` that maps rows to the
 * core shapes (`InvoiceDoc`, `PurchaseDoc`, `SalesDoc`, `CashVoucher`, `SupplierCreditDoc`), and switches
 * `apps/web/lib/vat-source.ts` to it. Nothing else in the VAT module needs to change.
 */
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  schemeOn, schemeValue, vatAccount, type InvoiceDoc, type PartnerInfo, type PostingContext, type PurchaseDoc, type TravelMarginOptions, type VatDocuments,
} from '@wise/core';
import type { Tx } from './audit';
import { journalLines, journals, partners, type Firm } from './schema/index';

/** Source type of the VAT-close journal (posted by `closeVatPeriod`). */
export const VAT_CLOSE_SOURCE = 'vatPeriod';

export type VatSourceOrigin = 'documents' | 'ledger' | 'fixture';

export interface VatSourceData {
  /** Documents dated in the requested range (pending ones may be included — core skips `pend`). */
  docs: VatDocuments;
  /** Partner name / tax number by partner id, for the VAT books. */
  partners: Record<string, PartnerInfo>;
  /** Travel-arrangement totals for margin VAT (чл. 38), when the firm uses the travel module. */
  travel?: TravelMarginOptions;
  origin: VatSourceOrigin;
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
 * ДДВ-04 fields. What the ledger cannot show, and this source therefore misses: zero-rated / exempt /
 * export sales (no VAT line), art. 32-a sales, non-deductible purchases and travel-margin details.
 */
export const ledgerVatSource: VatDocumentSource = {
  async load(tx, firm, from, to, ctx) {
    const roles = vatAccountRoles(ctx);
    const vatK = [...roles.keys()];
    if (!vatK.length) return { docs: {}, partners: {}, origin: 'ledger' };
    const notClose = or(isNull(journals.sourceType), ne(journals.sourceType, VAT_CLOSE_SOURCE));
    const J = await tx.selectDistinct({ id: journals.id }).from(journalLines)
      .innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firm.id), sql`${journals.date} between ${from} and ${to}`, inArray(journalLines.account, vatK), notClose));
    if (!J.length) return { docs: {}, partners: {}, origin: 'ledger' };
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
    return { docs: { invoices, purchases }, partners: await partnerInfo(tx, firm.id, [...pids]), origin: 'ledger' };
  },
};

/** Partner names / tax numbers for the VAT books. */
export async function partnerInfo(tx: Tx, firmId: string, ids: readonly string[]): Promise<Record<string, PartnerInfo>> {
  if (!ids.length) return {};
  const P = await tx.select({ id: partners.id, name: partners.name, edb: partners.edb }).from(partners)
    .where(and(eq(partners.firmId, firmId), inArray(partners.id, [...ids])));
  return Object.fromEntries(P.map((p) => [p.id, { name: p.name, edb: p.edb ?? '' }]));
}
