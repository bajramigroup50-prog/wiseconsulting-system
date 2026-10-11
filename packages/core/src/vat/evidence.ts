/**
 * Document-level VAT evidence of one ДДВ period (legacy `ACT.ddvCsv` 7263) and the combined
 * „Книга на излезни и влезни фактури“ (legacy `ACT.ddvBookPdf` 7318).
 *
 * Both work on the documents of the period (`VatDocuments` as loaded by the VAT source); pending
 * (client-submitted, unapproved) documents are skipped, like everywhere else in the VAT code.
 */
import { r2 } from '../money';
import { calcLines, type PartnerInfo, type VatDocuments } from '../vat';

type Cell = string | number;
const n0 = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
/** Signed amount without a negative zero. */
const sg = (s: number, v: number): number => (v ? r2(s * v) : 0);
const inRange = (d: { date: string }, a: string, b: string) => d.date >= a && d.date <= b;
const sum = <T>(L: readonly T[], f: (x: T) => number) => r2(L.reduce((s, x) => s + f(x), 0));

export interface VatEvidenceOptions {
  partners?: Readonly<Record<string, PartnerInfo>>;
  /** Firm explicitly not VAT-registered (every rate → 0, as `calcLines`). */
  nonVat?: boolean;
}

export const DDV_EVIDENCE_HEAD: readonly string[] = ['Вид', 'Датум', 'Бр.', 'Партнер', 'ЕДБ', 'Стапка', 'Основица', 'ДДВ', 'Чл. 32-а'];

/** Input VAT of a purchase group: art. 32-a → the recipient calculates base × rate (18 when missing). */
const groupVat = (art32: boolean | undefined, g: { rate: unknown; base: unknown; vat: unknown }) =>
  art32 ? r2((n0(g.base) * (n0(g.rate) || 18)) / 100) : n0(g.vat);

/**
 * Legacy `ddvCsv` rows (header included): one row per `calcLines(...).by` group of every invoice /
 * credit note (credit notes negative), then one row per group of every purchase. Dates are ISO.
 */
export function ddvEvidenceRows(docs: VatDocuments, from: string, to: string, o: VatEvidenceOptions = {}): Cell[][] {
  const P = o.partners ?? {};
  const pi = (id: string | undefined): PartnerInfo => (id && P[id]) || {};
  const rows: Cell[][] = [[...DDV_EVIDENCE_HEAD]];
  for (const i of docs.invoices ?? []) {
    if (i.pend || !inRange(i, from, to)) continue;
    const s = i.credit ? -1 : 1;
    const p = pi(i.partner);
    for (const g of calcLines(i.items, i.art32, { nonVat: o.nonVat }).by) {
      rows.push([i.credit ? 'Одобрение' : 'Излезна', i.date, i.number ?? '', p.name ?? '', p.edb ?? '', g.rate, sg(s, g.base), sg(s, g.vat), i.art32 ? 'Да' : '']);
    }
  }
  for (const d of docs.purchases ?? []) {
    if (d.pend || !inRange(d, from, to)) continue;
    const p = pi(d.partner);
    for (const g of d.groups ?? []) {
      rows.push(['Влезна', d.date, d.number ?? '', p.name ?? d.supplierName ?? '', p.edb ?? '', n0(g.rate), n0(g.base), groupVat(d.art32, g), d.art32 ? 'Да' : '']);
    }
  }
  return rows;
}

export interface InvoiceBookOutRow {
  date: string; no: string; name: string; edb: string;
  b18: number; v18: number; b10: number; v10: number; b5: number; v5: number;
  /** Чл. 32-а base, else the 0% bases. */
  oth: number;
}
export interface InvoiceBookInRow { date: string; no: string; name: string; edb: string; base: number; vat: number; art32: boolean }
export interface InvoiceBook { out: InvoiceBookOutRow[]; inn: InvoiceBookInRow[] }

const byDate = <T extends { date: string }>(L: T[]) => L.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/**
 * Rows of „Книга на излезни и влезни фактури“ (legacy `ddvBookPdf`), each book sorted by date.
 * Output: per-rate bases / VAT (none for art. 32-a), and „Чл. 32-а / 0%“ = the art. 32-a base or the 0% bases.
 * FIX: credit notes are negative in the last column too (legacy signed only the per-rate columns).
 */
export function invoiceBookRows(docs: VatDocuments, from: string, to: string, o: VatEvidenceOptions = {}): InvoiceBook {
  const P = o.partners ?? {};
  const pi = (id: string | undefined): PartnerInfo => (id && P[id]) || {};
  const out: InvoiceBookOutRow[] = [];
  for (const i of docs.invoices ?? []) {
    if (i.pend || !inRange(i, from, to)) continue;
    const c = calcLines(i.items, i.art32, { nonVat: o.nonVat });
    const s = i.credit ? -1 : 1;
    const g = (r: number) => c.by.filter((x) => !i.art32 && x.rate === r);
    const b = (r: number) => sg(s, sum(g(r), (x) => x.base));
    const v = (r: number) => sg(s, sum(g(r), (x) => x.vat));
    const oth = i.art32 ? c.base : sum(c.by.filter((x) => x.rate === 0), (x) => x.base);
    const p = pi(i.partner);
    out.push({ date: i.date, no: i.number ?? '', name: p.name ?? '', edb: p.edb ?? '', b18: b(18), v18: v(18), b10: b(10), v10: v(10), b5: b(5), v5: v(5), oth: sg(s, oth) });
  }
  const inn: InvoiceBookInRow[] = [];
  for (const d of docs.purchases ?? []) {
    if (d.pend || !inRange(d, from, to)) continue;
    const G = d.groups ?? [];
    const p = pi(d.partner);
    inn.push({ date: d.date, no: d.number ?? '', name: p.name ?? d.supplierName ?? '', edb: p.edb ?? '', base: sum(G, (g) => n0(g.base)), vat: sum(G, (g) => groupVat(d.art32, g)), art32: !!d.art32 });
  }
  return { out: byDate(out), inn: byDate(inn) };
}

/** Column totals of the output book. */
export function invoiceBookOutSum(R: readonly InvoiceBookOutRow[]): Omit<InvoiceBookOutRow, 'date' | 'no' | 'name' | 'edb'> {
  const k = ['b18', 'v18', 'b10', 'v10', 'b5', 'v5', 'oth'] as const;
  return Object.fromEntries(k.map((x) => [x, sum(R, (r) => r[x])])) as Omit<InvoiceBookOutRow, 'date' | 'no' | 'name' | 'edb'>;
}
