'use server';
/** Server actions for purchases (legacy `savePur` 7166 → `purPersist`, `delPur`, approval of client entries). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { approvePurchase, deletePurchase, markDraftSaved, savePurchase, type PurchaseInput } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'));
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечки датум.');
const id = z.string().max(40);
const Cost = z.object({
  amount: str, fx: str, doc: z.string().max(100), date, due: date, partnerId: id, byQty: z.boolean(), foreign: z.boolean(),
  lines: z.array(z.object({ base: str, rate: str, vat: str })).max(3),
});
const Payload = z.object({
  id: z.string().nullable(), number: z.string().max(60), date: date.refine((s) => !!s, 'Внесете датум.'), docDate: date, due: date,
  partnerId: id, supplierName: z.string().max(300), supplierEdb: z.string().max(20), ptype: z.enum(['stock', 'cost']),
  art32: z.boolean(), imp: z.boolean(), cash: z.boolean(), noDed: z.boolean(), warehouseId: id, supplierAccount: z.string().max(10),
  currency: z.string().max(3), fx: str, calcNo: z.string().max(30), distMode: z.enum(['val', 'cn', 'multi']), cnames: z.array(str).max(15),
  groups: z.array(z.object({ account: z.string().max(10), rate: str, base: str, vat: str })).max(50),
  stock: z.array(z.object({
    itemId: id, name: z.string().max(500), code: z.string().max(60), barcode: z.string().max(40), unit: z.string().max(20), qty: str, price: str,
    rab: str, amount: str, cn: str, dep: str, sp: str, type: z.string().max(10), rate: str,
  }).passthrough()).max(3000),
  costs: z.record(z.string(), Cost), data: z.record(z.string(), z.string().max(500)), fileIds: z.array(z.uuid()).max(10),
  allowDuplicate: z.boolean().optional(),
  scanDocId: z.string().max(40).optional(), scanIndex: z.number().int().min(0).optional(), back: z.string().max(200).optional(),
}).passthrough();

export async function savePurchaseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target = '';
  try {
    const p = Payload.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction(v.id ? 'editPur' : 'savePur');
    const input: PurchaseInput = {
      ...v, partnerId: v.partnerId || null, warehouseId: v.warehouseId || null, scanned: !!v.scanDocId,
      stock: v.stock.map((s) => ({ ...s, itemId: s.itemId || null })),
      costs: Object.fromEntries(Object.entries(v.costs).map(([k, c]) => [k, { ...c, partnerId: c.partnerId || null, date: c.date || null, due: c.due || null }])),
    };
    const res = await db().transaction(async (tx) => {
      const r = await savePurchase(tx, firm.id, input, actorOf(u));
      if (v.scanDocId != null && v.scanIndex != null) await markDraftSaved(tx, firm.id, v.scanDocId, v.scanIndex, r.id);
      return r;
    });
    const back = v.back && /^\/[a-zA-Z]/.test(v.back) ? v.back : '/vlez';
    const q = new URLSearchParams({ saved: res.id });
    if (res.warnings.length) q.set('w', res.warnings.join(' | ').slice(0, 1500));
    target = back + (back.includes('?') ? '&' : '?') + q.toString();
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  redirect(target);
}

export async function deletePurchaseAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction((tx) => deletePurchase(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Влезната фактура е избришана.' };
}

export async function approvePurchaseAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction((tx) => approvePurchase(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Одобрено.' };
}
