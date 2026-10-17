/**
 * Delete a whole „Налог за книжење“ (or one document of it) together with the documents booked in it.
 *
 * Every journal created from a document is removed through that document's own delete (purchase cascade, invoice
 * delete / retention storno, supplier credit, stock and cash documents, bank statement, payroll un-post); manual
 * journals are deleted as journals. Only the journals of THIS nalog are touched (a number is shared by several
 * journals of the period — the documents of other nalozi stay). Refused as a whole when:
 *   - a part is in a locked period (firm lock date / locked journal);
 *   - an outgoing invoice was exported / sent as e-invoice („извезено за е-фактура“) — it must be cancelled with an
 *     Одобрение (сторно), never silently deleted;
 *   - a document kind has no delete of its own (named in the message);
 *   - any document's own delete refuses (its message, prefixed with the document).
 * Everything runs in the caller's transaction; one summary audit row lists what was removed.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parseDocNumber } from '@wise/core/compliance';
import { todaySkopje } from '@wise/core/office/dates';
import { audit, type Tx } from './audit';
import { deleteVoucher, CASH_SOURCE_TYPE } from './bank/cash';
import { deleteCompensation, KOMP_SOURCE_TYPE } from './bank/komp';
import { deleteStatement } from './bank/lines';
import { deleteStoreOut } from './parity-retail';
import { unpostRun } from './payroll';
import { deleteJournal, PostingError } from './posting';
import { deleteManualMove, deleteWriteoff } from './retail';
import { type DocActor } from './sales/context';
import { deleteInvoice } from './sales/invoices';
import { deletePurchase } from './sales/purchases';
import { deleteSupplierCredit } from './sales/supplier-credits';
import { firms, invoices, journalLines, journals, partners, purchases, supplierCredits, type InvoiceData, type Journal } from './schema/index';
import { deleteLevelling, deleteProductionOrder, deleteSalesDay, deleteStockCount, deleteTransfer } from './stock-docs';

/** Journals that are not documents: deleted as journals (same list as the nalog editor's `manualLike`). */
const MANUAL = ['opening', 'bbimp', 'yearClose', 'import'];
export const isManualJournal = (sourceType: string | null) => !sourceType || MANUAL.includes(sourceType);

type Del = (tx: Tx, firmId: string, id: string, actor: DocActor) => Promise<string | void>;
const stock = (f: (tx: Tx, a: { firmId: string; userId: string | null }, id: string) => Promise<unknown>): Del =>
  async (tx, firmId, id, actor) => { await f(tx, { firmId, userId: actor.userId }, id); };

/**
 * Document kinds a nalog may hold: label, the permission their own screen needs to delete them, the delete, and the
 * order (credit notes before the invoices they correct, transfers before the calculation they came from…).
 */
export const NALOG_DOC_KINDS: Record<string, { label: string; perm: string; rank: number; del: Del }> = {
  supplier_credit: { label: 'Одобрение/повратница од добавувач', perm: 'del', rank: 0, del: async (tx, f, id, a) => deleteSupplierCredit(tx, f, id, a) },
  invoice: { label: 'Излезна ф-ра', perm: 'del', rank: 1, del: async (tx, f, id, a) => ((await deleteInvoice(tx, f, id, a, 'Бришење на налогот за книжење')).cancelled ? 'cancelled' : undefined) },
  transfer: { label: 'Преносница', perm: 'prDel', rank: 2, del: stock(deleteTransfer) },
  purchase: { label: 'Влезна ф-ра', perm: 'del', rank: 3, del: async (tx, f, id, a) => { const r = await deletePurchase(tx, f, id, a, { cascade: true }); return r.transfers.length ? 'transfers:' + r.transfers.join(', ') : undefined; } },
  levelling: { label: 'Нивелација', perm: 'nivDel', rank: 4, del: stock((tx, a, id) => deleteLevelling(tx, a, id, todaySkopje())) },
  stock_count: { label: 'Попис', perm: 'moDel', rank: 4, del: stock(deleteStockCount) },
  store_out: { label: 'Излез од продавница', perm: 'moDel', rank: 4, del: stock(deleteStoreOut) },
  sales_daily: { label: 'Дневен промет', perm: 'fkDel', rank: 4, del: stock(deleteSalesDay) },
  production: { label: 'Производство', perm: 'delProd', rank: 4, del: stock(deleteProductionOrder) },
  manual_move: { label: 'Рачна промена на залиха', perm: 'del', rank: 4, del: stock(deleteManualMove) },
  writeoff_doc: { label: 'Расход', perm: 'del', rank: 4, del: stock(deleteWriteoff) },
  [CASH_SOURCE_TYPE]: { label: 'Благајна', perm: 'del', rank: 5, del: async (tx, firmId, id, a) => deleteVoucher(tx, { firmId, userId: a.userId, id }) },
  [KOMP_SOURCE_TYPE]: { label: 'Компензација', perm: 'kompDel', rank: 5, del: async (tx, firmId, id, a) => deleteCompensation(tx, { firmId, userId: a.userId, id }) },
  bank_statement: { label: 'Извод', perm: 'nalDel', rank: 6, del: async (tx, firmId, id, a) => deleteStatement(tx, { firmId, userId: a.userId, statementId: id }) },
  payroll: { label: 'Плата (налогот; пресметката останува)', perm: 'nalDel', rank: 7, del: async (tx, firmId, id, a) => unpostRun(tx, { firmId, runId: id, userId: a.userId }) },
};

export interface NalogPart {
  journalId: string;
  sourceType: string | null;
  sourceId: string | null;
  /** „Влезна ф-ра“, „Излезна ф-ра“, „Рачен налог“ … */
  type: string;
  number: string;
  date: string;
  partner: string;
  total: number;
  /** After the delete: `deleted`, `cancelled` (invoice kept as сторно), `skipped` (removed with an earlier document). */
  outcome?: 'deleted' | 'cancelled' | 'skipped';
  /** Transfers deleted together with a purchase. */
  transfers?: string;
}

export interface NalogDeleteResult {
  number: string;
  parts: NalogPart[];
  /** Permissions the documents need (`del`, `prDel`, …) — checked by the caller before / with the delete. */
  perms: string[];
}

const INV_LBL: Record<string, string> = { invoice: 'Излезна ф-ра', credit: 'Одобрение (купувач)', proforma: 'Профактура', dispatch: 'Испратница' };
const fmt2 = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => d.split('-').reverse().join('.');
/** One line per document for messages / previews: „Влезна ф-ра 114/2026 · 05.08.2026 · Телеком · 5.408,00“. */
export const nalogPartLine = (p: NalogPart) => `${p.type} ${p.number || 'б.б.'} · ${dmy(p.date)}${p.partner ? ' · ' + p.partner : ''} · ${fmt2(p.total)}`;

/** The journals of nalog `no` in `year` (locked for update). */
export async function nalogJournals(tx: Tx, firmId: string, no: string, year: number): Promise<Journal[]> {
  return tx.select().from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.number, no), sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)).for('update');
}

/** Describe the parts of a nalog: type, number, date, partner and total of each document (manual journals as such). */
export async function describeNalogParts(tx: Tx, firmId: string, J: readonly Journal[]): Promise<NalogPart[]> {
  if (!J.length) return [];
  const ids = (t: string) => J.filter((j) => j.sourceType === t && j.sourceId).map((j) => j.sourceId!);
  const sums = new Map((await tx.select({ id: journalLines.journalId, d: sql<string>`coalesce(sum(${journalLines.debit}), 0)` })
    .from(journalLines).where(inArray(journalLines.journalId, J.map((j) => j.id))).groupBy(journalLines.journalId)).map((r) => [r.id, Number(r.d)]));
  const [I, P, C] = await Promise.all([
    ids('invoice').length ? tx.select({ id: invoices.id, kind: invoices.kind, number: invoices.number, date: invoices.date, total: invoices.total, data: invoices.data, p: partners.name })
      .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId)).where(and(eq(invoices.firmId, firmId), inArray(invoices.id, ids('invoice')))) : [],
    ids('purchase').length ? tx.select({ id: purchases.id, number: purchases.number, calcNo: purchases.calcNo, date: purchases.date, total: purchases.total, sn: purchases.supplierName, p: partners.name })
      .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(and(eq(purchases.firmId, firmId), inArray(purchases.id, ids('purchase')))) : [],
    ids('supplier_credit').length ? tx.select({ id: supplierCredits.id, number: supplierCredits.number, date: supplierCredits.date, total: supplierCredits.total, p: partners.name })
      .from(supplierCredits).leftJoin(partners, eq(partners.id, supplierCredits.partnerId)).where(and(eq(supplierCredits.firmId, firmId), inArray(supplierCredits.id, ids('supplier_credit')))) : [],
  ]);
  return J.map((j) => {
    const base: NalogPart = {
      journalId: j.id, sourceType: j.sourceType, sourceId: j.sourceId, number: j.description ?? '', date: j.date, partner: '', total: sums.get(j.id) ?? 0,
      type: isManualJournal(j.sourceType) ? 'Рачен налог' : NALOG_DOC_KINDS[j.sourceType!]?.label ?? j.sourceType!,
    };
    const i = j.sourceType === 'invoice' ? I.find((x) => x.id === j.sourceId) : undefined;
    if (i) return { ...base, type: INV_LBL[i.kind] ?? base.type, number: i.number, date: i.date, partner: i.p ?? '', total: Number(i.total) };
    const p = j.sourceType === 'purchase' ? P.find((x) => x.id === j.sourceId) : undefined;
    if (p) return { ...base, number: p.number || p.calcNo || '', date: p.date, partner: p.p ?? p.sn ?? '', total: Number(p.total) };
    const c = j.sourceType === 'supplier_credit' ? C.find((x) => x.id === j.sourceId) : undefined;
    if (c) return { ...base, number: c.number, date: c.date, partner: c.p ?? '', total: Number(c.total) };
    return base;
  });
}

/** Order of deletion: credit notes before invoices, invoices from the highest number down (so none is left mid-series). */
function ordered(J: readonly Journal[], inv: Map<string, { kind: string; number: string }>): Journal[] {
  const rank = (j: Journal) => {
    if (isManualJournal(j.sourceType)) return 9;
    if (j.sourceType === 'invoice') return inv.get(j.sourceId ?? '')?.kind === 'credit' ? 0.5 : 1;
    return NALOG_DOC_KINDS[j.sourceType!]?.rank ?? 8;
  };
  const no = (j: Journal) => parseDocNumber(inv.get(j.sourceId ?? '')?.number ?? '')?.n ?? 0;
  return [...J].sort((a, b) => rank(a) - rank(b) || no(b) - no(a));
}

/**
 * Delete the given journals of one nalog with their documents (see the file comment). `journalIds` limits the delete
 * to those parts (one document of the nalog); otherwise the whole nalog `no` of `year` goes.
 */
export async function deleteNalogParts(tx: Tx, a: { firmId: string; actor: DocActor; no: string; year: number; journalIds?: readonly string[] }): Promise<NalogDeleteResult> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!firm) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  let J = await nalogJournals(tx, a.firmId, a.no, a.year);
  if (a.journalIds) J = J.filter((j) => a.journalIds!.includes(j.id));
  if (!J.length) throw new PostingError('not_found', 'Налогот не постои.');
  const lock = firm.lockDate;
  const parts = await describeNalogParts(tx, a.firmId, J);
  const partOf = (j: Journal) => parts.find((p) => p.journalId === j.id)!;
  const lockedP = J.filter((j) => j.locked || (lock && j.date <= lock));
  if (lockedP.length) {
    throw new PostingError('locked', `Налогот е во заклучен период${lock ? ` (до ${dmy(lock)})` : ''} – не може да се брише: ${lockedP.slice(0, 5).map((j) => nalogPartLine(partOf(j))).join('; ')}.`);
  }
  const unknown = J.filter((j) => !isManualJournal(j.sourceType) && !NALOG_DOC_KINDS[j.sourceType!]);
  if (unknown.length) {
    throw new PostingError('not_found', `Налогот содржи документи што не се бришат од тука (${unknown.length}): ${unknown.slice(0, 10).map((j) => nalogPartLine(partOf(j))).join('; ')} – избришете ги на самиот документ.`);
  }
  // outgoing invoices already exported / sent as e-invoice: never deleted silently — cancelled with a credit note
  const invIds = J.filter((j) => j.sourceType === 'invoice' && j.sourceId).map((j) => j.sourceId!);
  const IV = invIds.length ? await tx.select({ id: invoices.id, kind: invoices.kind, number: invoices.number, data: invoices.data }).from(invoices).where(inArray(invoices.id, invIds)) : [];
  const sent = IV.filter((i) => !!((i.data ?? {}) as InvoiceData).efExport);
  if (sent.length) {
    const L = sent.map((i) => nalogPartLine(partOf(J.find((j) => j.sourceId === i.id)!)));
    throw new PostingError('locked', `${sent.length === 1 ? 'Фактурата е извезена/испратена' : `${sent.length} фактури се извезени/испратени`} како е-фактура (до УЈП) и не се бришат: ${L.join('; ')}. Сторнирајте ги со Одобрение (сторно) на самата фактура.`);
  }
  const perms = [...new Set(J.map((j) => (isManualJournal(j.sourceType) ? 'nalDel' : NALOG_DOC_KINDS[j.sourceType!]!.perm)))];
  if (J.some((j) => !isManualJournal(j.sourceType) && j.sourceType !== 'payroll' && j.sourceType !== 'bank_statement')) perms.push('del');

  const inv = new Map(IV.map((i) => [i.id, i]));
  for (const j of ordered(J, inv)) {
    const p = partOf(j);
    // a document deleted with an earlier one (a transfer with its calculation) is gone already
    const [still] = await tx.select({ id: journals.id }).from(journals).where(eq(journals.id, j.id)).limit(1);
    if (!still) { p.outcome = 'skipped'; continue; }
    try {
      if (isManualJournal(j.sourceType) || !j.sourceId) await deleteJournal(tx, { firmId: a.firmId, journalId: j.id, userId: a.actor.userId });
      else {
        const r = await NALOG_DOC_KINDS[j.sourceType!]!.del(tx, a.firmId, j.sourceId, a.actor);
        if (r === 'cancelled') p.outcome = 'cancelled';
        else if (r?.startsWith('transfers:')) p.transfers = r.slice(10);
      }
      p.outcome ??= 'deleted';
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      throw new PostingError(e instanceof PostingError ? e.code : 'not_found', `${nalogPartLine(p)}: ${m}`);
    }
  }
  await audit(tx, {
    userId: a.actor.userId, firmId: a.firmId, action: a.journalIds ? 'nalDocDel' : 'nalDel', entityType: 'journal', entityId: J[0]!.id,
    data: { number: a.no, year: a.year, removed: parts.map((p) => ({ type: p.type, number: p.number, date: p.date, partner: p.partner, total: p.total, sourceType: p.sourceType, sourceId: p.sourceId, outcome: p.outcome, ...(p.transfers ? { transfers: p.transfers } : {}) })) },
  });
  return { number: a.no, parts, perms: [...new Set(perms)] };
}

class DryRun extends Error {}

/**
 * The confirmation preview: the same delete run inside a savepoint that is rolled back — so the list, the storno /
 * transfer consequences and every refusal are exactly what the real delete would do.
 */
export async function previewNalogDelete(tx: Tx, a: Parameters<typeof deleteNalogParts>[1]): Promise<NalogDeleteResult> {
  let res: NalogDeleteResult | undefined;
  try {
    await tx.transaction(async (sp) => { res = await deleteNalogParts(sp as unknown as Tx, a); throw new DryRun(); });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return res!;
}
