'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { r2 } from '@wise/core';
import { firstLastWorkingDay, isRecEvery, type RecItem } from '@wise/core/office';
import { audit, issueDueRecurring, partners, recurringInvoices } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, officeAction, officeError, today } from '@/lib/office';

/**
 * Legacy `recSave` / `recNew` (10184 → 13581). Needs `office` (not just `write`) so a client can't create or run
 * recurring invoices for its firm (legacy: `recRun` / `rbSave` were reachable by clients — FIX #1).
 */
export async function saveRecurring(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const id = fv(f, 'id');
    const partnerId = fv(f, 'partnerId');
    if (!isUuid(partnerId)) return { error: 'Изберете купувач.' };
    const [p] = await db().select({ id: partners.id }).from(partners).where(and(eq(partners.id, partnerId), eq(partners.firmId, firm.id))).limit(1);
    if (!p) return { error: 'Купувачот не е од оваа фирма.' };
    const every = fv(f, 'every');
    if (!isRecEvery(every)) return { error: 'Изберете период.' };
    const dayS = fv(f, 'day') ?? '1';
    const day = dayS === 'L' ? 'L' : String(Math.min(31, Math.max(1, Math.round(Number(dayS)) || 1)));
    const items: RecItem[] = [];
    for (let i = 0; i < 5; i++) {
      const name = fv(f, `it${i}_name`);
      if (!name) continue;
      items.push({ name, qty: r2(Number(fv(f, `it${i}_qty`)?.replace(',', '.')) || 1), price: r2(Number(fv(f, `it${i}_price`)?.replace(',', '.')) || 0), vat: Number(fv(f, `it${i}_vat`)) || 0, unit: fv(f, `it${i}_unit`) ?? undefined });
    }
    if (!items.length) return { error: 'Внесете барем една ставка.' };
    const next = fdate(f, 'next') ?? (day === 'L' ? firstLastWorkingDay(today()) : today());
    const v = {
      partnerId, every, day, next, end: fdate(f, 'end'), dueDays: Math.max(0, Math.round(Number(fv(f, 'dueDays')) || 0)), items,
      note: fv(f, 'note'), active: f.get('active') === 'on', mail: f.get('mail') === 'on',
    };
    await db().transaction(async (tx) => {
      if (id) {
        const r = await tx.update(recurringInvoices).set(v).where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.firmId, firm.id))).returning({ id: recurringInvoices.id });
        if (!r.length) throw new Error('Не постои.');
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'recSave', entityType: 'recurring_invoice', entityId: id, data: { next, every, day } });
      } else {
        const [r] = await tx.insert(recurringInvoices).values({ ...v, firmId: firm.id, createdBy: u.id }).returning({ id: recurringInvoices.id });
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'recNew', entityType: 'recurring_invoice', entityId: r!.id, data: { next, every, day } });
      }
    });
    revalidatePath('/periodicni');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

export async function deleteRecurring(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const r = await tx.delete(recurringInvoices).where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.firmId, firm.id))).returning({ id: recurringInvoices.id });
      if (r.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'recX', entityType: 'recurring_invoice', entityId: id });
    });
    revalidatePath('/periodicni');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `recRun`: issue the firm's due definitions now (the worker does it every morning). */
export async function runRecurring(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const r = await issueDueRecurring(db(), { firmId: firm.id, userId: u.id });
    revalidatePath('/periodicni');
    return { ok: r.issued ? `Издадени ${r.issued} фактури (нацрт).` : 'Нема фактури за издавање денес.' };
  } catch (e) { return officeError(e); }
}
