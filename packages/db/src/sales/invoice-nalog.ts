/**
 * „Налог за книжење“ of a sales invoice — collective journals (збирен налог, e.g. „Излезни фактури 10/2026“).
 *
 * A nalog is the set of `journals` rows that share a number in a year (`groupNalozi`, the /nalozi screen). Every
 * invoice keeps its OWN journal row (`source_type = 'invoice'`, `source_id = <invoice id>`), so a collective nalog is
 * just several invoice journals posted with the same explicit number (`postJournal({ number })`):
 * - each invoice's lines stay identifiable (their journal row + `doc` = invoice number on every line);
 * - re-posting, editing, un-posting or cancelling one invoice replaces/removes only its own row — every row is
 *   balanced on its own, so the nalog stays balanced; the other invoices are untouched;
 * - period lock, VAT lock and locked journals are checked by the posting service for that row as for any journal.
 *
 * „+ Креирај налог“ opens the nalog with an empty header row (no source, `meta.collective = 'invoice'`, optional
 * period from–to and description), like an opened manual nalog („ИЗВОДИ“ for a month) — it is what the select lists
 * before the first invoice is booked into it, and its period limits which invoice dates may join.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { MANUAL_COUNTER_BASE, nextCounter } from '@wise/core';
import type { Tx } from '../audit';
import { firmNalogSettings, isIsoDate, postJournal } from '../posting';
import { firms, journals, type Firm, type Journal } from '../schema/index';
import { DocumentError } from './context';

/** Journal kinds an invoice / credit note may be booked into (sale journal kinds, legacy NAL_DEF `izlez` / `odobr`). */
export const INVOICE_NALOG_KINDS = ['izlez', 'odobr'] as const;
const yearOf = (d: string) => d.slice(0, 4);
const dmy = (d: string) => d.split('-').reverse().join('.');

export interface InvoiceNalogOpt {
  number: string;
  description: string;
  /** First / last journal date in the nalog. */
  from: string; to: string;
  /** Period of the opened (collective) nalog, when given. */
  periodFrom: string | null; periodTo: string | null;
  /** Invoice journals already booked in it. */
  invoices: number;
  /** Opened with „+ Креирај налог“ (has a header row). */
  collective: boolean;
}

const isHead = (j: Pick<Journal, 'meta' | 'sourceId'>) => !j.sourceId && ((j.meta ?? {}) as { collective?: unknown }).collective != null;

/** Open sale nalozi of a year the invoice editor offers (not locked, not in the firm's locked period). */
export async function listInvoiceNalozi(tx: Tx, firmId: string, year: number | string): Promise<InvoiceNalogOpt[]> {
  const [f] = await tx.select({ lockDate: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const y = String(year);
  const J = await tx.select().from(journals).where(and(eq(journals.firmId, firmId), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`))
    .orderBy(asc(journals.date));
  const byNo = new Map<string, Journal[]>();
  for (const j of J) (byNo.get(j.number) ?? byNo.set(j.number, []).get(j.number)!).push(j);
  const out: InvoiceNalogOpt[] = [];
  for (const [number, L] of byNo) {
    if (!L.every((j) => (INVOICE_NALOG_KINDS as readonly string[]).includes(j.kind))) continue;
    if (L.some((j) => j.locked || (f?.lockDate && j.date <= f.lockDate))) continue;
    const head = L.find(isHead);
    out.push({
      number, description: head?.description ?? L[0]!.description ?? '', from: L[0]!.date, to: L.at(-1)!.date,
      periodFrom: head?.periodFrom ?? null, periodTo: head?.periodTo ?? null,
      invoices: L.filter((j) => j.sourceType === 'invoice').length, collective: !!head,
    });
  }
  return out;
}

/** The number „+ Креирај налог“ proposes: the next free counter of the year (same rule as the posting service). */
export async function proposeNalogNumber(tx: Tx, f: Pick<Firm, 'id' | 'settings'>, date: string): Promise<string> {
  const y = yearOf(date);
  const used = await tx.select({ n: journals.number }).from(journals)
    .where(and(eq(journals.firmId, f.id), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
  return nextCounter(used.map((r) => r.n), firmNalogSettings(f).nalogMode === 'doc' ? 0 : MANUAL_COUNTER_BASE);
}

export interface NewInvoiceNalog { number?: string | null; date: string; description?: string | null; periodFrom?: string | null; periodTo?: string | null }

/** „+ Креирај налог“: open a collective sale nalog (empty header row; audited by the posting service as `newNalog`). */
export async function createInvoiceNalog(tx: Tx, f: Pick<Firm, 'id' | 'settings'>, a: NewInvoiceNalog, userId: string | null): Promise<{ id: string; number: string }> {
  if (!isIsoDate(a.date)) throw new DocumentError('Неважечки датум на налогот.');
  const pf = a.periodFrom || null, pt = a.periodTo || null;
  if ((pf && !isIsoDate(pf)) || (pt && !isIsoDate(pt))) throw new DocumentError('Неважечки период на налогот.');
  if (pf && pt && pf > pt) throw new DocumentError('Периодот „од“ е после „до“.');
  if ((pf && yearOf(pf) !== yearOf(a.date)) || (pt && yearOf(pt) !== yearOf(a.date))) throw new DocumentError('Периодот на налогот мора да е во годината на налогот.');
  const number = String(a.number ?? '').trim() || await proposeNalogNumber(tx, f, a.date);
  if (number.length > 40) throw new DocumentError('Бројот на налогот е предолг.');
  const y = yearOf(a.date);
  const [dup] = await tx.select({ id: journals.id }).from(journals)
    .where(and(eq(journals.firmId, f.id), eq(journals.number, number), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`)).limit(1);
  if (dup) throw new DocumentError(`Налог бр. ${number} веќе постои во ${y} – изберете го од листата.`);
  const r = await postJournal(tx, {
    firmId: f.id, date: a.date, kind: 'izlez', number, description: a.description?.trim() || `Излезни фактури ${a.date.slice(5, 7)}/${y}`,
    periodFrom: pf, periodTo: pt, lines: [], allowEmpty: true, meta: { collective: 'invoice' }, userId, auditAction: 'newNalog',
  });
  return { id: r.id, number: r.number };
}

/**
 * The invoice may be booked into nalog `number`: it exists in the invoice's year (other rows than the invoice's own),
 * holds only sale journals, nothing in it is locked or in the locked period, and an opened nalog's period covers the
 * invoice date. Throws {@link DocumentError} with the reason.
 */
export async function assertInvoiceNalog(tx: Tx, f: Pick<Firm, 'id' | 'lockDate'>, number: string, inv: { id: string; date: string }): Promise<void> {
  const y = yearOf(inv.date);
  const all = await tx.select().from(journals).where(and(eq(journals.firmId, f.id), eq(journals.number, number), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
  const L = all.filter((j) => !(j.sourceType === 'invoice' && j.sourceId === inv.id));
  // already booked in it and alone there (the header was removed): re-posting keeps it in its nalog
  if (!L.length && all.length) return;
  if (!L.length) throw new DocumentError(`Налогот за книжење бр. ${number} не постои во ${y}. Изберете „Нов налог“ или креирајте го налогот.`);
  if (!L.every((j) => (INVOICE_NALOG_KINDS as readonly string[]).includes(j.kind))) throw new DocumentError(`Налогот бр. ${number} не е налог за излезни фактури – во него не може да се книжи фактура.`);
  if (L.some((j) => j.locked)) throw new DocumentError(`Налогот бр. ${number} е заклучен.`);
  if (f.lockDate && L.some((j) => j.date <= f.lockDate!)) throw new DocumentError(`Налогот бр. ${number} е во заклучениот период (до ${dmy(f.lockDate)}).`);
  const head = L.find(isHead);
  if (head && ((head.periodFrom && inv.date < head.periodFrom) || (head.periodTo && inv.date > head.periodTo))) {
    throw new DocumentError(`Датумот на фактурата (${dmy(inv.date)}) е надвор од периодот на налогот бр. ${number} (${head.periodFrom ? dmy(head.periodFrom) : '…'} – ${head.periodTo ? dmy(head.periodTo) : '…'}).`);
  }
}
