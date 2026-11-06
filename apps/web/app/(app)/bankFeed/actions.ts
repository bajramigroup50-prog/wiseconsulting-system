'use server';
/**
 * „🏦 Изводи од банка“ — approve / reject / pick the firm of a fetched statement (office staff who may write in the
 * firm), and the connections + the SSH key (office OWNER only).
 */
import { revalidatePath } from 'next/cache';
import { can } from '@wise/core';
import {
  BANKFEED_JOB, deleteFeed, ensureFeedKey, feedApprove, FeedError, feedPrinted, feedReject, feedSetFirm, saveFeed, type BankFeedMethod, type Tx,
} from '@wise/db';
import { incomingDocs } from '@wise/db';
import { eq } from 'drizzle-orm';
import { requireUser, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid } from '@/lib/office';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import type { RowResult } from '@/components/row-action';

const fail = (e: unknown): RowResult => ({ error: (e as Error).message || 'Грешка.' });

async function staff(): Promise<SessionUser> {
  const u = await requireUser();
  if (['klient', 'teren', 'view'].includes(u.role) || u.demo) throw new FeedError('Немате пристап.');
  return u;
}
async function owner(): Promise<SessionUser> {
  const u = await staff();
  if (!(await isOfficeOwner(u))) throw new FeedError(OWNER_ONLY_MSG);
  return u;
}
async function firmOfDoc(id: string): Promise<string | null> {
  const [r] = await db().select({ firmId: incomingDocs.firmId }).from(incomingDocs).where(eq(incomingDocs.id, id)).limit(1);
  return r?.firmId ?? null;
}
async function mayWrite(u: SessionUser, firmId: string | null): Promise<void> {
  if (!firmId) throw new FeedError('Прво изберете фирма за изводот.');
  if (!can(u.principal, 'write', firmId)) throw new FeedError('Немате право за книжење во оваа фирма.');
}

const done = () => revalidatePath('/bankFeed');

/** „✓ Одобри и прокнижи“ for one or several statements. */
export async function approveFeedAction(ids: string[]): Promise<RowResult> {
  try {
    const u = await staff();
    const L = ids.filter(isUuid);
    if (!L.length) return { error: 'Штиклирајте изводи.' };
    const out: string[] = [];
    let ok = 0;
    for (const id of L) {
      await mayWrite(u, await firmOfDoc(id));
      const r = await db().transaction((tx) => feedApprove(tx as unknown as Tx, id, u.id));
      if (r.status === 'done') ok++; else out.push(r.result);
    }
    done();
    return out.length ? { error: `Прокнижени ${ok}. ${out.join(' ')}` } : { ok: `✓ Прокнижени ${ok} извод(и).` };
  } catch (e) { return fail(e); }
}

export async function rejectFeedAction(id: string): Promise<RowResult> {
  try {
    const u = await staff();
    const f = await firmOfDoc(id);
    if (f) await mayWrite(u, f);
    await db().transaction((tx) => feedReject(tx as unknown as Tx, id, u.id));
    done();
    return { ok: 'Отфрлен.' };
  } catch (e) { return fail(e); }
}

export async function setFeedFirmAction(_p: RowResult, form: FormData): Promise<RowResult> {
  try {
    const u = await staff();
    const id = String(form.get('id') ?? ''), firmId = String(form.get('firmId') ?? '');
    if (!isUuid(id) || !isUuid(firmId)) return { error: 'Изберете фирма.' };
    await mayWrite(u, firmId);
    await db().transaction((tx) => feedSetFirm(tx as unknown as Tx, id, firmId, u.id));
    done();
    return { ok: 'Фирмата е избрана.' };
  } catch (e) { return fail(e); }
}

/** The print page marks what was printed. */
export async function markPrintedAction(ids: string[]): Promise<void> {
  await staff();
  await db().transaction((tx) => feedPrinted(tx as unknown as Tx, ids.filter(isUuid)));
}

/* ------------------------------------------------------------------ owner: connections, key */

export async function saveFeedAction(_p: RowResult, form: FormData): Promise<RowResult> {
  try {
    const u = await owner();
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const id = g('id');
    await db().transaction((tx) => saveFeed(tx as unknown as Tx, {
      id: isUuid(id) ? id : null, name: g('name'), bank: g('bank'), method: (g('method') || 'sftp') as BankFeedMethod, host: g('host'),
      port: Number(g('port')) || null, username: g('username'), path: g('path'), pattern: g('pattern'), password: g('password') || null,
      clearPassword: form.get('clearPassword') === 'on', hold: form.get('auto') !== 'on', at: g('at'), active: form.get('active') !== 'off',
    }, u.id));
    done();
    return { ok: '✓ Врската е зачувана.' };
  } catch (e) { return fail(e); }
}

export async function deleteFeedAction(id: string): Promise<RowResult> {
  try {
    const u = await owner();
    await db().transaction((tx) => deleteFeed(tx as unknown as Tx, id, u.id));
    done();
    return { ok: 'Избришана.' };
  } catch (e) { return fail(e); }
}

/** „Тест на врската“ / „Преземи сега“ – the worker connects (from the server's IP) and writes the result. */
export async function runFeedAction(id: string, test: boolean): Promise<RowResult> {
  try {
    await owner();
    if (!isUuid(id)) return { error: 'Непозната врска.' };
    await enqueue(BANKFEED_JOB, { feedId: id, test });
    return { ok: test ? 'Тестот е пуштен – освежете ја страницата за 20–30 секунди.' : 'Преземањето е пуштено – освежете ја страницата за минута.' };
  } catch (e) { return fail(e); }
}

export async function makeKeyAction(renew: boolean): Promise<RowResult> {
  try {
    const u = await owner();
    await db().transaction((tx) => ensureFeedKey(tx as unknown as Tx, u.id, renew));
    done();
    return { ok: renew ? 'Нов клуч – испратете го новиот јавен клуч до банката.' : 'Клучот е направен.' };
  } catch (e) { return fail(e); }
}
