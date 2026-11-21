'use server';
/** „💧 Паричен тек – прогноза“: the manual one-off items and the minimum balance, saved on the firm (`settings.cf`). */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { audit, firms } from '@wise/db';
import { firmAction, actionError, type ActionState } from '@/lib/books';
import { cfSettings, type CfSettings } from '@/lib/cashflow';
import { db } from '@/lib/db';

const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/[\s.]/g, '').replace(',', '.'));

async function save(change: (s: CfSettings) => CfSettings, what: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    if (u.role === 'klient') return { error: 'Порталот е само за преглед.' };
    const next = change(cfSettings(firm));
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify({ cf: next })}::jsonb` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'cfSave', entityType: 'firm', entityId: firm.id, data: { what, manual: next.manual?.length ?? 0, min: next.min ?? 0 } });
    });
    revalidatePath('/paricenTek');
    return { ok: 'Зачувано.' };
  } catch (e) { return actionError(e); }
}

export async function addManualAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const date = String(form.get('date') ?? '');
  const amt = num(form.get('amount'));
  const label = String(form.get('label') ?? '').trim().slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Внесете датум.' };
  if (!(amt > 0)) return { error: 'Внесете износ поголем од 0.' };
  const sign = form.get('dir') === 'in' ? 1 : -1;
  return save((s) => ({ ...s, manual: [...(s.manual ?? []), { id: randomUUID(), date, amount: sign * Math.round(amt * 100) / 100, label: label || (sign > 0 ? 'Прилив' : 'Одлив') }].slice(-200) }), 'add');
}

export async function delManualAction(id: string): Promise<ActionState> {
  return save((s) => ({ ...s, manual: (s.manual ?? []).filter((m) => m.id !== id) }), 'del');
}

export async function saveMinAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = num(form.get('min'));
  if (!(v >= 0)) return { error: 'Неважечки износ.' };
  return save((s) => ({ ...s, min: Math.round(v) }), 'min');
}
