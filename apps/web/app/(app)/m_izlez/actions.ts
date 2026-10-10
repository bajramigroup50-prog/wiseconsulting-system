'use server';
/** Излез од продавница — store sale / supplier return (legacy `moSaveDoc` / `moDel` for kinds `sale` / `ret`). */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteStoreOut, saveStoreOut } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { stockAction } from '@/lib/stock';

const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/\s/g, '').replace(',', '.'))).refine(Number.isFinite, 'Неважечки број.');
const In = z.object({
  id: z.string().uuid().nullish(), kind: z.enum(['sale', 'ret']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.'), wh: z.string().max(40).nullish(),
  number: z.string().max(40).nullish(), partnerId: z.string().uuid().nullish().or(z.literal('')), ref: z.string().max(80).nullish(), account: z.string().max(12).nullish(),
  note: z.string().max(500).nullish(), lines: z.array(z.object({ itemId: z.string().uuid(), qty: num, price: num.nullish() })).max(5000),
});

export async function saveStoreOutAction(_p: ActionState, form: FormData): Promise<ActionState> {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const v = In.safeParse(raw);
  if (!v.success) return { error: v.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const st = await stockAction('moSave', ['/m_izlez', '/kdfi', '/m_trg'], (tx, a) => saveStoreOut(tx, a, { ...v.data, partnerId: v.data.partnerId || null }));
  if (st.error) return st;
  redirect(`/m_izlez?t=${v.data.kind}&saved=${encodeURIComponent(st.data!.number)}`);
}

export async function deleteStoreOutAction(id: string): Promise<ActionState> {
  return stockAction('moDel', ['/m_izlez', '/kdfi', '/m_trg'], (tx, a) => deleteStoreOut(tx, a, id));
}
