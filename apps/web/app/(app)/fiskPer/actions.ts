'use server';
/**
 * Фискални извештаи — legacy `fkPost` / `fkIssue` for a read report (all days at once), `posFee` (13078),
 * `devSave` / `devDel` (11536), DFI control options (11530). Every action: `requireCan` via `stockAction`, one
 * transaction, audit row.
 */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fiskAfterRead, fiskFinish } from '@wise/core/ai/fisk';
import { bookPosFee, postFiskRead, saveDfiOptions, saveFiscalDevice, type FiscalDevice } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { loadAiResult, markAiReadsSaved } from '@/lib/ai';
import { firmAction } from '@/lib/books';
import { stockAction, todayIso } from '@/lib/stock';

const P = ['/fiskPer', '/kdfi', '/m_trg', '/kasa'];
const num = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const str = (v: FormDataEntryValue | null) => String(v ?? '').trim();

const PostIn = z.object({
  ai: z.string().uuid(), wh: z.string().max(40).nullish(), nonVat: z.boolean(), sum: z.boolean(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')),
  mg: z.enum(['spread', 'one']).optional(), sc: z.enum(['trg', 'usl', 'trgNoVat']), rev: z.string().max(12).nullish(), cashK: z.string().max(12).nullish(), cardK: z.string().max(12).nullish(),
  issue: z.boolean().optional(), meth: z.enum(['fifo', 'lifo', 'prop']).optional(),
});

/** „✓ Прокнижи го прометот“ (+ „📦 Направи излез на стока“) for the whole read. */
export async function postReadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const v = PostIn.safeParse(raw);
  if (!v.success) return { error: v.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const x = v.data;
  const { firm } = await firmAction('fkPost');
  const doc = await loadAiResult(firm.id, x.ai, 'fisk');
  if (!doc) return { error: 'Прочитаниот извештај не е пронајден.' };
  const today = todayIso();
  const read = fiskFinish(fiskAfterRead(doc.result), today);
  const st = await stockAction('fkPost', P, async (tx, a) => {
    const r = await postFiskRead(tx, a, { ...x, date: x.date || null, read, today, fileId: doc.fileId ?? null });
    await markAiReadsSaved(tx, a.firmId, [doc.id]);
    return r;
  });
  if (st.error) return st;
  const r = st.data!;
  redirect(`/fiskPer?posted=${r.ids.length}&tot=${r.total}&iss=${r.issued}`);
}

/** „Книжи провизија 4460“. */
export async function posFeeAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const st = await stockAction('posFee', ['/fiskPer', '/banka'], (tx, a) => bookPosFee(tx, a, { amount: num(form.get('amount')), date: str(form.get('date')) }));
  return st.error ? st : { ok: `Провизијата ${num(form.get('amount')).toFixed(2)} е прокнижена (4460).` };
}

/** „Зачувај“ of a fiscal device (index −1 = new). */
export async function devSaveAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const g = (k: string) => str(form.get(k));
  const d: FiscalDevice = {
    serial: g('serial'), wh: g('wh'), brand: g('brand'), model: g('model'), conn: g('conn') as FiscalDevice['conn'], port: g('port'), baud: g('baud'), ip: g('ip'), op: g('op'),
    mode: g('mode') as FiscalDevice['mode'], fisc: g('fisc'), servicer: g('servicer'), last: g('last'), next: g('next'),
  };
  const st = await stockAction('devSave', ['/fiskPer'], (tx, a) => saveFiscalDevice(tx, a, Number(form.get('i') ?? -1), d));
  if (st.error) return st;
  redirect('/fiskPer?tab=dev');
}
export async function devDelAction(i: number): Promise<ActionState> {
  return stockAction('del', ['/fiskPer'], (tx, a) => saveFiscalDevice(tx, a, i, null));
}

/** DFI control options: non-working days, cash maximum, deposit days. */
export async function dfiOptAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const off = str(form.get('offDays'));
  const st = await stockAction('dfiOpt', ['/fiskPer'], (tx, a) => saveDfiOptions(tx, a, {
    offDays: ['0', '0,6', ''].includes(off) ? off : '0', cashMax: num(form.get('cashMax')), depDays: num(form.get('depDays')) || 3,
  }));
  return st.error ? st : { ok: 'Зачувано.' };
}
