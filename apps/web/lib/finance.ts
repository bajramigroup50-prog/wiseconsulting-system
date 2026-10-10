import 'server-only';
/**
 * Server loaders for the finance & books screens (kartici, analitika, poobjekti, recon, pozajmici, kamati):
 * journal lines with their nalog number, description and the source document's due date, as `@wise/core/finance` `CardLine`s.
 */
import { and, asc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { CardLine } from '@wise/core/finance';
import { invoices, journalLines, journals, partners, purchases } from '@wise/db';
import { db } from './db';

export type FinLine = CardLine & { id: string; journalId: string; lineNo: number; locationId: string | null };

/** Journal lines of the firm in [from, to] (optionally only accounts starting with one of `kontos`, or one partner), in booking order. */
export async function finLines(firmId: string, from: string, to: string, o: { kontos?: readonly string[]; partnerId?: string; accountRe?: string; excludeClose?: boolean } = {}): Promise<FinLine[]> {
  const conds: SQL[] = [eq(journalLines.firmId, firmId), sql`${journals.date} between ${from} and ${to}`];
  const ks = (o.kontos ?? []).filter((k) => /^\d{1,10}$/.test(k));
  if (ks.length) conds.push(or(...ks.map((k) => like(journalLines.account, `${k}%`)))!);
  if (o.partnerId) conds.push(eq(journalLines.partnerId, o.partnerId));
  if (o.accountRe) conds.push(sql`${journalLines.account} ~ ${o.accountRe}`);
  if (o.excludeClose) conds.push(sql`${journals.kind} <> 'close'`);
  const rows = await db().select({
    id: journalLines.id, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, partnerId: journalLines.partnerId,
    note: journalLines.note, doc: journalLines.doc, lineNo: journalLines.lineNo, locationId: journalLines.locationId,
    date: journals.date, kind: journals.kind, journalId: journals.id, number: journals.number, description: journals.description,
    sourceType: journals.sourceType, sourceId: journals.sourceId,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(...conds))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journals.id), asc(journalLines.lineNo));
  const invIds = [...new Set(rows.filter((r) => r.sourceType === 'invoice' && r.sourceId).map((r) => r.sourceId!))];
  const purIds = [...new Set(rows.filter((r) => r.sourceType === 'purchase' && r.sourceId).map((r) => r.sourceId!))];
  const uuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
  const [I, P] = await Promise.all([
    invIds.filter(uuid).length ? db().select({ id: invoices.id, due: invoices.due }).from(invoices).where(inArray(invoices.id, invIds.filter(uuid))) : [],
    purIds.filter(uuid).length ? db().select({ id: purchases.id, due: purchases.due }).from(purchases).where(inArray(purchases.id, purIds.filter(uuid))) : [],
  ]);
  const due = new Map<string, string | null>([...I, ...P].map((x) => [x.id, x.due]));
  return rows.map((r) => ({
    ...r, id: String(r.id), debit: Number(r.debit), credit: Number(r.credit),
    due: (r.sourceType === 'invoice' || r.sourceType === 'purchase') && r.sourceId ? due.get(r.sourceId) ?? null : null,
  }));
}

/** Partners of the firm by id (name, code, EDB, address…). */
export async function partnerMap(firmId: string) {
  const P = await db().select().from(partners).where(eq(partners.firmId, firmId)).orderBy(asc(partners.name));
  return new Map(P.map((p) => [p.id, p]));
}

/** Text of a card row (legacy `kcSod` / label + note). */
export const lineText = (l: Pick<CardLine, 'description' | 'doc' | 'note'>) =>
  [l.description, l.doc && !(l.description ?? '').includes(l.doc) ? l.doc : '', l.note].filter(Boolean).join(' · ');

/** Case-insensitive search over several fields (legacy `srchMatch`: every word must occur). */
export function srchMatch(text: string, q: string): boolean {
  const t = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });
