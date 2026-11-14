'use server';
/**
 * „✉ Е-пошта → WISE“ (the office mailbox read into „📥 Пристигнати документи“): save the connection, test it, read now,
 * read again from the start. Owner of the office only; never for a demo user. The password is sealed, never returned.
 */
import { revalidatePath } from 'next/cache';
import { MAILIN_JOB } from '@wise/core/office';
import { mailInForget, mailInRestart, MailInError, saveMailIn } from '@wise/db';
import { requireUser, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isOfficeOwner } from '@/lib/office-owner';
import type { ActionState } from '@/lib/books';

async function owner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.principal.demo || !(await isOfficeOwner(u))) throw new MailInError('Само сопственикот на канцеларијата го поставува сандачето.');
  return u;
}
const err = (e: unknown): ActionState => ({ error: e instanceof MailInError ? e.message : 'Не успеа – обидете се повторно.' });

export async function saveMailInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await owner();
    await db().transaction((tx) => saveMailIn(tx, {
      on: fd.get('on') === 'on', host: String(fd.get('host') ?? ''), port: Number(fd.get('port')) || 993, user: String(fd.get('user') ?? ''),
      pass: String(fd.get('pass') ?? '') || null, folder: String(fd.get('folder') ?? 'INBOX'), days: Number(fd.get('days')) || null, forwarders: String(fd.get('forwarders') ?? ''),
    }, u.id));
    if (fd.get('on') === 'on') await enqueue(MAILIN_JOB, { test: true });
    revalidatePath('/prist');
    return { ok: fd.get('on') === 'on' ? 'Зачувано. Врската се проверува – резултатот е подолу за неколку секунди.' : 'Зачувано (исклучено).' };
  } catch (e) { return err(e); }
}

/** test = only connect and count; now = read the new mails right away (otherwise every 10 minutes). */
export async function runMailInAction(what: 'test' | 'now' | 'restart'): Promise<ActionState> {
  try {
    const u = await owner();
    if (what === 'restart') await db().transaction((tx) => mailInRestart(tx, u.id));
    await enqueue(MAILIN_JOB, what === 'test' ? { test: true } : { now: true });
    revalidatePath('/prist');
    return { ok: what === 'test' ? 'Се проверува…' : 'Се читаат пораките…' };
  } catch (e) { return err(e); }
}

export async function forgetSenderAction(addr: string): Promise<ActionState> {
  try {
    const u = await owner();
    await db().transaction((tx) => mailInForget(tx, addr, u.id));
    revalidatePath('/prist');
    return { ok: 'Испраќачот е заборавен.' };
  } catch (e) { return err(e); }
}
