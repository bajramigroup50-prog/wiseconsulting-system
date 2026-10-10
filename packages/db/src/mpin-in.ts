/**
 * МПИН од УЈП — distribution of accepted declarations to their firms (legacy `ACT.mpinGo` 14086 + the v452 correction
 * wrapper 14119, `ACT.mpinDel` 14124). The only writer of `mpin_acks`.
 *
 * Per declaration, in one transaction: the PDF goes to the firm's dossier („Плати и персонал“); if the month has a
 * payroll run it is marked „МПИН прифатен“ (the ack row points to the run); otherwise, when booking is on, a journal
 * of kind `mpin` (source `mpin-ack`/month) is posted from the declaration; the ack row is stored and audited.
 *
 * DELIBERATE FIXES (legacy wrote Firestore documents directly):
 * - FIX(#1) every path goes through the posting service (period lock, numbering, audit) — legacy `mpinSetIn` wrote the
 *   journal document with no lock check besides `f.lock` and no audit.
 * - FIX(#2) FIX #12 of Phase 6: a declaration is never booked when the payroll run of the month is posted.
 * - FIX(#3) a correction that is no longer booked (the payroll was calculated in the meantime) removes the old `mpin`
 *   journal, so the month is not booked twice; legacy left it in place.
 * - FIX(#4) deleting an acceptance needs the `del` permission (legacy: role admin in the UI only).
 */
import { and, eq, isNull, like } from 'drizzle-orm';
import { mpinLastDay, mpinLinesFor, mpinNote, mpinPer, mpinPeriodOk, type MpinPlan, type MpinRead } from '@wise/core/law';
import { audit, type Tx } from './audit';
import { loadPayScheme, mpinAckPostAllowed } from './payroll';
import { postJournal, unpostSource } from './posting';
import { dossierDocs, fileLinks, files, firms, journals, mpinAcks, mpinInbox, payrollRuns } from './schema/index';

export class MpinError extends Error {}

export const MPIN_DOSSIER_CATEGORY = 'Плати и персонал';
const dmy = (d: string) => d.split('-').reverse().join('.');
const fm = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the distribution would find for a firm and month (legacy `r.pay`, `r.jEx`, `r.old`). */
export async function mpinPlanFor(tx: Tx, firmId: string, month: string, book: boolean): Promise<MpinPlan & { runId: string | null }> {
  const [run] = await tx.select({ id: payrollRuns.id, totals: payrollRuns.totals }).from(payrollRuns)
    .where(and(eq(payrollRuns.firmId, firmId), eq(payrollRuns.month, month))).limit(1);
  const [j] = await tx.select({ id: journals.id }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, 'mpin-ack'), eq(journals.sourceId, month))).limit(1);
  const [old] = await tx.select({ no: mpinAcks.no, date: mpinAcks.date }).from(mpinAcks)
    .where(and(eq(mpinAcks.firmId, firmId), eq(mpinAcks.month, month), eq(mpinAcks.replaced, false))).limit(1);
  const t = run?.totals ?? {};
  return {
    run: run ? { gross: Math.round(((+(t.gross ?? 0)) + (+(t.dopl ?? 0))) * 100) / 100 } : null,
    runId: run?.id ?? null, journal: !!j, old: old ?? null, book,
  };
}

export interface MpinDistributeResult { ackId: string; res: string; journalId: string | null; corr: boolean }

/** Distribute one read inbox row to its firm (legacy `mpinGo` per row). The caller checked `write` on the firm. */
export async function distributeMpin(tx: Tx, a: { rowId: string; userId: string | null; byName?: string | null; book: boolean; today: string }): Promise<MpinDistributeResult> {
  const [row] = await tx.select().from(mpinInbox).where(eq(mpinInbox.id, a.rowId)).for('update');
  if (!row || row.status !== 'ok') throw new MpinError('МПИН не е подготвен за распоредување.');
  const M = row.result as unknown as MpinRead;
  if (!row.firmId) throw new MpinError('Изберете фирма.');
  if (!mpinPeriodOk(M?.period)) throw new MpinError('Нема период.');
  const [f] = await tx.select().from(firms).where(eq(firms.id, row.firmId)).limit(1);
  if (!f) throw new MpinError('Фирмата не постои.');
  const month = M.period, per = mpinPer(month);

  const [file] = await tx.select().from(files).where(eq(files.id, row.fileId)).limit(1);
  if (!file) throw new MpinError('прикачувањето не успеа');
  if (file.firmId && file.firmId !== f.id) throw new MpinError('Истиот PDF веќе е прикачен кај друга фирма.');
  if (!file.firmId) await tx.update(files).set({ firmId: f.id }).where(and(eq(files.id, file.id), isNull(files.firmId)));

  const plan = await mpinPlanFor(tx, f.id, month, a.book);
  // correction: the previous acceptance stays in the dossier as „(заменет)“
  const [old] = await tx.select().from(mpinAcks).where(and(eq(mpinAcks.firmId, f.id), eq(mpinAcks.month, month), eq(mpinAcks.replaced, false))).for('update');
  if (old) {
    await tx.update(mpinAcks).set({ replaced: true }).where(eq(mpinAcks.id, old.id));
    if (old.dossierId) {
      const [d] = await tx.select({ title: dossierDocs.title }).from(dossierDocs).where(eq(dossierDocs.id, old.dossierId)).limit(1);
      if (d && !/\(заменет\)$/.test(d.title ?? '')) await tx.update(dossierDocs).set({ title: (d.title || 'МПИН') + ' (заменет)' }).where(eq(dossierDocs.id, old.dossierId));
    }
  }

  const [doc] = await tx.insert(dossierDocs).values({
    firmId: f.id, category: MPIN_DOSSIER_CATEGORY, title: 'МПИН – Декларација за прием ' + per, number: M.subNo || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(M.subDate) ? M.subDate : a.today, partnerName: f.name, note: mpinNote(M, fm), createdBy: a.userId,
  }).returning({ id: dossierDocs.id });
  await tx.insert(fileLinks).values({ fileId: file.id, entityType: 'dossier_doc', entityId: doc!.id, role: 'attachment' }).onConflictDoNothing();

  let res = 'Досие ✓';
  let journalId: string | null = null;
  if (plan.run) {
    res += ' · месецот означен „МПИН прифатен“';
    if (plan.journal) { await unpostSource(tx, { firmId: f.id, sourceType: 'mpin-ack', sourceId: month, userId: a.userId }); res += ' · стариот налог од МПИН е избришан'; }
  } else if (a.book) {
    const date = mpinLastDay(month);
    if (f.lockDate && date <= f.lockDate) res += ' · налогот НЕ е отворен (периодот е заклучен)';
    else if (!(await mpinAckPostAllowed(tx, f.id, month))) res += ' · налогот НЕ е отворен (платата е прокнижена)';
    else {
      const scheme = await loadPayScheme(tx, f);
      const j = await postJournal(tx, {
        firmId: f.id, date, kind: 'mpin', sourceType: 'mpin-ack', sourceId: month,
        description: `Плата ${per} – според МПИН бр. ${M.subNo || ''}`, lines: mpinLinesFor(M, scheme),
        numbering: { payMonth: +month.slice(5, 7) }, meta: { month, mpinNo: M.subNo || null }, userId: a.userId, auditAction: 'postMpinAck',
      });
      journalId = j.id;
      res += ' · налог отворен';
    }
  }
  const [ack] = await tx.insert(mpinAcks).values({
    firmId: f.id, month, no: M.subNo || null, date: M.subDate || null, status: M.status || null, gross: String(M.gross), total: String(M.total),
    net: String(M.net), due: M.due || null, folio: M.folio || null, data: M as unknown as Record<string, unknown>, fileId: file.id, dossierId: doc!.id,
    journalId, runId: plan.runId, corr: !!old, createdBy: a.userId, byName: a.byName ?? null,
  }).returning({ id: mpinAcks.id });
  await tx.update(mpinInbox).set({ status: 'done', res, ackId: ack!.id, error: null }).where(eq(mpinInbox.id, row.id));
  await audit(tx, { userId: a.userId, firmId: f.id, action: 'mpinAck', entityType: 'mpin_ack', entityId: ack!.id, data: { month, no: M.subNo, gross: M.gross, journal: !!journalId, run: !!plan.runId, corr: !!old } });
  return { ackId: ack!.id, res, journalId, corr: !!old };
}

/** Delete the acceptance of a month (legacy `mpinDel`): dossier document, the „прифатен“ mark and the `mpin` journal. */
export async function deleteMpinAck(tx: Tx, a: { firmId: string; month: string; userId: string | null }): Promise<{ journal: boolean }> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!f) throw new MpinError('Фирмата не постои.');
  const [ack] = await tx.select().from(mpinAcks).where(and(eq(mpinAcks.firmId, a.firmId), eq(mpinAcks.month, a.month), eq(mpinAcks.replaced, false))).for('update');
  if (!ack) throw new MpinError('Нема МПИН за тој месец.');
  const [j] = await tx.select({ id: journals.id, date: journals.date }).from(journals)
    .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, 'mpin-ack'), eq(journals.sourceId, a.month))).limit(1);
  if (j && f.lockDate && j.date <= f.lockDate) throw new MpinError(`Периодот до ${dmy(f.lockDate)} е заклучен – налогот од МПИН не може да се брише.`);
  if (j) await unpostSource(tx, { firmId: a.firmId, sourceType: 'mpin-ack', sourceId: a.month, userId: a.userId });
  await tx.delete(mpinAcks).where(eq(mpinAcks.id, ack.id));
  if (ack.dossierId) {
    await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, 'dossier_doc'), eq(fileLinks.entityId, ack.dossierId)));
    await tx.delete(dossierDocs).where(eq(dossierDocs.id, ack.dossierId));
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mpinDel', entityType: 'mpin_ack', entityId: ack.id, data: { month: a.month, journal: !!j } });
  return { journal: !!j };
}

/** Active acceptances of the given firms for a year (legacy `mpinIdx` filtered by year). */
export async function mpinAcksOfYear(tx: Tx, year: number) {
  return tx.select().from(mpinAcks).where(and(like(mpinAcks.month, `${year}-%`), eq(mpinAcks.replaced, false)));
}
