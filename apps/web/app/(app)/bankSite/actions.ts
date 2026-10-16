'use server';
/**
 * „🏦 Примени за сите фирми“ — the owner's actions: the preview (nothing written), the start of the run (backup
 * confirmation required, the worker job `bank.konta-all` applies the firms one by one) and the progress for the screen.
 */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  audit, BANK_KONTA_ALL_JOB, BULK_STEPS, bankKontaAllBusy, bankKontaAllFirms, bankKontaAllPlan, bankKontaAllRun, putBankKontaAllRun,
  type BankKontaAllRun, type BulkStep, type FirmBulkPlan,
} from '@wise/db';
import { calendarYear } from '@/lib/context';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid } from '@/lib/office';
import { bsOwnerAction, bsYear } from './lib';

const fail = (e: unknown) => ({ error: (e as Error).message || 'Грешка.' });

/** Step 1: what would change in every real firm (demo firms are not listed). */
export async function bankSitePreviewAction(year: number): Promise<{ plans?: (FirmBulkPlan & { error?: string })[]; error?: string }> {
  try {
    await bsOwnerAction();
    return { plans: await bankKontaAllPlan(db(), { year: bsYear(year, calendarYear()) }) };
  } catch (e) { return fail(e); }
}

export interface BankSiteStart { year: number; firmIds: string[]; steps: string[]; backupOk: boolean }

/** Step 2: after the owner confirmed (and confirmed the backup) — queue the run. */
export async function bankSiteStartAction(a: BankSiteStart): Promise<{ ok?: string; error?: string }> {
  try {
    const u = await bsOwnerAction();
    if (!a.backupOk) return { error: 'Потврдете дека е направена резервна копија пред примена.' };
    const steps = BULK_STEPS.filter((s) => a.steps.includes(s)) as BulkStep[];
    if (!steps.length) return { error: 'Изберете барем еден чекор.' };
    const want = [...new Set((a.firmIds ?? []).filter(isUuid))];
    // demo firms never: only real firms remain, in the order of the list
    const real = new Set((await bankKontaAllFirms(db(), want)).map((f) => f.id));
    const firmIds = want.filter((id) => real.has(id));
    if (!firmIds.length) return { error: 'Изберете барем една фирма.' };
    const cur = await bankKontaAllRun(db());
    if (bankKontaAllBusy(cur)) return { error: 'Примената веќе тече – почекајте да заврши.' };
    const year = bsYear(a.year, calendarYear());
    const s: BankKontaAllRun = { runId: randomUUID(), status: 'queued', userId: u.id, year, steps, firmIds, total: firmIds.length, done: 0, results: [], at: new Date().toISOString() };
    await putBankKontaAllRun(db(), s);
    await audit(db(), { userId: u.id, action: 'bankKontaAllRun', entityType: 'bank_konta_all', entityId: s.runId, data: { year, steps, firms: firmIds.length } });
    try { await enqueue(BANK_KONTA_ALL_JOB, { runId: s.runId }); } catch {
      await putBankKontaAllRun(db(), { ...s, status: 'error', error: 'Редот за задачи е недостапен – обидете се повторно.', finishedAt: new Date().toISOString() });
      return { error: 'Редот за задачи е недостапен – обидете се повторно.' };
    }
    revalidatePath('/bankSite');
    return { ok: `Примената започна за ${firmIds.length} фирми.` };
  } catch (e) { return fail(e); }
}

/** The run's progress / result (polled by the screen while it runs). */
export async function bankSiteStatusAction(): Promise<{ run?: BankKontaAllRun | null; error?: string }> {
  try {
    await bsOwnerAction();
    return { run: await bankKontaAllRun(db()) };
  } catch (e) { return fail(e); }
}
