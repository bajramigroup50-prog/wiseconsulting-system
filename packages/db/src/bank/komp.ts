/**
 * Compensations (компензации) — legacy `kompList`, `kompOpen`, `kompSave`, `kompDel` (8917–8972): bilateral or
 * multilateral set-off of receivables against payables, posted via `kompEntries` (journal kind `komp`, nalog 16).
 *
 * Open items come from the open-items source (ledger until Phase 3); bank payments are subtracted (`openAmount`).
 * The compensation's own journal is excluded while it is edited. FIX: legacy did not check that an amount does not
 * exceed the document's open amount — here it is refused.
 */
import { and, eq, sql } from 'drizzle-orm';
import { kompEntries, kompNextNumber, kompTot, openAmount, type CompensationDoc, type DocType } from '@wise/core';
import { audit, type Tx } from '../audit';
import { assertOpenPeriod, postJournal, unpostSource } from '../posting';
import { bankLines, compensations, journals, partners, type CompensationRowData } from '../schema/index';
import { BankError, cents, den, firmPostingContext, loadFirm } from './context';
import { openItemsSource } from './open-items';
import { toBankRow } from './rows';

export const KOMP_SOURCE_TYPE = 'compensation';

export interface KompOpenRow { side: 'rec' | 'pay'; refId: string; docNo: string; date: string; partnerId: string; konto: string; /** cents */ open: number }

async function journalIdOf(tx: Tx, firmId: string, id: string | null | undefined): Promise<string[]> {
  if (!id) return [];
  const J = await tx.select({ id: journals.id }).from(journals).where(and(eq(journals.firmId, firmId), eq(journals.sourceType, KOMP_SOURCE_TYPE), eq(journals.sourceId, id)));
  return J.map((j) => j.id);
}

/** Legacy `kompOpen`: open receivables (`rec`) and payables (`pay`) of the partners, oldest first. */
export async function kompOpenItems(tx: Tx, firmId: string, year: number, partnerIds: string[], excludeId?: string | null): Promise<KompOpenRow[]> {
  const items = await openItemsSource().load(tx, firmId, year, { excludeJournalIds: await journalIdOf(tx, firmId, excludeId) });
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), sql`${bankLines.refId} is not null`));
  const rows = L.map(toBankRow);
  const P = new Set(partnerIds);
  const out: KompOpenRow[] = [];
  const add = (side: 'rec' | 'pay', type: DocType, D: typeof items.invoices) => {
    for (const d of D) {
      if (!d.partner || !P.has(d.partner)) continue;
      const o = openAmount(rows, type, d);
      if (o > 0) out.push({ side, refId: d.id, docNo: d.number ?? '', date: d.date, partnerId: d.partner, konto: d.konto ?? (side === 'rec' ? '1200' : '2200'), open: o });
    }
  };
  add('rec', 'invoice', items.invoices);
  add('pay', 'purchase', items.purchases);
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface KompInput { id?: string | null; kind: 'bi' | 'multi'; date: string; number?: string | null; note?: string | null; year: number; amounts: Record<string, number>; partnerIds: string[] }

/** Save + post (legacy `kompSave`): receivables must equal payables, each amount ≤ the document's open amount. */
export async function saveCompensation(tx: Tx, a: { firmId: string; userId: string | null; input: KompInput }): Promise<{ id: string; number: string; nalog: string }> {
  const v = a.input;
  const f = await loadFirm(tx, a.firmId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new BankError('Неважечки датум.');
  assertOpenPeriod(f, v.date);
  const P = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, a.firmId)));
  if (v.partnerIds.some((p) => !P.some((x) => x.id === p))) throw new BankError('Комитентот не постои.');
  const open = await kompOpenItems(tx, a.firmId, v.year, v.partnerIds, v.id);
  const rows: CompensationRowData[] = [];
  for (const o of open) {
    const amt = cents(v.amounts[o.refId] ?? 0);
    if (!amt) continue;
    if (amt < 0) throw new BankError('Износите мора да се позитивни.');
    if (amt > o.open) throw new BankError(`Износот за документ ${o.docNo || 'без број'} (${den(amt).toFixed(2)}) е поголем од отвореното (${den(o.open).toFixed(2)}).`);
    rows.push({ side: o.side, refId: o.refId, docNo: o.docNo, date: o.date, partnerId: o.partnerId, konto: o.konto, amt: den(amt) });
  }
  if (!rows.length) throw new BankError('Внесете износи за компензирање.');
  const doc: CompensationDoc = { kind: v.kind, date: v.date, rows: rows.map((r) => ({ side: r.side, amt: r.amt, partner: r.partnerId, konto: r.konto, docNo: r.docNo })) };
  const t = kompTot(doc);
  if (!t.rec || !t.pay) throw new BankError('Компензацијата мора да има и побарување и обврска.');
  if (cents(t.rec) !== cents(t.pay)) throw new BankError(`Побарувањата (${t.rec.toFixed(2)}) и обврските (${t.pay.toFixed(2)}) мора да бидат еднакви.`);
  let id = v.id ?? null;
  let number = v.number?.trim() || '';
  if (id) {
    const [b] = await tx.select().from(compensations).where(and(eq(compensations.id, id), eq(compensations.firmId, a.firmId))).limit(1);
    if (!b) throw new BankError('Компензацијата не постои.');
    assertOpenPeriod(f, b.date);
    number ||= b.number;
    await tx.update(compensations).set({ kind: v.kind, date: v.date, number, note: v.note?.trim() || null, rows, total: t.rec.toFixed(2) }).where(eq(compensations.id, id));
  } else {
    if (!number) {
      const y = v.date.slice(0, 4);
      const N = await tx.select({ n: compensations.number }).from(compensations).where(and(eq(compensations.firmId, a.firmId), sql`${compensations.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
      number = kompNextNumber(v.date, N.map((x) => x.n));
    }
    const [r] = await tx.insert(compensations).values({ firmId: a.firmId, kind: v.kind, date: v.date, number, note: v.note?.trim() || null, rows, total: t.rec.toFixed(2), createdBy: a.userId }).returning({ id: compensations.id });
    id = r!.id;
  }
  const ctx = await firmPostingContext(tx, f);
  const L = kompEntries({ ...doc, number }, ctx);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: v.date, kind: 'komp', sourceType: KOMP_SOURCE_TYPE, sourceId: id, userId: a.userId,
    description: 'Компензација ' + number, lines: L.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, doc: l.doc, note: l.note })),
    auditAction: 'postCompensation',
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kompSave', entityType: KOMP_SOURCE_TYPE, entityId: id, data: { number, total: t.rec, rows: rows.length } });
  return { id, number, nalog: j.number };
}

export async function deleteCompensation(tx: Tx, a: { firmId: string; userId: string | null; id: string }): Promise<void> {
  const f = await loadFirm(tx, a.firmId);
  const [b] = await tx.select().from(compensations).where(and(eq(compensations.id, a.id), eq(compensations.firmId, a.firmId))).limit(1);
  if (!b) throw new BankError('Компензацијата не постои.');
  assertOpenPeriod(f, b.date);
  await unpostSource(tx, { firmId: a.firmId, sourceType: KOMP_SOURCE_TYPE, sourceId: b.id, userId: a.userId });
  await tx.delete(compensations).where(eq(compensations.id, b.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'kompDel', entityType: KOMP_SOURCE_TYPE, entityId: b.id, data: { number: b.number, total: b.total } });
}
