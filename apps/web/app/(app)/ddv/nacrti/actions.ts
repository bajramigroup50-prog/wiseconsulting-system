'use server';
/**
 * P37 „ДДВ-04 – нацрти“: close in bulk ONLY the ticked drafts that have no problems — each re-checked now (same field
 * 31, still no problems) and then closed by the existing `closeVatPeriod` (posts the VAT-close journal, freezes the
 * return), `write` on each firm like „Затвори период“ on ДДВ-04. Audited per firm (`ddvClose`, `autoVatClose`) and as a batch.
 */
import { revalidatePath } from 'next/cache';
import { can } from '@wise/core';
import { audit, closeVatDrafts } from '@wise/db';
import { requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { isUuid, officeError } from '@/lib/office';
import { vatSource } from '@/lib/vat-source';

export async function closeSelectedVatDrafts(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (!viewAllowed(u.role, 'ddv')) return { error: 'Немате пристап.' };
    const ids = f.getAll('id').map(String).filter(isUuid).slice(0, 1000);
    if (!ids.length) return { error: 'Означете барем една пријава.' };
    const r = await closeVatDrafts(db(), { ids, userId: u.id, allowed: (fid) => can(u.principal, 'write', fid), source: vatSource });
    await audit(db(), { userId: u.id, action: 'autoVatCloseAll', entityType: 'automation', data: { ticked: ids.length, closed: r.closed.length, skipped: r.skipped.length } });
    revalidatePath('/ddv/nacrti');
    revalidatePath('/ddv');
    revalidatePath('/nalozi');
    if (!r.closed.length) return { error: `Ништо не е затворено. ${r.skipped.join('; ')}` };
    return { ok: `✓ Затворени: ${r.closed.join(', ')}${r.skipped.length ? ` · не се затворени: ${r.skipped.join('; ')}` : ''}` };
  } catch (e) { return officeError(e); }
}
