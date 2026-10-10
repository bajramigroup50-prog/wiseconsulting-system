'use server';
/**
 * МПИН од УЈП (сите фирми) — legacy `mpinAdd`, `mpinRe`, `mpinEdOk`, change of firm, `mpinClr`, `mpinGo`, `mpinDel`.
 * The inbox is office-wide (`office`); distributing needs `write` on each target firm, deleting needs `del`
 * (legacy: administrator only). Every mutation writes `audit_log` in its transaction.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { can } from '@wise/core';
import { MPIN_F, mpinFirmOf, mpinNorm, mpinPeriodOk, mpinReady, type MpinRead, type MpinStat } from '@wise/core/law';
import { audit, deleteMpinAck, distributeMpin, files, firms, MpinError, mpinInbox, PostingError } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { allowedFirms, isUuid, today } from '@/lib/office';

const MPIN_READ = 'mpin.read';

function err(e: unknown): ActionState {
  if (e instanceof MpinError || e instanceof Forbidden || e instanceof PostingError) return { error: e.message };
  throw e;
}

/** Rows of the current user's list. */
async function myRow(userId: string, id: unknown) {
  if (!isUuid(id)) throw new MpinError('Непознат ред.');
  const [r] = await db().select().from(mpinInbox).where(and(eq(mpinInbox.id, id), eq(mpinInbox.createdBy, userId))).limit(1);
  if (!r) throw new MpinError('Непознат ред.');
  return r;
}

/** Register uploaded PDFs / images and start one read per file (legacy `mpinAdd`). */
export async function startMpinRead(fileIds: string[]): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const ids = [...new Set(fileIds.filter(isUuid))].slice(0, 200);
    if (!ids.length) return { error: 'Изберете PDF или слика од МПИН.' };
    const F = await db().select({ id: files.id, name: files.name, uploadedBy: files.uploadedBy, firmId: files.firmId }).from(files)
      .where(and(inArray(files.id, ids), eq(files.status, 'ready')));
    // own uploads, or duplicates of files the user can see
    const ok = F.filter((f) => f.uploadedBy === u.id || (f.firmId ? can(u.principal, 'write', f.firmId) : true));
    if (!ok.length) return { error: 'Датотеката не е пронајдена.' };
    const rows = await db().transaction(async (tx) => {
      const R = await tx.insert(mpinInbox).values(ok.map((f) => ({ fileId: f.id, name: f.name, createdBy: u.id }))).returning({ id: mpinInbox.id });
      await audit(tx, { userId: u.id, action: 'mpinRead', entityType: 'mpin_inbox', data: { count: R.length } });
      return R;
    });
    for (const r of rows) await enqueue(MPIN_READ, { rowId: r.id });
    revalidatePath('/mpinIn');
    return { ok: `${rows.length} МПИН се читаат…` };
  } catch (e) { return err(e); }
}

/** Read again (legacy `mpinRe`). */
export async function rereadMpin(id: string): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const r = await myRow(u.id, id);
    if (r.status === 'done') return { error: 'МПИН е веќе распореден.' };
    await db().transaction(async (tx) => {
      await tx.update(mpinInbox).set({ status: 'queued', error: null }).where(eq(mpinInbox.id, r.id));
      await audit(tx, { userId: u.id, action: 'mpinReread', entityType: 'mpin_inbox', entityId: r.id });
    });
    await enqueue(MPIN_READ, { rowId: r.id });
    revalidatePath('/mpinIn');
    return {};
  } catch (e) { return err(e); }
}

/** Choose the firm of a row (legacy `data-mpf` select). Only firms the user may write to. */
export async function setMpinFirm(id: string, firmId: string): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const r = await myRow(u.id, id);
    if (r.status === 'done') return { error: 'МПИН е веќе распореден.' };
    const fid = isUuid(firmId) ? firmId : null;
    if (fid && !can(u.principal, 'write', fid)) throw new Forbidden('write');
    await db().transaction(async (tx) => {
      await tx.update(mpinInbox).set({ firmId: fid }).where(eq(mpinInbox.id, r.id));
      await audit(tx, { userId: u.id, firmId: fid, action: 'mpinFirm', entityType: 'mpin_inbox', entityId: r.id });
    });
    revalidatePath('/mpinIn');
    return {};
  } catch (e) { return err(e); }
}

/** Manual entry / correction of the read values (legacy `mpinEd` / `mpinEdOk`). */
export async function editMpin(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const r = await myRow(u.id, f.get('id'));
    if (r.status === 'done') return { error: 'МПИН е веќе распореден.' };
    const o: Record<string, unknown> = { isMpin: true };
    for (const [k] of MPIN_F) o[k] = String(f.get(k) ?? '').trim();
    const M = mpinNorm(o);
    M.how = 'рачно';
    if (!mpinPeriodOk(M.period)) return { error: 'Внесете период, пр. 09/2026.' };
    if (!M.gross) return { error: 'Внесете бруто основица.' };
    let fid = r.firmId;
    if (!fid) {
      const F = await allowedFirms(u);
      fid = mpinFirmOf(F, M.edb, M.name)?.id ?? null;
    }
    await db().transaction(async (tx) => {
      await tx.update(mpinInbox).set({ status: 'ok', result: M as unknown as Record<string, unknown>, error: null, firmId: fid }).where(eq(mpinInbox.id, r.id));
      await audit(tx, { userId: u.id, firmId: fid, action: 'mpinEdit', entityType: 'mpin_inbox', entityId: r.id, data: { period: M.period, gross: M.gross } });
    });
    revalidatePath('/mpinIn');
    return { ok: 'Зачувано.' };
  } catch (e) { return err(e); }
}

/** Clear the list (legacy `mpinClr`): the rows stay for the audit trail, only hidden. */
export async function clearMpinList(): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    await db().transaction(async (tx) => {
      const R = await tx.update(mpinInbox).set({ cleared: true }).where(and(eq(mpinInbox.createdBy, u.id), eq(mpinInbox.cleared, false))).returning({ id: mpinInbox.id });
      await audit(tx, { userId: u.id, action: 'mpinClear', entityType: 'mpin_inbox', data: { count: R.length } });
    });
    revalidatePath('/mpinIn');
    return {};
  } catch (e) { return err(e); }
}

/** Distribute the ready rows to their firms (legacy `mpinGo`); one transaction per declaration. */
export async function distributeMpinRows(book: boolean): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const R = await db().select().from(mpinInbox).where(and(eq(mpinInbox.createdBy, u.id), eq(mpinInbox.cleared, false), eq(mpinInbox.status, 'ok')));
    const L = R.filter((r) => mpinReady({ stat: r.status as MpinStat, firmId: r.firmId, M: r.result as Partial<MpinRead> | null }));
    if (!L.length) return { error: 'Нема подготвени МПИН.' };
    const names = new Map((await db().select({ id: firms.id, name: firms.name }).from(firms)).map((f) => [f.id, f.name]));
    let ok = 0, jn = 0;
    const bad: string[] = [];
    for (const r of L) {
      try {
        if (!can(u.principal, 'write', r.firmId!)) throw new Forbidden('write');
        const x = await db().transaction((tx) => distributeMpin(tx, { rowId: r.id, userId: u.id, byName: u.name, book, today: today() }));
        ok++;
        if (x.journalId) jn++;
      } catch (e) {
        const m = e instanceof MpinError || e instanceof Forbidden || e instanceof PostingError ? e.message : (console.error('[mpinGo]', e), 'грешка');
        await db().update(mpinInbox).set({ error: m }).where(eq(mpinInbox.id, r.id));
        bad.push(`${names.get(r.firmId!) ?? r.name}: ${m}`);
      }
    }
    revalidatePath('/mpinIn');
    revalidatePath('/plati');
    const msg = `✓ ${ok} МПИН распоредени${jn ? ` · ${jn} налози отворени` : ''}.`;
    return bad.length ? { error: msg + ' Не успеаја: ' + bad.join(' · ') } : { ok: msg };
  } catch (e) { return err(e); }
}

/** Delete a month's acceptance (legacy `mpinDel`, administrator only → `del`). */
export async function deleteMpinMonth(firmId: string, month: string): Promise<ActionState> {
  try {
    if (!isUuid(firmId) || !mpinPeriodOk(month)) return { error: 'Неважечки податоци.' };
    const u = await requireCan('del', firmId);
    const r = await db().transaction((tx) => deleteMpinAck(tx, { firmId, month, userId: u.id }));
    revalidatePath('/mpinIn');
    revalidatePath('/plati');
    return { ok: `МПИН за ${month} е избришан${r.journal ? ' (и налогот)' : ''}. Сега може да прикачите друг.` };
  } catch (e) { return err(e); }
}
