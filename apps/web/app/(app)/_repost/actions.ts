'use server';
/**
 * Legacy `ACT.schRepost` (ACT_NEED `settings`): re-post the current year with the current posting schemes.
 * UX Phase 3 (P31): the background re-post — „Прекнижи“ on the suggestion queues the worker job `books.repost` (open
 * periods only, „разлики“ report), and closing the notice. The changes themselves call `queueRepostChange` (lib/auto-repost).
 */
import { revalidatePath } from 'next/cache';
import { repostResult } from '@wise/core/repost';
import { dismissRepost, repostYear, requestRepost } from '@wise/db';
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
