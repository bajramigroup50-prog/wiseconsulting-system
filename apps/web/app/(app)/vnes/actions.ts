'use server';
/**
 * /vnes „📨 Побарај од клиентот“ → „Во Автопилот“: the (edited) message is proposed under Автопилот › Пораки до
 * клиенти (type `vnes`), where it is sent to the portal / e-mail like the autopilot's own messages.
 */
import { revalidatePath } from 'next/cache';
import { vnesMessageKey } from '@wise/core/office/vnes-request';
import { audit, autopilotMessages } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function queueVnesRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const subject = String(fd.get('subject') ?? '').trim().slice(0, 300);
    const body = String(fd.get('body') ?? '').trim().slice(0, 20000);
    if (!subject || !body) return { error: 'Пораката е празна.' };
    const key = vnesMessageKey(firm.id, new Date().toISOString().slice(0, 10), [body]);
    await db().transaction(async (tx) => {
      await tx.insert(autopilotMessages).values({ key, firmId: firm.id, type: 'vnes', subject, body })
        .onConflictDoUpdate({ target: autopilotMessages.key, set: { subject, body, status: 'proposed' } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'vnesRequest', entityType: 'autopilot_message', data: { key } });
    });
    revalidatePath('/autop');
    return { ok: 'Пораката е во Автопилот › Пораки до клиенти – таму испратете ја (портал + е-пошта).' };
  } catch (e) { return actionError(e); }
}
