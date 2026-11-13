'use server';
/**
 * Legacy `ACT.schRepost` (ACT_NEED `settings`): re-post the current year with the current posting schemes.
 * UX Phase 3 (P31): the background re-post — „Прекнижи“ on the suggestion queues the worker job `books.repost` (open
 * periods only, „разлики“ report), and closing the notice. The changes themselves call `queueRepostChange` (lib/auto-repost).
 */
import { revalidatePath } from 'next/cache';
import { repostResult } from '@wise/core/repost';
import { dismissRepost, repostPersonInvoices, repostYear, requestRepost } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentYear } from '@/lib/context';
import { allowedFirms } from '@/lib/office';
import { isOfficeOwner } from '@/lib/office-owner';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { sendRepostRuns } from '@/lib/auto-repost';

const PATHS = ['/izlez', '/uslugi', '/odobrenija', '/profakturi', '/ispratnici', '/nalozi', '/semi', '/vlez', '/ddv', '/bilanc', '/banka'];

export async function repostYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('settings');
    const R = await db().transaction((tx) => repostYear(tx, { firmId: firm.id, userId: u.id }, year));
    for (const p of PATHS) revalidatePath(p);
    const msg = repostResult(R.n, R.locked, R.failed) + (R.errors.length ? ` (${R.errors.join('; ')})` : '');
    return R.failed && !R.n ? { error: msg } : { ok: msg };
  } catch (e) { return actionError(e); }
}

/** „Прекнижи“ on the suggestion (`settings`): the worker job re-posts the open periods and reports the differences. */
export async function requestRepostAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('settings');
    const runId = await db().transaction((tx) => requestRepost(tx, { firmId: firm.id, userId: u.id, year }));
    if (!runId) return { error: 'Прекнижувањето веќе тече – почекајте да заврши.' };
    if (!(await sendRepostRuns({ queue: [{ firmId: firm.id, runId }], due: 0 }))) return { error: 'Редот за задачи е недостапен – обидете се повторно.' };
    for (const p of PATHS) revalidatePath(p);
    return { ok: 'Прекнижувањето започна во позадина (само отворени периоди). Извештајот „разлики“ ќе се појави тука.' };
  } catch (e) { return actionError(e); }
}

/** Close the notice of the last run (`due`: drop the suggestion instead). */
export async function dismissRepostAction(due: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    await db().transaction((tx) => dismissRepost(tx, { firmId: firm.id, userId: u.id, due }));
    for (const p of PATHS) revalidatePath(p);
    return { ok: 'Затворено.' };
  } catch (e) { return actionError(e); }
}

/**
 * „👤 Физички лица → 1205 (сите фирми)“ – office owner only: in every firm, the year's invoices of buyers who are natural
 * persons are re-posted so their receivable is on 1205 (`customerPerson`); locked periods are skipped. One transaction per firm.
 */
export async function repostPeopleAllAction(): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (!(await isOfficeOwner(u))) return { error: 'Само сопственикот на канцеларијата.' };
    const year = await currentYear();
    const F = await allowedFirms(u);
    let firmsN = 0, n = 0, locked = 0, failed = 0;
    const errs: string[] = [];
    for (const f of F) {
      const R = await db().transaction((tx) => repostPersonInvoices(tx, { firmId: f.id, userId: u.id }, year));
      if (R.found) firmsN++;
      n += R.n; locked += R.locked; failed += R.failed;
      if (R.errors.length && errs.length < 3) errs.push(`${f.name}: ${R.errors[0]}`);
    }
    for (const p of PATHS) revalidatePath(p);
    return { ok: `Физички лица → 1205: прекнижани ${n} фактури во ${firmsN} фирми${locked ? `, ${locked} во заклучен период (прескокнати)` : ''}${failed ? `, ${failed} не успеаја (${errs.join('; ')})` : ''}.` };
  } catch (e) { return actionError(e); }
}
