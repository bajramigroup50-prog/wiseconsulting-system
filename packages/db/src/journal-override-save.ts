/**
 * Save / remove a manual correction of a document journal (legacy `nalSave` → `nalSaveRows` 3580).
 * The override is stored per source document and the journal is re-written through the posting service, which
 * applies it (`applyJournalOverride`); one `audit_log` row `nalOverride` / `nalOverrideReset`.
 */
import { and, asc, eq } from 'drizzle-orm';
import { diffOverride, overrideEmpty, overrideRows, type JournalOverride, type OvRow } from '@wise/core/finpar';
import { lineTotals } from '@wise/core';
import { audit, type Tx } from './audit';
import { journalOverridesReady } from './journal-override';
import { PostingError, updateJournal, type PostLineInput } from './posting';
import { journalLines, journalOverrides, journals, type JournalOverrideBase } from './schema/index';

const OVERRIDABLE = (kind: string, sourceType: string | null) => !!sourceType && !['manual', 'open', 'bbimp', 'close'].includes(kind);

/** Generated lines (`base`) and the override of a document journal, for the correction editor. */
export async function journalOverrideState(tx: Tx, firmId: string, journalId: string) {
  const [j] = await tx.select().from(journals).where(and(eq(journals.id, journalId), eq(journals.firmId, firmId))).limit(1);
  if (!j) throw new PostingError('not_found', 'Налогот не постои.');
  if (!OVERRIDABLE(j.kind, j.sourceType)) return { journal: j, base: null, override: null, rows: null };
  const [ov] = !(await journalOverridesReady(tx)) ? [] : await tx.select().from(journalOverrides).where(and(
    eq(journalOverrides.firmId, firmId), eq(journalOverrides.sourceType, j.sourceType!), eq(journalOverrides.sourceId, j.sourceId!),
  )).limit(1);
  let base: JournalOverrideBase[];
  if (ov && ov.base.length) base = ov.base;
  else {
    const L = await tx.select().from(journalLines).where(eq(journalLines.journalId, j.id)).orderBy(asc(journalLines.lineNo));
    base = L.map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit), partnerId: l.partnerId, note: l.note, doc: l.doc, currency: l.currency, amountCur: l.amountCur == null ? null : Number(l.amountCur), locationId: l.locationId }));
  }
  const data = (ov?.data ?? { edits: [], adds: [] }) as JournalOverride;
  return { journal: j, base, override: ov ? data : null, rows: overrideRows(base, data) };
}

const baseLines = (base: JournalOverrideBase[]): PostLineInput[] => base.map((b) => ({ ...b }));

/** Store the correction (rows of the editor) and re-write the journal. Throws when unbalanced. */
export async function saveJournalOverride(tx: Tx, a: { firmId: string; journalId: string; rows: OvRow[]; userId: string | null }) {
  const st = await journalOverrideState(tx, a.firmId, a.journalId);
  if (!st.base) throw new PostingError('not_found', 'Овој налог не е креиран од документ – се менува како рачен налог.');
  const live = a.rows.filter((r) => !r.del);
  const t = lineTotals(live.map((r) => ({ debit: r.debit, credit: r.credit })));
  if (!t.balanced) throw new PostingError('unbalanced', `Налогот не е изедначен: должи ${t.D.toFixed(2)} / побарува ${t.P.toFixed(2)} (разлика ${t.diff.toFixed(2)}).`);
  if (!(await journalOverridesReady(tx))) throw new PostingError('not_found', 'Корекциите на налози бараат ажурирање на базата (миграција).');
  const data = diffOverride(st.base, a.rows);
  const j = st.journal;
  if (overrideEmpty(data)) {
    await tx.delete(journalOverrides).where(and(eq(journalOverrides.firmId, a.firmId), eq(journalOverrides.sourceType, j.sourceType!), eq(journalOverrides.sourceId, j.sourceId!)));
  } else {
    await tx.insert(journalOverrides).values({ firmId: a.firmId, sourceType: j.sourceType!, sourceId: j.sourceId!, data, base: st.base, updatedBy: a.userId })
      .onConflictDoUpdate({ target: [journalOverrides.firmId, journalOverrides.sourceType, journalOverrides.sourceId], set: { data, base: st.base, updatedBy: a.userId, updatedAt: new Date() } });
  }
  const meta = { ...(j.meta ?? {}) };
  delete (meta as Record<string, unknown>).override;
  const res = await updateJournal(tx, j.id, {
    firmId: a.firmId, date: j.date, kind: j.kind as never, description: j.description, number: j.number, periodFrom: j.periodFrom, periodTo: j.periodTo,
    meta, lines: baseLines(st.base), userId: a.userId, requirePartner: false, auditAction: 'nalOverrideRepost',
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: overrideEmpty(data) ? 'nalOverrideReset' : 'nalOverride', entityType: 'journal', entityId: j.id,
    data: { number: j.number, sourceType: j.sourceType, sourceId: j.sourceId, edits: data.edits.length, adds: data.adds.length } });
  return res;
}

/** „Врати како во документот“: remove the correction and re-write the generated lines. */
export async function resetJournalOverride(tx: Tx, a: { firmId: string; journalId: string; userId: string | null }) {
  const st = await journalOverrideState(tx, a.firmId, a.journalId);
  if (!st.base || !st.rows) throw new PostingError('not_found', 'Налогот нема рачна корекција.');
  return saveJournalOverride(tx, { ...a, rows: st.rows.filter((r) => r.i != null).map((r) => {
    const b = st.base![r.i!]!;
    return { i: r.i, account: b.account, debit: b.debit, credit: b.credit, partnerId: b.partnerId ?? null, note: b.note ?? '', doc: b.doc ?? '', del: false };
  }) });
}
