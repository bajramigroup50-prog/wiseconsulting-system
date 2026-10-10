'use server';
/** Legacy ACT `fxSave` / `fxDel` (need `settings`) — office-wide rate list, no firm needed. */
import { revalidatePath } from 'next/cache';
import { fxImportRows } from '@wise/core/bank/fin-parity';
import { audit, deleteFxList, saveFxList } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { bankError, isDate, num, str } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/bank-form';
import type { Cell } from '@/components/parity-fin/export-bar';
import type { ImportResult } from '@/components/parity-fin/table-import';

export async function saveFxAction(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const u = await requireCan('fxSave');
    const date = str(form.get('date'));
    if (!isDate(date)) return { error: 'Внесете датум.' };
    const curs = form.getAll('cur').map(String);
    const rates = form.getAll('rate');
    const rows = curs.map((cur, i) => ({ cur, rate: num(rates[i] ?? null) ?? 0 })).filter((r) => r.cur.trim() && r.rate);
    const orig = str(form.get('orig')) || null;
    const n = await db().transaction((tx) => saveFxList(tx, { userId: u.id, date, rows, orig }));
    revalidatePath('/kursna');
    return { ok: `Курсната листа на ${date.split('-').reverse().join('.')} е зачувана за сите фирми (${n} курсеви).` };
  } catch (e) { return bankError(e); }
}

export async function deleteFxAction(date: string): Promise<FormState> {
  try {
    const u = await requireCan('fxDel');
    await db().transaction((tx) => deleteFxList(tx, { userId: u.id, date }));
    revalidatePath('/kursna');
    return { ok: 'Избришано.' };
  } catch (e) { return bankError(e); }
}

/** Excel/CSV import of rates (Датум, Валута, Курс): each date in the file replaces that day's list. */
export async function importFxAction(rows: Cell[][], file: string): Promise<ImportResult> {
  try {
    const u = await requireCan('fxSave');
    const { lists, errors } = fxImportRows(rows);
    if (!lists.length) return { error: errors.length ? errors.slice(0, 3).join(' ') : 'Датотеката нема курсеви (колони Датум, Валута, Курс).' };
    const n = await db().transaction(async (tx) => {
      let k = 0;
      for (const l of lists) k += await saveFxList(tx, { userId: u.id, date: l.date, rows: l.rows });
      await audit(tx, { userId: u.id, firmId: null, action: 'fxImport', entityType: 'fx_rates', data: { file, dates: lists.map((l) => l.date), rates: k, skipped: errors.length } });
      return k;
    });
    revalidatePath('/kursna');
    return { ok: `Увезени ${n} курсеви во ${lists.length} листи${errors.length ? ` · прескокнати ${errors.length} реда (${errors.slice(0, 2).join(' ')})` : ''}.` };
  } catch (e) { const r = bankError(e); return { error: r.error ?? 'Увозот не успеа.' }; }
}
