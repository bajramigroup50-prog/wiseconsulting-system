'use server';
/** Legacy `ms_ok` / `ms_reset` (msSave) — the user's own e-mail signature, stored in `app_settings`, audited. */
import { revalidatePath } from 'next/cache';
import { mailSigInput, mailSigKey } from '@wise/core/mailsig';
import { appSettings, audit } from '@wise/db';
import { eq } from 'drizzle-orm';
import { requireCan } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function saveMailSigAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('write');
    const v = mailSigInput(Object.fromEntries(['greet', 'name', 'title', 'office', 'phone', 'email', 'disc', 'discText'].map((k) => [k, form.get(k) ?? ''])));
    await db().transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: mailSigKey(u.id), value: v, updatedBy: u.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedBy: u.id } });
      await audit(tx, { userId: u.id, action: 'msSave', entityType: 'mailsig', entityId: u.id });
    });
    revalidatePath('/mailPotpis');
    return { ok: 'Потписот е зачуван – се додава на сите е-пораки што ги праќате.' };
  } catch (e) { return actionError(e); }
}

export async function resetMailSigAction(): Promise<ActionState> {
  try {
    const u = await requireCan('write');
    await db().transaction(async (tx) => {
      await tx.delete(appSettings).where(eq(appSettings.key, mailSigKey(u.id)));
      await audit(tx, { userId: u.id, action: 'msReset', entityType: 'mailsig', entityId: u.id });
    });
    revalidatePath('/mailPotpis');
    return { ok: 'Потписот е отстранет.' };
  } catch (e) { return actionError(e); }
}
