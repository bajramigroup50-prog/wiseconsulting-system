'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { audit, itemBarcodes, items, ITEM_TYPES } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { db } from '@/lib/db';

const opt = z.string().trim().max(500).transform((s) => s || null);
const num = z.string().trim().transform((s) => s.replace(/\s/g, '').replace(',', '.'))
  .refine((s) => s === '' || Number.isFinite(Number(s)), 'Неважечки број.').transform((s) => (s === '' ? null : s));
const acct = opt.refine((s) => !s || /^\d{3,10}$/.test(s), 'Контото мора да има само цифри.');
const ItemInput = z.object({
  code: opt, name: z.string().trim().min(1, 'Внесете назив.').max(500),
  type: z.enum(ITEM_TYPES), unit: opt, price: num, vatRate: z.coerce.number().refine((r) => [18, 10, 5, 0].includes(r), 'ДДВ стапка: 18, 10, 5 или 0.'),
  revenueAccount: acct, minStock: num, weight: num, madeInMk: z.boolean(), oe: opt, crossRefs: opt, fits: opt,
  rawAccount: acct, costPrice: num, costPct: num, active: z.boolean(),
});
const TEXT = ['code', 'name', 'type', 'unit', 'price', 'vatRate', 'revenueAccount', 'minStock', 'weight', 'oe', 'crossRefs', 'fits', 'rawAccount', 'costPrice', 'costPct'] as const;

class UserError extends Error {}

/** Legacy `saveS('items')` 7401–7402: one barcode = one item; code unique. Guarded by `write`, audited. */
export async function saveItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get('id') ?? '') || null;
  try {
    const { u, firm } = await firmAction('write');
    const parsed = ItemInput.safeParse({
      ...Object.fromEntries(TEXT.map((k) => [k, String(form.get(k) ?? '')])),
      madeInMk: form.get('madeInMk') === 'on', active: form.get('active') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = parsed.data;
    const barcodes = [...new Set(String(form.get('barcodes') ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    await db().transaction(async (tx) => {
      if (v.code) {
        const [dup] = await tx.select({ name: items.name }).from(items)
          .where(and(eq(items.firmId, firm.id), eq(items.code, v.code), id ? ne(items.id, id) : undefined)).limit(1);
        if (dup) throw new UserError(`Шифрата ${v.code} веќе ја има „${dup.name}“.`);
      } else if (!id) {
        v.code = nextCode((await tx.select({ c: items.code }).from(items).where(eq(items.firmId, firm.id))).map((r) => r.c));
      }
      if (barcodes.length) {
        const [ow] = await tx.select({ bc: itemBarcodes.barcode, name: items.name }).from(itemBarcodes)
          .innerJoin(items, eq(items.id, itemBarcodes.itemId))
          .where(and(eq(itemBarcodes.firmId, firm.id), inArray(itemBarcodes.barcode, barcodes), id ? ne(itemBarcodes.itemId, id) : undefined)).limit(1);
        if (ow) throw new UserError(`Баркодот ${ow.bc} веќе го има „${ow.name}“. Еден баркод = еден производ.`);
      }
      let itemId = id;
      if (id) {
        const [before] = await tx.select().from(items).where(and(eq(items.id, id), eq(items.firmId, firm.id))).limit(1);
        if (!before) throw new UserError('Артиклот не постои.');
        await tx.update(items).set(v).where(eq(items.id, id));
        await tx.delete(itemBarcodes).where(eq(itemBarcodes.itemId, id));
        const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => String(before[k as keyof typeof before] ?? '') !== String(x ?? '')));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveS', entityType: 'item', entityId: id, data: { ...changed, barcodes } });
      } else {
        const [it] = await tx.insert(items).values({ ...v, firmId: firm.id }).returning({ id: items.id });
        itemId = it!.id;
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'newS', entityType: 'item', entityId: itemId, data: { name: v.name, code: v.code, barcodes } });
      }
      if (barcodes.length) await tx.insert(itemBarcodes).values(barcodes.map((barcode, i) => ({ firmId: firm.id, itemId: itemId!, barcode, primary: i === 0 })));
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/artikli');
  redirect('/artikli');
}

/** Delete an item (`del`). Items referenced by documents are protected by foreign keys (later phases). */
export async function deleteItem(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction(async (tx) => {
      const [it] = await tx.delete(items).where(and(eq(items.id, id), eq(items.firmId, firm.id))).returning();
      if (it) await audit(tx, { userId: u.id, firmId: firm.id, action: 'delS', entityType: 'item', entityId: id, data: { name: it.name, code: it.code } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/artikli');
  return { ok: 'Избришано.' };
}
