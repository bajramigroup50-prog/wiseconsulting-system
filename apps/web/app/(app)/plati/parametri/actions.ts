'use server';
/**
 * Payroll parameters screen (legacy `payParams` 7736 / `ppAdd` / `payParSave` 7742), payroll accounts, payment-order
 * accounts (FIX #19) and the MPIN template (legacy `mpinTplImport` 6150; FIX #6: per firm, never auto-applied).
 * FIX(#10): rows are saved per firm; office-wide rows (all firms) need the `settings` permission.
 */
import { revalidatePath } from 'next/cache';
import { eq, isNull } from 'drizzle-orm';
import { decodeCp1251, mpinParse, PAY_DEF, PAY_FUNDS, PAY_RATE_KEYS, PAY_SCH_KEYS } from '@wise/core';
import { audit, payrollParams, payrollSettings } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction, payError } from '@/lib/payroll/server';

export interface ParamRowInput { from: string; src?: string; [k: string]: string | undefined }

/** Replace the override rows of the firm (`scope = firm`) or the office (`scope = office`). Rows equal to PAY_DEF are dropped. */
export async function saveParamRows(scope: 'firm' | 'office', rows: ParamRowInput[]): Promise<ActionState> {
  try {
    const { u, firm } = await payAction(scope === 'office' ? 'settings' : 'payParSave');
    const def = new Map(PAY_DEF.map((r) => [r.from, r]));
    const clean = rows.filter((r) => /^\d{4}-(0[1-9]|1[0-2])$/.test(r.from ?? '')).map((r) => {
      const o: Record<string, string | null> = { from: r.from, src: (r.src ?? '').trim() || null };
      for (const k of PAY_RATE_KEYS) {
        const v = String(r[k] ?? '').trim().replace(',', '.');
        if (v !== '' && !Number.isFinite(+v)) throw new UserErr(`${r.from}: „${v}“ не е број.`);
        o[k] = v === '' ? null : v;
      }
      return o;
    }).filter((o) => {
      const d = def.get(o.from!) as Record<string, unknown> | undefined;
      return !d || PAY_RATE_KEYS.some((k) => o[k] != null && +o[k]! !== +(d[k] as number));
    });
    const froms = clean.map((r) => r.from);
    if (new Set(froms).size !== froms.length) throw new UserErr('Два реда со ист месец „Важи од“.');
    await db().transaction(async (tx) => {
      const firmId = scope === 'office' ? null : firm.id;
      await tx.delete(payrollParams).where(firmId ? eq(payrollParams.firmId, firmId) : isNull(payrollParams.firmId));
      if (clean.length) await tx.insert(payrollParams).values(clean.map((r) => ({ ...r, from: r.from!, firmId, updatedBy: u.id })));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'payParSave', entityType: 'payroll_params', entityId: scope, data: { rows: clean } });
    });
  } catch (e) {
    if (e instanceof UserErr) return { error: e.message };
    return payError(e);
  }
  revalidatePath('/plati', 'layout');
  return { ok: 'Параметрите се зачувани.' };
}

class UserErr extends Error {}

async function patchSettings(action: string, patch: Partial<typeof payrollSettings.$inferInsert>, what: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction(action);
    await db().transaction(async (tx) => {
      await tx.insert(payrollSettings).values({ firmId: firm.id, ...patch, updatedBy: u.id })
        .onConflictDoUpdate({ target: payrollSettings.firmId, set: { ...patch, updatedBy: u.id } });
      await audit(tx, { userId: u.id, firmId: firm.id, action, entityType: 'payroll_settings', entityId: firm.id, data: { what, ...patch } });
    });
  } catch (e) { return payError(e); }
  revalidatePath('/plati', 'layout');
  return { ok: 'Зачувано.' };
}

/** Payroll accounts (pay_* posting scheme) of the firm. Changing them needs `settings` (legacy `schSave`). */
export async function saveScheme(_prev: ActionState, form: FormData): Promise<ActionState> {
  const scheme: Record<string, string> = {};
  for (const k of PAY_SCH_KEYS) {
    const v = String(form.get(k) ?? '').trim();
    if (v && v !== '-' && !/^\d{2,10}$/.test(v)) return { error: `Неважечко конто „${v}“ (${k}).` };
    if (v) scheme[k] = v;
  }
  return patchSettings('schSave', { scheme }, 'scheme');
}

/** Payment-order data: payer account, signer, municipality, treasury account and per-fund payment account / revenue code. */
export async function saveOrders(_prev: ActionState, form: FormData): Promise<ActionState> {
  const g = (k: string) => String(form.get(k) ?? '').trim();
  const funds = Object.fromEntries(PAY_FUNDS.map(([k]) => [k, { uplSm: g(`${k}_uplSm`), prihod: g(`${k}_prihod`) }]));
  const acc = g('payerAcc').replace(/\D/g, '');
  if (acc && acc.length !== 15) return { error: 'Жиро сметката има 15 цифри.' };
  return patchSettings('payParSave', {
    orders: { payerAcc: acc, payerBank: g('payerBank'), signer: g('signer'), signerRole: g('signerRole'), opstina: g('opstina'), trezor: g('trezor').replace(/\D/g, ''), funds },
  }, 'orders');
}

/** Import an earlier MPI3 `.txt` as the firm's MPIN template (municipality, FZO unit, income-type codes per employee). */
export async function saveMpinTemplate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const f = form.get('file');
  if (form.get('remove') === '1') return patchSettings('mpinTplImport', { mpinTemplate: null }, 'mpinTemplate');
  if (!(f instanceof File) || !f.size) return { error: 'Изберете MPI3 .txt датотека.' };
  if (f.size > 2_000_000) return { error: 'Датотеката е преголема.' };
  const txt = decodeCp1251(new Uint8Array(await f.arrayBuffer()));
  const t = mpinParse(txt);
  if (!Object.keys(t.emp).length) return { error: 'Ова не личи на MPI3 датотека (нема редови со вработени).' };
  return patchSettings('mpinTplImport', { mpinTemplate: t as unknown as Record<string, unknown> }, 'mpinTemplate');
}

