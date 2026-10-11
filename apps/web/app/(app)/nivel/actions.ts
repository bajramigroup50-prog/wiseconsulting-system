'use server';
/** Нивелација with imported quantities / old prices (legacy `saveNivel` after `nivImp`: `d.qty`, `d.old`). */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createLevellingItems, saveLevelling } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { stockAction, todayIso } from '@/lib/stock';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.');
const nums = z.record(z.string().uuid(), z.number().finite());
const In = z.object({
  id: z.string().uuid().nullish(), date, wh: z.string().max(40).nullish(), note: z.string().max(500).nullish(), promoTo: date.nullish().or(z.literal('')),
  prices: nums, qty: nums.optional(), old: nums.optional(),
});

/** „+ Креирај ги како нови артикли“ (legacy `nivMk`): unknown import codes → items; returns code → id. */
export async function createNivItemsAction(wh: string, rows: { code: string; price: number }[]): Promise<ActionState & { ids?: Record<string, string> }> {
  const R = z.array(z.object({ code: z.string().min(1).max(60), price: z.number().finite().min(0) })).max(2000).safeParse(rows);
  if (!R.success) return { error: 'Неважечки податоци.' };
  const st = await stockAction('nivMk', ['/nivel', '/artikli'], (tx, a) => createLevellingItems(tx, a, { wh, rows: R.data }));
  return st.error ? st : { ok: `${Object.keys(st.data!).length} нови артикли се креирани и додадени во нивелацијата.`, ids: st.data };
}

export async function saveNivelAction(_p: ActionState, form: FormData): Promise<ActionState> {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const v = In.safeParse(raw);
  if (!v.success) return { error: v.error.issues[0]?.message ?? 'Неважечки податоци.' };
  if (!Object.keys(v.data.prices).length) return { error: 'Внесете барем една нова цена.' };
  const st = await stockAction('saveNivel', ['/nivel', '/m_trg', '/m_lager'], (tx, a) => saveLevelling(tx, a, { ...v.data, promoTo: v.data.promoTo || null, today: todayIso() }));
  if (st.error) return st;
  redirect('/nivel');
}
