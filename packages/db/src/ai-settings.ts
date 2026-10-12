/**
 * Office-wide AI reading switch (`app_settings` key `ai`): Систем › „AI читање: вклучено / исклучено“, plus the last
 * blocking provider failure (credit exhausted / key refused) written by the worker. While AI is off or blocked the
 * drop zones keep accepting files and the worker reads them with the free (non-AI) readers.
 * Converter mapping presets live under the key `convPresets` (see `@wise/core/convert`).
 */
import { eq, sql } from 'drizzle-orm';
import type { AiErrCode } from '@wise/core/ai/errors';
import { convPresetClean, type ConvPreset } from '@wise/core/convert/index';
import { appSettings } from './schema/index';
import type { Tx } from './audit';

export interface AiSettings {
  /** Default true. */
  enabled: boolean;
  /** Last blocking failure (credit / auth); cleared by the next successful AI call. */
  lastFail: { code: AiErrCode; at: string; detail: string } | null;
  /**
   * Last „Провери го AI-кредитот“ check (`ai.ping`, worker): manual (`id` = the request of the screen) or automatic
   * (a read blocked by an older failure, at most once per 2 minutes). `code` / `msg` on failure.
   */
  lastPing: AiPing | null;
}

export interface AiPing { at: string; ok: boolean; id?: string | null; auto?: boolean; code?: AiErrCode | null; msg: string }

type Q = Pick<Tx, 'select' | 'insert' | 'update'>;

export async function getAiSettings(tx: Q): Promise<AiSettings> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'ai')).limit(1);
  const v = (r?.v ?? {}) as Partial<AiSettings>;
  return {
    enabled: v.enabled !== false,
    lastFail: v.lastFail && typeof v.lastFail === 'object' ? v.lastFail : null,
    lastPing: v.lastPing && typeof v.lastPing === 'object' ? v.lastPing : null,
  };
}

async function patch(tx: Q, p: Record<string, unknown>, userId: string | null = null): Promise<void> {
  const j = JSON.stringify(p);
  await tx.insert(appSettings).values({ key: 'ai', value: p, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${appSettings.value} || ${j}::jsonb`, updatedBy: userId } });
}

export const setAiEnabled = (tx: Q, enabled: boolean, userId: string | null) => patch(tx, { enabled, ...(enabled ? { lastFail: null } : {}) }, userId);
export const noteAiFailure = (tx: Q, code: AiErrCode, detail: string) => patch(tx, { lastFail: { code, at: new Date().toISOString(), detail: detail.slice(0, 500) } });
export const clearAiFailure = (tx: Q) => patch(tx, { lastFail: null });
export const noteAiPing = (tx: Q, p: Omit<AiPing, 'at'> & { at?: string }) => patch(tx, { lastPing: { ...p, at: p.at ?? new Date().toISOString(), msg: p.msg.slice(0, 500) } });

/** Is AI reading usable right now (switched on and not blocked by a credit / key failure)? */
export const aiUsable = (s: AiSettings): boolean => s.enabled && !s.lastFail;

/** Why the free readers are used, for the drop zones („AI е исклучено …“); empty when AI is usable. */
export function aiOffReason(s: AiSettings): string {
  if (!s.enabled) return 'AI читањето е исклучено (Систем › AI читање) – датотеките се читаат без AI: Excel/CSV/XML и PDF со текст.';
  if (s.lastFail?.code === 'credit') return 'AI-кредитот е потрошен – датотеките се читаат без AI (Excel/CSV/XML и PDF со текст) додека не се дополни кредитот.';
  if (s.lastFail) return 'AI-клучот е одбиен – датотеките се читаат без AI (Excel/CSV/XML и PDF со текст).';
  return '';
}

/* ---------- converter mapping presets (office-wide, `app_settings` key `convPresets`) ---------- */

export async function getConvPresets(tx: Q): Promise<ConvPreset[]> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'convPresets')).limit(1);
  return Array.isArray(r?.v) ? (r.v as unknown[]).map(convPresetClean).filter((p): p is ConvPreset => !!p) : [];
}

export async function putConvPresets(tx: Q, P: readonly ConvPreset[], userId: string | null): Promise<void> {
  const value = P.slice(0, 300);
  await tx.insert(appSettings).values({ key: 'convPresets', value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
}
