/**
 * Office-wide defaults for every firm (`app_settings` key `firmDefaults`): the nalog numbering (`nalogMode`, `nalogPer`,
 * `nalPayPer`) and the bank kontos („Конта за изводи“). An office with its own chart and its own way of working
 * (another installation) sets them once for all firms: the admin's „за сите фирми“ writes them into every firm's
 * `settings` (so the per-firm readers stay as they are) and keeps them for the firms created later (`withFirmDefaults`).
 * A firm can still change its own afterwards. Every apply is audited.
 */
import { eq, sql } from 'drizzle-orm';
import { BANK_KONTA_FIELDS, validateBankKonta, type BankKonta } from '@wise/core';
import { audit, type Tx } from './audit';
import { effectiveChart } from './ledger-queries';
import { appSettings, firms } from './schema/index';

export const FIRM_DEFAULTS_KEY = 'firmDefaults';

export interface NalogDefaults { nalogMode: 'period' | 'doc'; nalogPer: 'quarter' | 'month'; nalPayPer: 'month' | 'year' }
export interface FirmDefaults { nalog?: NalogDefaults; bankKonta?: Partial<BankKonta> }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function getFirmDefaults(tx: Tx): Promise<FirmDefaults> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, FIRM_DEFAULTS_KEY)).limit(1);
  return obj(r?.v) as FirmDefaults;
}

async function putFirmDefaults(tx: Tx, userId: string | null, d: FirmDefaults): Promise<void> {
  await tx.insert(appSettings).values({ key: FIRM_DEFAULTS_KEY, value: d, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: d, updatedBy: userId, updatedAt: new Date() } });
}

/** The settings of a new firm with the office defaults under its own values. */
export async function withFirmDefaults(tx: Tx, settings: unknown): Promise<Record<string, unknown>> {
  const s = { ...obj(settings) };
  const d = await getFirmDefaults(tx);
  if (d.nalog) for (const k of ['nalogMode', 'nalogPer', 'nalPayPer'] as const) if (s[k] == null) s[k] = d.nalog[k];
  if (d.bankKonta && Object.keys(d.bankKonta).length) s.bankKonta = { ...d.bankKonta, ...obj(s.bankKonta) };
  return s;
}

/** „за сите фирми“ in Шифри на налози: the numbering of every firm (and of the new ones). Returns the firms changed. */
export async function applyNalogDefaults(tx: Tx, userId: string | null, n: NalogDefaults): Promise<number> {
  const d = await getFirmDefaults(tx);
  await putFirmDefaults(tx, userId, { ...d, nalog: n });
  const r = await tx.update(firms).set({ settings: sql`coalesce(${firms.settings}, '{}'::jsonb) || ${JSON.stringify(n)}::jsonb` }).returning({ id: firms.id });
  await audit(tx, { userId, firmId: null, action: 'firmDefaultsNalog', entityType: 'app_settings', entityId: FIRM_DEFAULTS_KEY, data: { before: d.nalog ?? null, after: n, firms: r.length } });
  return r.length;
}

/**
 * „за сите фирми“ in Конта за изводи: the bank kontos of every firm (and of the new ones), validated against the
 * office chart (the global accounts). Empty fields are left out (the firm keeps its own / the default).
 */
export async function applyBankKontaDefaults(tx: Tx, userId: string | null, input: Partial<Record<string, string>>): Promise<number> {
  const chart = await effectiveChart(tx, null);
  const { konta, errors } = validateBankKonta(input as never, chart);
  if (errors.length) throw new Error(errors.join(' '));
  const set = Object.fromEntries(Object.entries(konta).filter(([k, v]) => v && BANK_KONTA_FIELDS.some((f) => f.key === k)));
  const d = await getFirmDefaults(tx);
  await putFirmDefaults(tx, userId, { ...d, bankKonta: set });
  const r = await tx.update(firms)
    .set({ settings: sql`jsonb_set(coalesce(${firms.settings}, '{}'::jsonb), '{bankKonta}', coalesce(${firms.settings}->'bankKonta', '{}'::jsonb) || ${JSON.stringify(set)}::jsonb)` })
    .returning({ id: firms.id });
  await audit(tx, { userId, firmId: null, action: 'firmDefaultsBankKonta', entityType: 'app_settings', entityId: FIRM_DEFAULTS_KEY, data: { before: d.bankKonta ?? null, after: set, firms: r.length } });
  return r.length;
}

/** A firm just created: the office defaults go under its own settings (no-op when there are none). */
export async function applyFirmDefaults(tx: Tx, firmId: string): Promise<void> {
  const d = await getFirmDefaults(tx);
  if (!d.nalog && !(d.bankKonta && Object.keys(d.bankKonta).length)) return;
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) return;
  await tx.update(firms).set({ settings: await withFirmDefaults(tx, f.settings) }).where(eq(firms.id, firmId));
}
