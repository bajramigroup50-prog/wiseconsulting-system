'use server';
/** kalkG / kalkM selection: „🔗 Спојување на селектираните“ (legacy `ksMerge`, needs the `fix` right). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { StockDocError, mergePurchases } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

export async function mergeCalcsAction(ids: string[]): Promise<ActionState> {
  const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (ok.length < 2) return { error: 'Селектирајте најмалку две калкулации.' };
  let id = '';
  try {
    const { u, firm } = await firmAction('fix');
    id = (await db().transaction((tx) => mergePurchases(tx, firm.id, ok, actorOf(u)))).id;
  } catch (e) { if (e instanceof StockDocError) return { error: e.message }; return actionError(e); }
  revalidatePath('/', 'layout');
  redirect(`/vlez?edit=${id}&merged=1`);
}
