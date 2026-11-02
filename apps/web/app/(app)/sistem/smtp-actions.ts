'use server';
/**
 * „✉ Е-пошта на програмата“ (Систем, administrator): the Gmail login the program sends with – a Gmail with 2-step
 * verification needs an app password (app setting `smtp`, read by the worker every minute; never shown back) – and
 * „↻ Испрати повторно неуспешните“: the failed e-mails of the last 7 days are queued again (the worker sends them).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, gt, sql } from 'drizzle-orm';
import { appSettings, audit, mailLog } from '@wise/db';
import { Forbidden, requireUser } from '@/lib/auth';
import { refuseDemo } from '@/lib/demo';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function saveSmtpAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    await refuseDemo(u, 'smtpSave');
    if (u.role !== 'admin') throw new Forbidden('smtpSave');
    const user = String(form.get('user') ?? '').trim();
    const pass = String(form.get('pass') ?? '').replace(/\s+/g, '');
    if (user && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return { error: 'Внесете ја е-поштата (на пр. bajramigroup50@gmail.com).' };
    if (!pass) return { error: 'Внесете ја лозинката за апликација (16 букви од Google).' };
    await db().transaction(async (tx) => {
      const v = { ...(user ? { user } : {}), pass, at: new Date().toISOString(), by: u.name };
      await tx.insert(appSettings).values({ key: 'smtp', value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
      await audit(tx, { userId: u.id, firmId: null, action: 'smtpSave', entityType: 'app_settings', data: { user: user || null } });
    });
    revalidatePath('/sistem');
    return { ok: 'Зачувано. Програмата ја користи новата лозинка за една минута – потоа притиснете „↻ Испрати повторно неуспешните“.' };
  } catch (e) { return actionError(e); }
}

export async function resendFailedMailAction(): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (u.role !== 'admin') throw new Forbidden('mailResend');
    const n = await db().transaction(async (tx) => {
      const R = await tx.update(mailLog).set({ status: 'queued', attempts: 0, error: null })
        .where(and(eq(mailLog.status, 'failed'), gt(mailLog.createdAt, sql`now() - interval '7 days'`))).returning({ id: mailLog.id });
      await audit(tx, { userId: u.id, firmId: null, action: 'mailResend', entityType: 'mail_log', data: { n: R.length } });
      return R.length;
    });
    revalidatePath('/sistem');
    return { ok: n ? `${n} е-пораки се повторно во ред за праќање – се праќаат за неколку минути (Историја на е-пошта).` : 'Нема неуспешни е-пораки во последните 7 дена.' };
  } catch (e) { return actionError(e); }
}
