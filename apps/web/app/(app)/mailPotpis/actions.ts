'use server';
import { revalidatePath } from 'next/cache';
import { APP_SETTING_MAIL_SIG, MS_DISC, type MailSig } from '@wise/core/firms/mailsig';
import { appSettings, audit } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fv, officeError, officeGlobal } from '@/lib/office';

/** Legacy `msSave` (12127 → 12165: one signature for all users and messages, stored with the office settings). */
export async function saveMailSig(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    const cut = (k: string, n = 200) => (fv(f, k) ?? '').slice(0, n);
    const v: MailSig = {
      greet: cut('greet') || 'Со почит,', name: cut('name'), title: cut('title'), office: cut('office'), phone: cut('phone'), email: cut('email'),
      disc: f.get('disc') === 'on', discText: f.get('reset') === '1' ? MS_DISC : (cut('discText', 3000) || MS_DISC),
    };
    await db().transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: APP_SETTING_MAIL_SIG, value: v, updatedBy: u.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedBy: u.id } });
      await audit(tx, { userId: u.id, action: 'msSave', entityType: 'app_settings', entityId: APP_SETTING_MAIL_SIG, data: { name: v.name, disc: v.disc } });
    });
    revalidatePath('/mailPotpis');
    return { ok: 'Потписот е зачуван за сите пораки.' };
  } catch (e) { return officeError(e); }
}
