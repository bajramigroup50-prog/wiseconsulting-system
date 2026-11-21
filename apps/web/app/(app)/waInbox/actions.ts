'use server';
/** 💬 WhatsApp conversations: give an unknown number to a firm (its messages and files move, the phone is remembered). */
import { revalidatePath } from 'next/cache';
import { can } from '@wise/core';
import { waAssign, WaError } from '@wise/db';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';

export async function waAssignAction(phone: string, _p: RowResult, f: FormData): Promise<RowResult> {
  const u = await requireUser();
  if (isDemoUser(u)) return { error: DEMO_OFF_MSG };
  const firmId = String(f.get('firmId') ?? '');
  if (!isUuid(firmId)) return { error: 'Изберете фирма.' };
  if (!can(u.principal, 'office') || !can(u.principal, 'write', firmId)) return { error: 'Немате право.' };
  try {
    const n = await db().transaction((tx) => waAssign(tx, { phone, firmId, userId: u.id }));
    revalidatePath('/waInbox');
    return { ok: `✓ ${n} пораки се префрлени; следните од овој број одат директно во фирмата.` };
  } catch (e) {
    return { error: e instanceof WaError ? e.message : (e as Error).message };
  }
}
