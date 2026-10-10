'use server';
/**
 * ДДВ-04 server actions (legacy `ACT.ddvPost` 7313, `ACT.ddvUnpost` 7315, `ddvPerKind` 16457, `ACT.trSave` 12855).
 * Every action: current firm from the session, `requireCan`, one transaction with `audit()`.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { DDV04_FIELDS, isAccountCode, validateVatAccountSettings, type VatAccountMap } from '@wise/core';
import { patchFirmSettings } from '@/lib/firms-office';
import {
  appSettings, audit, closeVatPeriod, firms, missingAccounts, normalizeVatPeriod, reopenVatPeriod, saveVatCorrections, SCHEMES_SETTINGS_KEY,
} from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { vatSource } from '@/lib/vat-source';

const done = () => { revalidatePath('/ddv'); revalidatePath('/ddvKnigi'); revalidatePath('/nalozi'); };
const periodOr = (p: string) => { const n = normalizeVatPeriod(p); if (!n) throw new Error('Неважечки ДДВ период.'); return n; };
const asError = (e: unknown): ActionState => (e instanceof Error && e.message === 'Неважечки ДДВ период.' ? { error: e.message } : actionError(e));

/**
 * File the return: post the VAT-close journal and mark the period closed. Needs `write`
 * (legacy `ddvPost` had no ACT_NEED entry, i.e. `write`).
 */
export async function closeVatPeriodAction(period: string): Promise<ActionState> {
  try {
    const p = periodOr(period);
    const { u, firm } = await firmAction('write');
    const r = await db().transaction((tx) => closeVatPeriod(tx, { firmId: firm.id, period: p, userId: u.id, source: vatSource }));
    done();
    return { ok: r.journal ? `Периодот е затворен, налог ${r.journal.number}.` : 'Периодот е затворен (нема салдо на ДДВ контата).' };
  } catch (e) { return asError(e); }
}

/**
 * Reopen a closed period (removes the VAT-close journal).
 * FIX: legacy `ddvUnpost` let any user with `write` delete a filed return's posting; reopening now
 * needs the `close` permission (senior / admin), like unlocking a period.
 */
export async function reopenVatPeriodAction(period: string): Promise<ActionState> {
  try {
    const p = periodOr(period);
    const { u, firm } = await firmAction('close');
    await db().transaction((tx) => reopenVatPeriod(tx, { firmId: firm.id, period: p, userId: u.id }));
    done();
    return { ok: 'Периодот е отворен.' };
  } catch (e) { return asError(e); }
}

/** Field 30 "Останати корекции", its note and the amendment number, for an open period. */
export async function saveCorrectionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const p = periodOr(String(form.get('period') ?? ''));
    const raw = String(form.get('field30') ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const field30 = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(field30) || Math.abs(field30) > 1e12) return { error: 'Неважечки износ за поле 30.' };
    const { u, firm } = await firmAction('write');
    await db().transaction((tx) => saveVatCorrections(tx, {
      firmId: firm.id, period: p, userId: u.id,
      corrections: { field30, note: String(form.get('note') ?? ''), amendmentNo: String(form.get('amendmentNo') ?? '') },
    }));
    done();
    return { ok: 'Корекциите се зачувани.' };
  } catch (e) { return asError(e); }
}

/**
 * Filing frequency month ↔ quarter (legacy `ddvPerKind` 16456, `can('write')`). Already closed periods keep
 * their stored date range, so switching cannot misalign them (LEGACY-MAP 5.4 item 8).
 */
export async function setVatPeriodKindAction(form: FormData): Promise<void> {
  const v = form.get('vatPeriod') === 'month' ? 'month' : 'quarter';
  const { u, firm } = await firmAction('write');
  if (firm.vatPeriod === v) return;
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ vatPeriod: v }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'ddvPerKind', entityType: 'firm', entityId: firm.id, data: { from: firm.vatPeriod, to: v } });
  });
  revalidatePath('/', 'layout');
}

const RATES = [18, 10, 5] as const;
const SCH_KEYS = ['r32out', 'r32in', 'ddvPay', 'ddvClaim'] as const;

/**
 * VAT kontos per rate (legacy `VIEWS.tarifi` 12844 / `ACT.trSave` 12855, ACT_NEED `settings`), for this firm
 * or — admin only — for all firms (`app_settings.schemes`).
 * FIX (LEGACY-MAP 5.4 items 3 and 12): values are validated with `validateVatAccountSettings` (summary
 * kontos such as 2300/1300 are rejected instead of being saved and silently ignored) and must exist in the chart.
 */
export async function saveVatAccountsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const all = form.get('scope') === 'g';
    const { u, firm } = await firmAction('settings');
    if (all && u.role !== 'admin') return { error: 'За сите фирми може само администраторот.' };
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const map = (p: string): VatAccountMap => Object.fromEntries(RATES.map((r) => [r, g(`${p}${r}`)]).filter(([, v]) => v));
    const vatOut = map('o'), vatIn = map('i'), vatImp = map('m');
    const sch = Object.fromEntries(SCH_KEYS.map((k) => [k, g(k)]).filter(([, v]) => v));
    const errs = validateVatAccountSettings({ vatOut, vatIn, vatImp });
    for (const [k, v] of Object.entries(sch)) if (!isAccountCode(v)) errs.push(`${k}: „${v}“ не е конто (3–10 цифри)`);
    if (errs.length) return { error: errs.join(' · ') };
    const codes = [...Object.values(vatOut), ...Object.values(vatIn), ...Object.values(vatImp), ...Object.values(sch)].map(String);
    const missing = await missingAccounts(db(), firm.id, codes);
    if (missing.length) return { error: `Контото ${missing.join(', ')} не постои во контниот план.` };
    const merge = (o: unknown, n: Record<string, unknown>) => ({ ...((o && typeof o === 'object' ? o : {}) as Record<string, unknown>), ...n });
    await db().transaction(async (tx) => {
      if (all) {
        const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
        const G = (row?.value ?? {}) as Record<string, unknown>;
        const value = { ...G, vatOut: merge(G.vatOut, vatOut), vatIn: merge(G.vatIn, vatIn), vatImp: merge(G.vatImp, vatImp), sch: merge(G.sch, sch) };
        await tx.insert(appSettings).values({ key: SCHEMES_SETTINGS_KEY, value, updatedBy: u.id })
          .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: u.id } });
        await audit(tx, { userId: u.id, firmId: null, action: 'trSave', entityType: 'appSettings', entityId: SCHEMES_SETTINGS_KEY, data: { vatOut, vatIn, vatImp, sch } });
      } else {
        const S = (firm.settings ?? {}) as Record<string, unknown>;
        const settings = { ...S, vatOut: merge(S.vatOut, vatOut), vatIn: merge(S.vatIn, vatIn), vatImp: merge(S.vatImp, vatImp), sch: merge(S.sch, sch) };
        await tx.update(firms).set({ settings }).where(eq(firms.id, firm.id));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'trSave', entityType: 'firm', entityId: firm.id, data: { vatOut, vatIn, vatImp, sch } });
      }
    });
    done();
    return { ok: all ? 'Контата за ДДВ се зачувани за сите фирми.' : 'Контата за ДДВ се зачувани за фирмата.' };
  } catch (e) { return asError(e); }
}

/** Legacy `dtSaveCols` 16822: the inspector table's columns are remembered per firm (`firm.dtCols`). */
export async function saveDtColsAction(cols: string[]): Promise<{ ok?: string; error?: string }> {
  const ok = new Set(DDV04_FIELDS.map(([k]) => k));
  const C = (Array.isArray(cols) ? cols : []).filter((k) => ok.has(k));
  if (!C.length) return { error: 'Изберете колони.' };
  const { u, firm } = await firmAction('write');
  await db().transaction(async (tx) => {
    await patchFirmSettings(tx, firm.id, { dtCols: C });
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'dtSaveCols', entityType: 'firm', entityId: firm.id, data: { cols: C } });
  });
  revalidatePath('/ddv');
  return { ok: 'Колоните се запомнети.' };
}
