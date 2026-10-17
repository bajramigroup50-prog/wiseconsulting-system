/**
 * UX Phase 3 automations — shared services: the office switches (`app_settings.automations`), each job's last run
 * (`app_settings['autoRun:<kind>']`, P42 status line „Подготвено автоматски: …“), the firms an automation may touch
 * (active, real — never a 🎭 demo firm) and the drafts table (`automation_drafts`, one row per kind / firm / period).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AUTO_KINDS, AUTO_SETTINGS_KEY, autoRunKey, autoSettingsClean, type AutoDraftStatus, type AutoKind, type AutoSettings } from '@wise/core/office/automations';
import { isDemoFirm } from '@wise/core/demo';
import type { Tx } from '../audit';
import { realFirmSql } from '../demo/filters';
import { appSettings, automationDrafts, firms, type AutomationDraftRow, type Firm } from '../schema/index';

/* ---------------- switches ---------------- */

export async function autoSettings(tx: Pick<Tx, 'select'>): Promise<AutoSettings> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, AUTO_SETTINGS_KEY)).limit(1);
  return autoSettingsClean(r?.v);
}

export async function putAutoSettings(tx: Tx, s: AutoSettings, userId: string | null): Promise<void> {
  const value = autoSettingsClean(s) as unknown as Record<string, unknown>;
  await tx.insert(appSettings).values({ key: AUTO_SETTINGS_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
}

export const autoOn = async (tx: Pick<Tx, 'select'>, k: AutoKind): Promise<boolean> => (await autoSettings(tx)).on[k];

/* ---------------- last run (P42 status line) ---------------- */

export interface AutoRun { at: Date; summary: string; data?: Record<string, unknown> }

export async function noteAutoRun(tx: Tx, k: AutoKind, summary: string, data: Record<string, unknown> = {}, at = new Date()): Promise<void> {
  const value = { at: at.toISOString(), summary, data };
  await tx.insert(appSettings).values({ key: autoRunKey(k), value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

const runOf = (v: unknown): AutoRun | null => {
  const o = v as { at?: unknown; summary?: unknown; data?: unknown } | undefined;
  const d = typeof o?.at === 'string' ? new Date(o.at) : null;
  return d && !Number.isNaN(d.getTime()) ? { at: d, summary: typeof o?.summary === 'string' ? o.summary : '', data: (o?.data ?? {}) as Record<string, unknown> } : null;
};

export async function autoLastRun(tx: Pick<Tx, 'select'>, k: AutoKind): Promise<AutoRun | null> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, autoRunKey(k))).limit(1);
  return runOf(r?.v);
}

export async function autoLastRuns(tx: Pick<Tx, 'select'>): Promise<Partial<Record<AutoKind, AutoRun>>> {
  const R = await tx.select({ k: appSettings.key, v: appSettings.value }).from(appSettings).where(inArray(appSettings.key, AUTO_KINDS.map(autoRunKey)));
  const out: Partial<Record<AutoKind, AutoRun>> = {};
  for (const k of AUTO_KINDS) { const r = runOf(R.find((x) => x.k === autoRunKey(k))?.v); if (r) out[k] = r; }
  return out;
}

/* ---------------- firms ---------------- */

/** 🎭 Never a demo firm: the flag-and-prefix rule (`isDemoFirm`) and, to be safe, any firm flagged `settings.demo`. */
export const autoSkipFirm = (f: Pick<Firm, 'name' | 'settings'>): boolean => isDemoFirm(f) || !!(f.settings as { demo?: unknown } | null)?.demo;
export const isOfficeFirm = (f: Pick<Firm, 'settings'>): boolean => !!(f.settings as { officeFirm?: boolean } | null)?.officeFirm;

/** Active real firms (never demo), by name. `office`: include the office's own firm. */
export async function autoFirms(tx: Pick<Tx, 'select'>, o: { office?: boolean; ids?: readonly string[] } = {}): Promise<Firm[]> {
  const L = await tx.select().from(firms)
    .where(and(eq(firms.active, true), realFirmSql, o.ids ? inArray(firms.id, [...o.ids, '00000000-0000-0000-0000-000000000000']) : undefined))
    .orderBy(asc(firms.name));
  return L.filter((f) => !autoSkipFirm(f) && (o.office !== false || !isOfficeFirm(f)));
}

/** Is the firm's period ending `end` (YYYY-MM-DD) locked? */
export const lockedAt = (f: Pick<Firm, 'lockDate'>, end: string): boolean => !!f.lockDate && f.lockDate >= end;

/* ---------------- drafts ---------------- */

/**
 * Create or refresh a draft (never a second row: unique kind / firm / period). A draft a person already decided
 * (`confirmed` / `dismissed`) is left alone. Returns whether a row was created.
 */
export async function upsertDraft(tx: Tx, d: { kind: string; firmId: string; period: string; data: Record<string, unknown>; problems?: string[] }): Promise<{ id: string; created: boolean; decided: boolean }> {
  const [ex] = await tx.select({ id: automationDrafts.id, status: automationDrafts.status }).from(automationDrafts)
    .where(and(eq(automationDrafts.kind, d.kind), eq(automationDrafts.firmId, d.firmId), eq(automationDrafts.period, d.period))).limit(1);
  if (ex) {
    if (ex.status !== 'draft') return { id: ex.id, created: false, decided: true };
    await tx.update(automationDrafts).set({ data: d.data, problems: d.problems ?? [] }).where(eq(automationDrafts.id, ex.id));
    return { id: ex.id, created: false, decided: false };
  }
  const [r] = await tx.insert(automationDrafts).values({ kind: d.kind, firmId: d.firmId, period: d.period, data: d.data, problems: d.problems ?? [] })
    .onConflictDoNothing().returning({ id: automationDrafts.id });
  if (r) return { id: r.id, created: true, decided: false };
  // a concurrent run made it in the meantime
  const [x] = await tx.select({ id: automationDrafts.id }).from(automationDrafts)
    .where(and(eq(automationDrafts.kind, d.kind), eq(automationDrafts.firmId, d.firmId), eq(automationDrafts.period, d.period))).limit(1);
  return { id: x!.id, created: false, decided: false };
}

/** Remove a waiting draft that no longer applies (e.g. the month is no longer ready). Decided rows stay. */
export async function dropDraft(tx: Tx, kind: string, firmId: string, period: string): Promise<void> {
  await tx.delete(automationDrafts).where(and(eq(automationDrafts.kind, kind), eq(automationDrafts.firmId, firmId), eq(automationDrafts.period, period), eq(automationDrafts.status, 'draft')));
}

export async function decideDraft(tx: Tx, id: string, status: AutoDraftStatus, userId: string | null, data?: Record<string, unknown>): Promise<void> {
  await tx.update(automationDrafts).set({ status, decidedAt: new Date(), decidedBy: userId, ...(data ? { data: sql`${automationDrafts.data} || ${JSON.stringify(data)}::jsonb` } : {}) })
    .where(eq(automationDrafts.id, id));
}

export async function listDrafts(tx: Pick<Tx, 'select'>, o: { kind: string; firmIds?: readonly string[]; status?: AutoDraftStatus; period?: string }): Promise<AutomationDraftRow[]> {
  if (o.firmIds && !o.firmIds.length) return [];
  return tx.select().from(automationDrafts).where(and(
    eq(automationDrafts.kind, o.kind), eq(automationDrafts.status, o.status ?? 'draft'),
    o.firmIds ? inArray(automationDrafts.firmId, [...o.firmIds]) : undefined, o.period ? eq(automationDrafts.period, o.period) : undefined,
  )).orderBy(asc(automationDrafts.period));
}

/** Waiting drafts per kind (the owner's panel). */
export async function draftCounts(tx: Pick<Tx, 'select'>): Promise<Record<string, number>> {
  const R = await tx.select({ k: automationDrafts.kind, n: sql<number>`count(*)::int` }).from(automationDrafts)
    .innerJoin(firms, eq(firms.id, automationDrafts.firmId))
    .where(and(eq(automationDrafts.status, 'draft'), realFirmSql)).groupBy(automationDrafts.kind);
  return Object.fromEntries(R.map((r) => [r.k, r.n]));
}
