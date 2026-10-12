/**
 * Client-side fiscal flow: print a prepared receipt on the device (desktop bridge) and store the device's answer on
 * the server. Pure orchestration (the bridge and the server action are passed in) so the workflow tests can drive it.
 */
import type { FiscalReceipt, FiscalResult } from '@wise/core/retail/fiscal';
import { safeCall, type WiseFiscal } from '@/lib/fiscal-bridge';

export interface FiscalJob { fiskId: string; receipt: FiscalReceipt; storno?: boolean }
export interface FiscalOutcome {
  /** the server recorded the receipt as fiscalised (device number stored) */
  ok: boolean;
  /** message for the cashier */
  msg: string;
  number?: string | null;
  /** the device printed but the server could not record it: keep this to retry `record` only (never print twice) */
  unsaved?: { fiskId: string; result: FiscalResult };
}
type RecordFn = (fiskId: string, result: unknown) => Promise<{ ok?: string; error?: string; number?: string | null }>;

/** Prints `job` and records the answer. Never prints twice: a failed save returns `unsaved` for `saveAgain`. */
export async function printFiscal(bridge: WiseFiscal, job: FiscalJob, record: RecordFn): Promise<FiscalOutcome> {
  const res = await safeCall(() => (job.storno ? bridge.printStorno(job.receipt) : bridge.printReceipt(job.receipt)));
  return saveAgain(job.fiskId, res, record);
}

export async function saveAgain(fiskId: string, res: FiscalResult, record: RecordFn): Promise<FiscalOutcome> {
  let st: Awaited<ReturnType<RecordFn>>;
  try { st = await record(fiskId, res); } catch { st = { error: 'Серверот не е достапен.' }; }
  if (st.ok && res.ok) return { ok: true, msg: st.ok, number: st.number ?? res.number ?? null };
  if (res.ok && res.number && st.error && !/НЕ е испечатена/.test(st.error)) {
    return { ok: false, msg: `Апаратот ја испечати сметката бр. ${res.number}, но записот не е зачуван (${st.error}). Притиснете „Зачувај го бројот“.`, unsaved: { fiskId, result: res } };
  }
  return { ok: false, msg: st.error || res.error || 'Фискалната сметка не е испечатена.' };
}
