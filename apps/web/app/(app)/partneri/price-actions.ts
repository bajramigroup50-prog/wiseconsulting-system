'use server';
/** „💲 Ценовник по комитент“: save the customer's own prices (`partners.data.prices`, item → net price; audit `partnerPrices`). */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { audit, items, partners } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function partnerPricesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('partnerPrices');
    const pid = String(form.get('partner') ?? '');
    const ids = form.getAll('item').map(String), vals = form.getAll('price').map(String);
    const rab = +String(form.get('rabatAll') ?? '').replace(',', '.');
    if (rab && !(rab > 0 && rab < 100)) return { error: 'Рабатот мора да е меѓу 0 и 100 %.' };
    const n = await db().transaction(async (tx) => {
      const [p] = await tx.select().from(partners).where(and(eq(partners.id, pid), eq(partners.firmId, firm.id))).limit(1);
      if (!p) throw new Error('Комитентот не постои.');
      const data = (p.data ?? {}) as Record<string, unknown>;
      const prices: Record<string, number> = { ...((data.prices as Record<string, number> | undefined) ?? {}) };
      /* only the firm's own items; a rabat % sets every listed item from its base price */
      const base = new Map((ids.length ? await tx.select({ id: items.id, price: items.price }).from(items).where(and(eq(items.firmId, firm.id), inArray(items.id, ids))) : [])
        .map((i) => [i.id, Number(i.price ?? 0)]));
      ids.forEach((id, i) => {
        if (!base.has(id)) return;
        const v = rab ? Math.round(base.get(id)! * (1 - rab / 100) * 100) / 100 : +(vals[i] ?? '').replace(',', '.');
        if (v > 0) prices[id] = Math.round(v * 10000) / 10000; else delete prices[id];
      });
      await tx.update(partners).set({ data: { ...data, prices } }).where(eq(partners.id, p.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'partnerPrices', entityType: 'partner', entityId: p.id, data: { n: Object.keys(prices).length, rabat: rab || null } });
      return Object.keys(prices).length;
    });
    revalidatePath(`/partneri/${pid}/ceni`);
    return { ok: `Зачувано: ${n} посебни цени.` };
  } catch (e) { return actionError(e); }
}
