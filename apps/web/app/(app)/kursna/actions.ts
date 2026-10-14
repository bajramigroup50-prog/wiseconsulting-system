'use server';
/** Legacy ACT `fxSave` / `fxDel` (need `settings`) — office-wide rate list, no firm needed. */
import { revalidatePath } from 'next/cache';
import { fxRate, fxRateSource } from '@wise/core';
import { fxImportRows } from '@wise/core/bank/fin-parity';
import { NBRM_MAX_DAYS } from '@wise/core/bank/nbrm';
import { daysBetween } from '@wise/core/office';
import { audit, deleteFxList, loadFxSources, runNbrm, saveFxList } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { bankError, isDate, num, str } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/bank-form';
import type { Cell } from '@/components/parity-fin/export-bar';
import type { ImportResult } from '@/components/parity-fin/table-import';

export async function saveFxAction(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const u = await requireCan('fxSave');
    const date = str(form.get('date'));
    if (!isDate(date)) return { error: 'Изберете датум.' };
    const curs = form.getAll('cur').map(String);
    const rates = form.getAll('rate');
    const rows = curs.map((cur, i) => ({ cur, rate: num(rates[i] ?? null) ?? 0 })).filter((r) => r.cur.trim() && r.rate);
    if (!rows.some((r) => r.rate > 0)) return { error: 'Внесете барем еден курс.' };
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

/**
 * „⬇ Преземи од НБРМ“: the official middle rates of `[from, to]` (backfill on demand; the worker `nbrm.rates` fetches
 * the last days three times a day). Manual rates of the same day stay.
 */
export async function nbrmFetchAction(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const u = await requireCan('fxSave');
    const from = str(form.get('from')), to = str(form.get('to'));
    if (!isDate(from) || !isDate(to) || from > to) return { error: 'Изберете период (од – до).' };
    if (daysBetween(from, to) > NBRM_MAX_DAYS) return { error: 'Најмногу две години одеднаш.' };
    let r;
    try { r = await runNbrm(db(), { from, to, userId: u.id }); } catch (e) { return { error: `НБРМ не одговори: ${(e as Error).message}. Обидете се подоцна или внесете ја листата рачно.` }; }
    revalidatePath('/kursna');
    const d = (x: string) => x.split('-').reverse().join('.');
    return { ok: `Преземени ${r.saved} курсеви за ${r.dates} дена од НБРМ (${d(from)}–${d(to)})${r.skippedManual ? ` · рачно внесените (${r.skippedManual}) се задржани` : ''}.` };
  } catch (e) { return bankError(e); }
}

/**
 * The default rate of a foreign-currency document (invoice, import purchase): the firm's currency codebook → the office
 * list (NBRM / manual, the last list on or before the date) → the built-in default.
 */
export async function fxDefaultRate(cur: string, date: string): Promise<{ rate: number; src: string }> {
  const u = await requireUser();
  const c = String(cur ?? '').toUpperCase().slice(0, 3);
  if (!c || c === 'MKD' || !isDate(String(date ?? ''))) return { rate: 1, src: '' };
  const S = await loadFxSources(db(), (await currentFirm(u))?.id ?? null);
  return { rate: fxRate(c, date, S), src: fxRateSource(c, date, S) };
}
