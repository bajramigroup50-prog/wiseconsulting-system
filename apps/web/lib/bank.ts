import 'server-only';
/**
 * Shared server helpers for the Phase 4 pages (изводи, девизни изводи, благајна, платни налози, курсна листа).
 */
import { revalidatePath } from 'next/cache';
import type { Firm, Tx } from '@wise/db';
import { actionError, firmAction } from './books';
import type { SessionUser } from './auth';
import { db } from './db';
import type { FormState } from '@/components/action-form';

const DOMAIN_ERRORS = new Set(['BankError', 'CashError', 'OrderError', 'ImportError']);

/** Domain / permission / posting errors → form state; anything else is rethrown. */
export function bankError(e: unknown): FormState {
  if (e instanceof Error && DOMAIN_ERRORS.has(e.name)) return { error: e.message };
  return actionError(e);
}

export interface BankCtx { tx: Tx; u: SessionUser; firm: Firm; year: number }

/**
 * Run a guarded, audited mutation in one transaction: firm from the session, `requireCan(action, firm)`, then
 * `fn` inside `db().transaction`. Revalidates the given paths. `fn` returns the ok message.
 */
export async function bankRun(action: string, paths: string[], fn: (c: BankCtx) => Promise<string | void>): Promise<FormState> {
  let msg: string | void;
  try {
    const { u, firm, year } = await firmAction(action);
    msg = await db().transaction((tx) => fn({ tx, u, firm, year }));
  } catch (e) { return bankError(e); }
  for (const p of paths) revalidatePath(p);
  return { ok: msg || 'Зачувано.' };
}

export const num = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const t = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
export const str = (v: FormDataEntryValue | null): string => String(v ?? '').trim();
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Labels of the automatic booking reasons (`bank_lines.auto`). */
export const AUTO_LBL: Record<string, string> = {
  num: 'по број на фактура', amt: 'по износ', sum: 'збир на фактури', fx: 'девизна фактура', fxnear: 'девизна фактура (≈ износ)',
  invoice: 'фактура (износ)', purchase: 'влезна ф-ра (износ)', fee: 'провизија', payroll: 'плата', rule: 'правило', osnov: 'шифра на плаќање',
  pos: 'POS картички', vat: 'ДДВ', own: 'пренос меѓу свои сметки', conv: 'откуп на девизи',
};
