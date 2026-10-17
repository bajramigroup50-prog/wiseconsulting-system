/**
 * Firm → `@wise/core` `PostingContext`: the ONE resolver used by every module (VAT, sales & purchases, bank & cash,
 * stock). `firmPostingContext` (`bank/context.ts`, re-exported by `sales/context.ts`) delegates to
 * {@link loadVatPostingContext}.
 *
 * Legacy keeps the VAT/scheme overrides on the firm record (`firm.sch`, `vatOut`, `vatIn`, `vatImp`,
 * `vatInKonto`, `posK`) and office-wide in `appsettings/schemes` (`S.gsch`). In the rebuild they live in
 * `firms.settings` under the same names and in `app_settings` under the key `schemes`.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { CUSTOMER_EXEMPT_KONTO, type PostingContext, type SchemeSettings } from '@wise/core';
import { schemeProfilesOf } from '@wise/core/scheme-profiles';
import type { Tx } from './audit';
import { accounts, appSettings, type Firm } from './schema/index';

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
export function vatPostingContext(firm: Pick<Firm, 'vatRegistered' | 'settings'>, global?: unknown, posPartnerId?: string | null, customerExemptAuto?: string | null): PostingContext {
  const s = (firm.settings ?? {}) as Obj;
  return {
    firm: {
      ...schemeSettingsOf(s),
      ddv: firm.vatRegistered,
      vatInKonto: str(s.vatInKonto),
      posK: str(s.posK),
      posPartnerId: posPartnerId ?? null,
      customerExemptAuto: customerExemptAuto ?? null,
      // numbered schemes „Шема 2, 3 …“ (`firms.settings.schemeProfiles`)
      profiles: schemeProfilesOf(s),
    },
    global: global == null ? null : schemeSettingsOf(global),
  };
}

/**
 * Load the global scheme settings and build the firm's posting context. `posPartnerId` is the "POS терминал"
 * partner set on 12x card lines (bank / fiscal postings).
 */
export async function loadVatPostingContext(tx: Tx, firm: Pick<Firm, 'vatRegistered' | 'settings'> & { id?: string }, posPartnerId?: string | null): Promise<PostingContext> {
  const [g] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
  return vatPostingContext(firm, g?.v ?? null, posPartnerId, await chartHas(tx, firm.id ?? null, CUSTOMER_EXEMPT_KONTO) ? CUSTOMER_EXEMPT_KONTO : null);
}

/** A konto is in the firm's effective chart (`effectiveChart`): a firm row that is not hidden, or a global one not hidden by the firm. */
export async function chartHas(tx: Tx, firmId: string | null, code: string): Promise<boolean> {
  const R = await tx.select({ firmId: accounts.firmId, hidden: accounts.hidden }).from(accounts)
    .where(and(eq(accounts.code, code), firmId ? or(isNull(accounts.firmId), eq(accounts.firmId, firmId)) : isNull(accounts.firmId)));
  const own = R.find((r) => r.firmId != null);
  return own ? !own.hidden : R.some((r) => r.firmId == null);
}
