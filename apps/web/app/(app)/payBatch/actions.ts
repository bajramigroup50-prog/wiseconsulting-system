'use server';
/**
 * Legacy ACT `pbGo` / `pbDel` / `pbExcel` (15300–15315). Each firm is saved and posted in its own transaction through
 * the payroll service (`saveRun` + `postRun`, the same path as Плати), guarded per firm.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { can, payNotesOpen } from '@wise/core';
import { payRateWarnNeeded } from '@wise/core/payroll/params';
import { audit, deleteRun, firms, loadPayOverrides, loadRun, payrollNotes, payrollRuns, postRun, saveRun } from '@wise/db';
import { Forbidden, requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { patchFirmSettings } from '@/lib/firms-office';
import { isUuid } from '@/lib/office';
import { isMonth, payError } from '@/lib/payroll/server';
import { pbBuild, type PbMode } from './data';

export async function confirmBatch(month: string, mode: PbMode, firmIds: string[]): Promise<ActionState> {
  if (!isMonth(month)) return { error: 'Неважечки месец.' };
  const u = await requireUser();
  let ok = 0;
  const skip: string[] = [];
  let rateMiss = 0;
  for (const id of firmIds.filter(isUuid).slice(0, 1000)) {
    try {
      if (!can(u.principal, 'savePay2', id)) { skip.push(id); continue; }
      const r = await db().transaction(async (tx) => {
        const [f] = await tx.select().from(firms).where(eq(firms.id, id)).limit(1);
        if (!f || (f.settings as { payManual?: boolean }).payManual) return false;
        const [ex] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, id), eq(payrollRuns.month, month))).limit(1);
        if (ex) return false;
        if (payNotesOpen(await tx.select().from(payrollNotes).where(and(eq(payrollNotes.firmId, id), eq(payrollNotes.done, false))), month).length) return false;
        // Legacy `pbGo` + `payRateWarn` (15301): no automatic payroll from 2027 until the new rates are confirmed.
        if (payRateWarnNeeded(month, await loadPayOverrides(tx, id))) { rateMiss++; return false; }
        const d = await pbBuild(tx, f, month, mode === 'cal' ? 'cal' : 'prev');
        if (!d) return false;
        const s = await saveRun(tx, { firmId: id, month, params: d.params, emps: d.emps, userId: u.id, source: 'auto-' + (mode === 'cal' ? 'cal' : 'prev') });
        await postRun(tx, { firmId: id, runId: s.id, userId: u.id });
        await audit(tx, { userId: u.id, firmId: id, action: 'pbGo', entityType: 'payroll_run', entityId: s.id, data: { month, mode, emps: d.emps.length } });
        return true;
      });
      if (r) ok++; else skip.push(id);
    } catch (e) {
      const r = payError(e);
      if (r.error) skip.push(id); else throw e;
    }
  }
  revalidatePath('/payBatch');
  revalidatePath('/plati');
  if (rateMiss && !ok) return { error: `За ${month} прво проверете ги стапките во „Параметри по периоди“.` };
  return { ok: `✓ Прокнижени: ${ok}${skip.length ? ' · прескокнати: ' + skip.length : ''}${rateMiss ? ` (${rateMiss} без потврдени стапки за 2027 – „Параметри по периоди“)` : ''}` };
}

/** Legacy `pbDel` (`del`): remove the month's run (and its journal), e.g. to import it from Excel. */
export async function deleteBatchRun(firmId: string, month: string): Promise<ActionState> {
  try {
    const u = await requireCan('del', firmId);
    await db().transaction(async (tx) => {
      const r = await loadRun(tx, firmId, { month });
      if (!r) return;
      if (r.locked) throw new Forbidden('Месецот е заклучен – прво отклучете го.');
      await deleteRun(tx, { firmId, runId: r.id, userId: u.id });
    });
    revalidatePath('/payBatch');
    return { ok: 'Избришано.' };
  } catch (e) { if (e instanceof Forbidden) return { error: e.message }; return payError(e); }
}

/** Legacy `pbExcel`: the firm brings its payroll from Excel every month (not automatic), or back to automatic. */
export async function setPayManual(firmId: string, manual: boolean): Promise<ActionState> {
  try {
    const u = await requireCan('write', firmId);
    await db().transaction(async (tx) => {
      await patchFirmSettings(tx, firmId, { payManual: manual });
      await audit(tx, { userId: u.id, firmId, action: 'pbExcel', entityType: 'firm', entityId: firmId, data: { payManual: manual } });
    });
    revalidatePath('/payBatch');
    return { ok: manual ? 'Секој месец од Excel.' : 'Автоматски.' };
  } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
}
