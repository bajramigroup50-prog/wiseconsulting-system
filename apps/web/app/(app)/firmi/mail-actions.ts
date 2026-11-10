'use server';
/** „✉ Е-пошта на фирмата“: the firm's own mailbox its invoices are sent from (`@wise/db` firm-mail). */
import { revalidatePath } from 'next/cache';
import { clearFirmMailbox, FirmMailError, saveFirmMailbox } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { requireCan } from '@/lib/auth';
import { refuseDemo } from '@/lib/demo';
import { db } from '@/lib/db';

export async function saveFirmMailAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const firmId = String(f.get('firmId') ?? '');
    const u = await requireCan('saveFirm', firmId);
    await refuseDemo(u, 'firmMailSave');
    await db().transaction((tx) => saveFirmMailbox(tx, {
      firmId, userId: u.id, by: u.name, user: String(f.get('user') ?? ''), pass: String(f.get('pass') ?? '').replace(/\s+/g, ''),
      host: String(f.get('host') ?? ''), port: Number(f.get('port')) || undefined,
    }));
    revalidatePath('/firmi');
    return { ok: 'Зачувано. Фактурите на фирмата сега се праќаат од нејзината е-пошта.' };
  } catch (e) {
    if (e instanceof FirmMailError) return { error: e.message };
    return actionError(e);
  }
}

export async function clearFirmMailAction(firmId: string): Promise<ActionState> {
  try {
    const u = await requireCan('saveFirm', firmId);
    await refuseDemo(u, 'firmMailDel');
    await db().transaction((tx) => clearFirmMailbox(tx, { firmId, userId: u.id }));
    revalidatePath('/firmi');
    return { ok: 'Отстрането – фактурите одат од е-поштата на програмата (во име на фирмата).' };
  } catch (e) { return actionError(e); }
}
