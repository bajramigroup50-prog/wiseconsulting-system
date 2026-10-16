'use server';
/**
 * P36 „Плати – нацрти“: „Прокнижи ги избраните“ posts ONLY the ticked drafts, each through the payroll service's
 * `postRun` (lock, open pay-change notes and МПИН-double checks inside), one transaction per firm, with `savePay2` on
 * the firm (like „✅ Потврди и прокнижи“ on Плати – сите фирми). Audited per run (`autoPayPost`) and as a batch.
 */
import { revalidatePath } from 'next/cache';
import { can } from '@wise/core';
import { audit, postPayDrafts } from '@wise/db';
import { requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { isUuid, officeError } from '@/lib/office';

export async function postSelectedPayDrafts(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (!viewAllowed(u.role, 'plati')) return { error: 'Немате пристап.' };
    const ids = f.getAll('id').map(String).filter(isUuid).slice(0, 1000);
    if (!ids.length) return { error: 'Означете барем една пресметка.' };
    const r = await postPayDrafts(db(), { ids, userId: u.id, allowed: (fid) => can(u.principal, 'savePay2', fid) });
    await audit(db(), { userId: u.id, action: 'autoPayPostAll', entityType: 'automation', data: { ticked: ids.length, posted: r.posted.length, skipped: r.skipped.length } });
    revalidatePath('/plati/nacrti');
    revalidatePath('/plati');
    revalidatePath('/payBatch');
    if (!r.posted.length) return { error: `Ништо не е прокнижено. ${r.skipped.join('; ')}` };
    return { ok: `✓ Прокнижени: ${r.posted.length}${r.skipped.length ? ` · не се прокнижени: ${r.skipped.join('; ')}` : ''}` };
  } catch (e) { return officeError(e); }
}
