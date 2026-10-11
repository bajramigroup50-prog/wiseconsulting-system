'use server';
/** Legacy `ACT.schRepost` (ACT_NEED `settings`): re-post the current year with the current posting schemes. */
import { revalidatePath } from 'next/cache';
import { repostResult } from '@wise/core/repost';
import { repostYear } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function repostYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('settings');
    const R = await db().transaction((tx) => repostYear(tx, { firmId: firm.id, userId: u.id }, year));
    for (const p of ['/izlez', '/uslugi', '/odobrenija', '/profakturi', '/ispratnici', '/nalozi', '/semi', '/vlez', '/ddv', '/bilanc']) revalidatePath(p);
    const msg = repostResult(R.n, R.locked, R.failed) + (R.errors.length ? ` (${R.errors.join('; ')})` : '');
    return R.failed && !R.n ? { error: msg } : { ok: msg };
  } catch (e) { return actionError(e); }
}
