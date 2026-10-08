/**
 * Firm → `@wise/core` `PostingContext` for the VAT module.
 *
 * Legacy keeps the VAT/scheme overrides on the firm record (`firm.sch`, `vatOut`, `vatIn`, `vatImp`,
 * `vatInKonto`, `posK`) and office-wide in `appsettings/schemes` (`S.gsch`). In the rebuild they live in
 * `firms.settings` under the same names and in `app_settings` under the key `schemes`.
 *
 * TODO(merge): Phase 3 (sales & purchases) needs the same resolver for document posting. If it ships
 * its own `firm → PostingContext` helper, keep one of the two and point the other at it.
 */
import { eq } from 'drizzle-orm';
import type { PostingContext, SchemeSettings } from '@wise/core';
import type { Tx } from './audit';
import { appSettings, type Firm } from './schema/index';

export const SCHEMES_SETTINGS_KEY = 'schemes';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Scheme/VAT overrides from a settings blob (firm `settings` or the global `schemes` value). */
export function schemeSettingsOf(s: unknown): SchemeSettings {
  const o = obj(s) ?? {};
  return {
    sch: obj(o.sch) as SchemeSettings['sch'],
    vatOut: obj(o.vatOut) as SchemeSettings['vatOut'],
    vatIn: obj(o.vatIn) as SchemeSettings['vatIn'],
    vatImp: obj(o.vatImp) as SchemeSettings['vatImp'],
  };
}

/** Pure: build the posting context from a firm row and the global scheme settings. */
export function vatPostingContext(firm: Pick<Firm, 'vatRegistered' | 'settings'>, global?: unknown): PostingContext {
  const s = (firm.settings ?? {}) as Obj;
  return {
    firm: {
      ...schemeSettingsOf(s),
      ddv: firm.vatRegistered,
      vatInKonto: str(s.vatInKonto),
      posK: str(s.posK),
    },
    global: global == null ? null : schemeSettingsOf(global),
  };
}

/** Load the global scheme settings and build the firm's posting context. */
export async function loadVatPostingContext(tx: Tx, firm: Pick<Firm, 'vatRegistered' | 'settings'>): Promise<PostingContext> {
  const [g] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
  return vatPostingContext(firm, g?.v ?? null);
}
