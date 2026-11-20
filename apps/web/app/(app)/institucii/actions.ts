'use server';
/**
 * „🏛 Институции – барања и плаќања“ — server actions. The firm of an item comes from the form / the stored row (the
 * screen lists all the user's firms) and is checked with `requireCan('office', firmId)`; services in `@wise/db`
 * (`institutions.ts`), every change audited. After a change the firm's deadline calendar row is refreshed.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import {
  applyInstReads, deleteInstItem, INST_FILE_ENTITY, instItems, matchInstPayments, rokWindow, saveInstItem, setInstStatus, startInstReads, syncRokovi,
} from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchAiReads } from '@/lib/ai';
import { fdate, fv, isUuid, linkFiles, officeError, today } from '@/lib/office';

const P = '/institucii';

async function firmOfItem(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [r] = await db().select({ firmId: instItems.firmId }).from(instItems).where(eq(instItems.id, id)).limit(1);
  return r?.firmId ?? null;
}

/** The deadline calendar / reminders follow the item right away (the morning job does it for all firms). */
async function refreshRok(firmId: string) {
  await syncRokovi(db(), { ...rokWindow(today()), firmIds: [firmId] }).catch(() => undefined);
}

const amountOf = (f: FormData): number | null => {
  const s = String(f.get('amount') ?? '').replace(/\s/g, '');
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export async function instSave(_p: ActionState, f: FormData): Promise<ActionState> {
  const prev = fv(f, 'id');
  let id = '', firmId = '';
  let reads: string[] = [];
  try {
    firmId = (prev ? await firmOfItem(prev) : fv(f, 'firmId')) ?? '';
    if (!isUuid(firmId)) return { error: 'Изберете фирма.' };
    const u = await requireCan('office', firmId);
    const assignee = fv(f, 'assigneeId');
    [id, reads] = await db().transaction(async (tx) => {
      const id = await saveInstItem(tx, firmId, {
        id: prev, inst: fv(f, 'inst') ?? '', instName: fv(f, 'instName'), type: fv(f, 'type') ?? '', refNo: fv(f, 'refNo'), docDate: fdate(f, 'docDate'),
        received: fdate(f, 'received'), due: fdate(f, 'due'), subject: fv(f, 'subject'), amount: amountOf(f), payRecip: fv(f, 'payRecip'), payAccount: fv(f, 'payAccount'),
        payUplSm: fv(f, 'payUplSm'), payPrihod: fv(f, 'payPrihod'), payRef: fv(f, 'payRef'), payPurpose: fv(f, 'payPurpose'), status: fv(f, 'status'),
        assigneeId: assignee && isUuid(assignee) ? assignee : null, note: fv(f, 'note'), source: f.getAll('fileIds').some(isUuid) && !prev ? 'upload' : 'manual',
      }, u.id);
      const ids = f.getAll('fileIds').filter(isUuid);
      await linkFiles(tx, ids, firmId, INST_FILE_ENTITY, id);
      // the attached scan is read: institution, number, deadline, amount and payment details fill the blank fields
      const r = f.get('read') === 'off' ? [] : await startInstReads(tx, { firmId, userId: u.id, id, fileIds: ids });
      return [id, r] as const;
    });
  } catch (e) { return officeError(e); }
  await dispatchAiReads(reads);
  await refreshRok(firmId);
  revalidatePath(P);
  if (!prev) redirect(`${P}?id=${id}`);
  return { ok: reads.length ? 'Зачувано. Прикачениот документ се чита – празните полиња ќе се пополнат.' : 'Зачувано.' };
}

export async function instStatus(id: string, status: string, _p?: ActionState, f?: FormData): Promise<ActionState> {
  try {
    const firmId = await firmOfItem(id);
    if (!firmId) return { error: 'Записот не постои.' };
    const u = await requireCan('office', firmId);
    await db().transaction((tx) => setInstStatus(tx, { firmId, id, status, userId: u.id, paidOn: f ? fdate(f, 'paidOn') : null, note: f ? fv(f, 'paidNote') : null }));
    await refreshRok(firmId);
  } catch (e) { return officeError(e); }
  revalidatePath(P);
  return { ok: 'Статусот е променет.' };
}

export async function instDelete(id: string): Promise<ActionState> {
  let firmId: string | null = null;
  try {
    firmId = await firmOfItem(id);
    if (!firmId) return { error: 'Записот не постои.' };
    const u = await requireCan('del', firmId);
    await db().transaction((tx) => deleteInstItem(tx, { firmId: firmId!, id, userId: u.id }));
    await refreshRok(firmId);
  } catch (e) { return officeError(e); }
  revalidatePath(P);
  redirect(P);
}

/** „📎 Прикачи и прочитај“ on an item: more documents (the answer, the receipt…); `read` = read them too. */
export async function instAttach(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  let reads: string[] = [];
  try {
    const firmId = await firmOfItem(id);
    if (!firmId) return { error: 'Записот не постои.' };
    const u = await requireCan('office', firmId);
    const ids = f.getAll('fileIds').filter(isUuid);
    if (!ids.length) return { error: 'Изберете датотека.' };
    reads = await db().transaction(async (tx) => {
      await linkFiles(tx, ids, firmId, INST_FILE_ENTITY, id);
      return f.get('read') === 'on' ? startInstReads(tx, { firmId, userId: u.id, id, fileIds: ids }) : [];
    });
  } catch (e) { return officeError(e); }
  await dispatchAiReads(reads);
  revalidatePath(P);
  return { ok: reads.length ? 'Прикачено – се чита…' : 'Прикачено.' };
}

/** „↻ Провери плаќања“: match the open amounts with the bank statements of the firms (also done every morning). */
export async function instMatchNow(firmIds: string[]): Promise<ActionState> {
  try {
    const ok: string[] = [];
    for (const id of firmIds.filter(isUuid).slice(0, 500)) {
      try { await requireCan('office', id); ok.push(id); } catch { /* not allowed: skipped */ }
    }
    if (!ok.length) return { error: 'Нема фирми.' };
    await applyInstReads(db(), { firmIds: ok });
    const r = await matchInstPayments(db(), { firmIds: ok });
    revalidatePath(P);
    return { ok: r.paid ? `✓ Платени според изводите: ${r.paid} (проверени ${r.checked}).` : `Нема нови плаќања во изводите (проверени ${r.checked}).` };
  } catch (e) { return officeError(e); }
}

