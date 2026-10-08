'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { r2 } from '@wise/core';
import { audit, contractNumber, firms, nextOfficeNumber, serviceContracts } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fnum, fv, officeAction, officeError, today } from '@/lib/office';

/**
 * Legacy `kdNew` / `kdSaveB` (10334, 13613). FIX(#8): the number comes from an atomic per-year counter in the
 * same transaction (legacy `kdNextNo` raced and fell back to `length + 1`, giving duplicates).
 */
export async function saveContract(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const date = fdate(f, 'date') ?? today();
    const fee = r2(fnum(f, 'fee'));
    const data = { svc: fv(f, 'svc'), place: fv(f, 'place'), payDay: fv(f, 'payDay'), rep: fv(f, 'rep'), repRole: fv(f, 'repRole'), note: fv(f, 'note'), feeEmp: r2(fnum(f, 'feeEmp')) };
    let number = '';
    await db().transaction(async (tx) => {
      number = contractNumber(await nextOfficeNumber(tx, 'kdog', Number(date.slice(0, 4))), Number(date.slice(0, 4)));
      const [c] = await tx.insert(serviceContracts).values({ firmId: firm.id, number, date, start: fdate(f, 'start') ?? date, end: fdate(f, 'end'), fee: String(fee), data, createdBy: u.id })
        .returning({ id: serviceContracts.id });
      // Legacy `kdIndex`: a summary on the firm (`firm.kdog`) — merged into settings, not overwritten.
      const kd = JSON.stringify({ id: c!.id, no: number, date, fee, st: 'draft' });
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('kdog', ${kd}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdSaveB', entityType: 'service_contract', entityId: c!.id, data: { number, fee } });
    });
    revalidatePath('/kdogovori');
    return { ok: `Договор ${number} е зачуван.` };
  } catch (e) { return officeError(e); }
}

export async function setContractStatus(id: string, status: 'draft' | 'signed' | 'ended'): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const r = await tx.update(serviceContracts).set({ status }).where(and(eq(serviceContracts.id, id), eq(serviceContracts.firmId, firm.id))).returning({ id: serviceContracts.id });
      if (r.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdSign', entityType: 'service_contract', entityId: id, data: { status } });
    });
    revalidatePath('/kdogovori');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}
