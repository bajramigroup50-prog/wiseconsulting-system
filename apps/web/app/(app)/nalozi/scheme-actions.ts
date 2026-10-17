'use server';
/**
 * „Прекнижи ги избраните со Шема N“ (the document list of an open nalog): the chosen invoices / purchases are booked
 * again with the numbered scheme (`@wise/db` `repostWithScheme`) — open periods only, the skipped ones reported, audited
 * `schemeRepost`, with the konto totals before → after. Choosing a scheme on a document needs `write` (not `settings`).
 */
import { revalidatePath } from 'next/cache';
import type { KontoDiff } from '@wise/core/repost';
import { schemeNoOf } from '@wise/core/scheme-profiles';
import { repostWithScheme, SchemeProfileError } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export interface SchemeRepostState extends ActionState { diffs?: KontoDiff[]; skipped?: { label: string; reason: string }[] }

export async function repostSchemeAction(_p: SchemeRepostState, f: FormData): Promise<SchemeRepostState> {
  try {
    const { u, firm } = await firmAction('write');
    const ids = f.getAll('j').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
    if (!ids.length) return { error: 'Одберете документи (☑) во налогот.' };
    const no = schemeNoOf(f.get('scheme'));
    const R = await db().transaction((tx) => repostWithScheme(tx, firm.id, ids, no, u.id));
    for (const p of ['/nalozi', '/izlez', '/vlez', '/bilanc', '/kkart']) revalidatePath(p);
    const msg = `Прекнижани ${R.n} документи со Шема ${no}.${R.skipped.length ? ` ${R.skipped.length} прескокнати.` : ''}${R.diffs.length ? '' : ' Контата не се сменети.'}`;
    return { ...(R.n ? { ok: msg } : { error: msg }), diffs: R.diffs, skipped: R.skipped.map((s) => ({ label: s.label, reason: s.reason })) };
  } catch (e) {
    if (e instanceof SchemeProfileError) return { error: e.message };
    return actionError(e);
  }
}
