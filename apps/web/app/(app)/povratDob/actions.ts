'use server';
/** Supplier returns / credits (legacy `scrSave` 8826, `scrDel` 8835; ACT_NEED scrSave: write, scrDel: del). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit, deleteSupplierCredit, ensurePartner, saveSupplierCredit } from '@wise/db';
import { loadAiResult } from '@/lib/ai';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'));
const Payload = z.object({
  id: z.string().nullable(), kind: z.enum(['ret', 'disc']), number: z.string().max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.'),
  supNo: z.string().max(60), partnerId: z.string().max(40), refPurchaseId: z.string().max(40), warehouseId: z.string().max(40), note: z.string().max(1000),
  rows: z.array(z.object({ itemId: z.string().max(40), name: z.string().max(300), qty: str, price: str, rate: str, account: z.string().max(10) })).max(1000),
});

export async function saveScrAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  let w = '';
  try {
    const p = Payload.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction('scrSave');
    const r = await db().transaction((tx) => saveSupplierCredit(tx, firm.id, {
      ...v, refPurchaseId: v.refPurchaseId || null, warehouseId: v.warehouseId || null, rows: v.rows.map((x) => ({ ...x, itemId: x.itemId || null })),
    }, actorOf(u)));
    id = r.id;
    w = r.warnings.join(' | ');
  } catch (e) { return actionError(e); }
  revalidatePath('/povratDob');
  redirect('/povratDob?saved=' + id + (w ? '&w=' + encodeURIComponent(w) : ''));
}

export async function deleteScrAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction((tx) => deleteSupplierCredit(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/povratDob');
  return { ok: 'Избришано.' };
}

/** Legacy `scrScanFile` 16228: an unknown supplier from the read document is added (`ensureSupplier`) before the editor opens. */
export async function scrScanPrepare(aiId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const d = await loadAiResult(firm.id, aiId, 'scr');
    if (!d) return { error: 'Читањето не успеа. Внесете рачно.' };
    const r = (d.result ?? {}) as { supplierName?: string; supplierEdb?: string };
    if (r.supplierName) {
      await db().transaction(async (tx) => {
        const x = await ensurePartner(tx, firm.id, { name: r.supplierName!, edb: r.supplierEdb, type: 'supplier' });
        if (x.created) await audit(tx, { userId: u.id, firmId: firm.id, action: 'addSupplier', entityType: 'partner', entityId: x.id, data: { name: r.supplierName, from: 'scr-scan' } });
      });
    }
    return { ok: 'ok' };
  } catch (e) { return actionError(e); }
}
