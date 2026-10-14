'use server';
/**
 * „🧾 Месечна фактура за сметководствени услуги“ actions — the office OWNER's only (`kdOwnerAction`), like the
 * contracts: issue the month's invoices (booked in the office firm, audited per client), deliver them (worker
 * `fee.deliver`: PDF to the client portal + e-mail), a reminder on demand, and the settings (`office.feeInv`).
 */
import { revalidatePath } from 'next/cache';
import type { FeeSettings } from '@wise/core/firms/kdfee';
import { audit, FEE_DELIVER_JOB, feeInvoices, issueFeeInvoices, patchOfficeProfile, runFeeReminders } from '@wise/db';
import { eq } from 'drizzle-orm';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { dispatchMail } from '@/lib/mail';
import { isUuid, officeError, today } from '@/lib/office';
import { kdOwnerAction } from '../kdogovori/lib';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const D = /^\d{4}-\d{2}-\d{2}$/;

async function deliver(ids: readonly string[]): Promise<number> {
  let failed = 0;
  for (const feeId of ids) { try { await enqueue(FEE_DELIVER_JOB, { feeId }); } catch { failed++; } }
  return failed;
}

export async function issueFeeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    const ym = String(f.get('ym') ?? '');
    const date = String(f.get('date') ?? '') || today();
    if (!YM.test(ym)) return { error: 'Изберете месец.' };
    if (!D.test(date)) return { error: 'Внесете датум на фактурите.' };
    const only = f.getAll('only').map(String).filter(isUuid);
    if (!only.length) return { error: 'Означете барем еден клиент.' };
    const r = await issueFeeInvoices(db(), { ym, date, userId: u.id, role: u.role, only, includeRecurring: true, source: 'manual' });
    const failed = await deliver(r.issued.map((x) => x.feeId));
    revalidatePath('/kdfakturi');
    const err = r.errors.length ? ` · не се издадени ${r.errors.length}: ${r.errors.slice(0, 3).map((e) => `${e.name} – ${e.error}`).join('; ')}` : '';
    if (!r.issued.length) return { error: `Не е издадена ниту една фактура${err || ' (веќе се издадени за овој месец)'}.` };
    return { ok: `Издадени и прокнижени ${r.issued.length} фактури (${r.issued[0]!.number}${r.issued.length > 1 ? ' … ' + r.issued[r.issued.length - 1]!.number : ''})${failed ? ' · испраќањето чека (редот е недостапен)' : ' · PDF во порталот и по е-пошта'}${err}.` };
  } catch (e) { return officeError(e); }
}

/** „✉ Потсетник“ — a polite reminder now (portal + e-mail), outside the automatic schedule. */
export async function remindFeeAction(id: string): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    if (!isUuid(id)) return { error: 'Фактурата не постои.' };
    const r = await runFeeReminders(db(), { mail: true, userId: u.id, only: [id], force: true });
    if (r.mailIds.length) await dispatchMail(r.mailIds);
    revalidatePath('/kdfakturi');
    return r.sent ? { ok: 'Потсетникот е испратен.' } : { error: 'Фактурата е платена или нема канал (портал / е-пошта).' };
  } catch (e) { return officeError(e); }
}

/** „↻ Испрати пак“ — the PDF again to the portal / by e-mail. */
export async function redeliverFeeAction(id: string): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    if (!isUuid(id)) return { error: 'Фактурата не постои.' };
    const [f] = await db().select({ id: feeInvoices.id, officeFirmId: feeInvoices.officeFirmId, number: feeInvoices.number }).from(feeInvoices).where(eq(feeInvoices.id, id)).limit(1);
    if (!f) return { error: 'Фактурата не постои.' };
    await audit(db(), { userId: u.id, firmId: f.officeFirmId, action: 'feeDeliver', entityType: 'fee_invoice', entityId: f.id, data: { number: f.number } });
    const failed = await deliver([f.id]);
    return failed ? { error: 'Редот за испраќање е недостапен – обидете се повторно.' } : { ok: 'Се испраќа (портал / е-пошта).' };
  } catch (e) { return officeError(e); }
}

export async function saveFeeSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await kdOwnerAction();
    const n = (k: string, d: number, lo: number, hi: number) => { const v = Math.round(Number(f.get(k))); return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : d; };
    const day = String(f.get('day') ?? 'L');
    const feeInv: FeeSettings = {
      day: day === 'L' ? 'L' : n('day', 28, 1, 28), auto: f.get('auto') === 'on', mail: f.get('mail') === 'on', portal: f.get('portal') === 'on',
      remind: { on: f.get('rOn') === 'on', days: n('rDays', 10, 1, 120), every: n('rEvery', 15, 1, 120), max: n('rMax', 3, 1, 10) },
    };
    await db().transaction(async (tx) => {
      await patchOfficeProfile(tx, { feeInv }, u.id);
      await audit(tx, { userId: u.id, firmId: null, action: 'feeSettings', entityType: 'app_settings', entityId: 'office', data: { ...feeInv } });
    });
    revalidatePath('/kdfakturi');
    return { ok: 'Поставките се зачувани.' };
  } catch (e) { return officeError(e); }
}
