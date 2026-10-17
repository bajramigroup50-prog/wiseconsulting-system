/**
 * Numbered posting schemes „Шема 1, 2, 3 …“ (the owner's request, 17.10.2026).
 *
 * - „Шема 1 – основна“ is the firm's effective scheme (firm → office-wide → default, `posting.ts` `schemeRaw`).
 * - „Шема 2“, „Шема 3“ … are stored per firm in `firms.settings.schemeProfiles`: a name and an OVERRIDE map over the same
 *   keys as the scheme editor (only the changed keys; empty = inherit from Шема 1). The method flags (retail / wholesale
 *   at selling prices) are not per scheme — they decide how the stock is valued, which must be one rule per firm.
 * - A document chooses its scheme (`data.scheme`, 1 when missing); the partner card can set a default
 *   (`partners.data.scheme`). Posting: `withSchemeProfile` (posting.ts) + {@link docKontoRemap}.
 *
 * Not to be confused with the „Мои шеми“ (`CustomScheme`, finance.ts): templates for MANUAL journals.
 */
import { SCH0, SCH_EXTRA } from './data/posting';
import { schemeValue, type PostingContext, type SchemeProfileOverrides } from './posting';
import { isAccountCode, isValidVatAccount, validateVatAccountSettings, type VatAccountMap } from './vat';

export interface SchemeProfile extends SchemeProfileOverrides {
  name: string;
  sch?: Record<string, string>;
  updated?: string;
  by?: string;
}

/** Highest scheme number. */
export const MAX_SCHEME_NO = 99;
/** Boolean method flags of the scheme: firm-wide, never per numbered scheme. */
export const SCHEME_PROFILE_FLAGS: readonly string[] = ['retailMethod', 'whSaleMethod'];
/** Scheme keys that hold a VAT konto (validated like the VAT kontos per rate: no summary konto). */
export const SCHEME_VAT_KEYS: readonly string[] = ['r32in', 'r32out'];
/** Keys a numbered scheme may override: every konto key of the scheme (flags excluded). */
export const SCHEME_PROFILE_KEYS: readonly string[] = Object.keys({ ...SCH0, ...SCH_EXTRA }).filter((k) => !SCHEME_PROFILE_FLAGS.includes(k));

/** A scheme number from any input: an integer 1…99, else 1 (Шема 1). */
export function schemeNoOf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 1 && n <= MAX_SCHEME_NO ? n : 1;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const strMap = (v: unknown, keys?: readonly string[]): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v))) {
    if (keys && !keys.includes(k)) continue;
    const s = typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '';
    if (s) o[k] = s;
  }
  return o;
};
const vatMap = (v: unknown): VatAccountMap => strMap(v, ['18', '10', '5']);

/** The numbered schemes of a firm (`firms.settings.schemeProfiles`), cleaned and sorted by number. */
export function schemeProfilesOf(settings: unknown): SchemeProfile[] {
  const raw = obj(settings).schemeProfiles;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: SchemeProfile[] = [];
  for (const r of raw) {
    const o = obj(r);
    const no = schemeNoOf(o.no);
    if (no < 2 || seen.has(no)) continue;
    seen.add(no);
    out.push({
      no, name: String(o.name ?? '').trim().slice(0, 60) || `Шема ${no}`, sch: strMap(o.sch, SCHEME_PROFILE_KEYS),
      vatOut: vatMap(o.vatOut), vatIn: vatMap(o.vatIn), vatImp: vatMap(o.vatImp),
      ...(typeof o.updated === 'string' ? { updated: o.updated } : {}), ...(typeof o.by === 'string' ? { by: o.by } : {}),
    });
  }
  return out.sort((a, b) => a.no - b.no);
}

export const schemeProfileOf = (profiles: readonly SchemeProfile[] | readonly SchemeProfileOverrides[] | null | undefined, no: number) =>
  no > 1 ? (profiles ?? []).find((p) => p.no === no) ?? null : null;

/** Next free number for „+ Нова шема“. */
export const nextSchemeNo = (profiles: readonly { no: number }[]): number => {
  let n = 2;
  while (profiles.some((p) => p.no === n)) n++;
  return n;
};

/** „Шема 1 – основна“, „Шема 2 – Услуги во земјата“. */
export const schemeLabel = (no: number, profiles?: readonly { no: number; name?: string }[] | null): string => {
  if (no <= 1) return 'Шема 1 – основна';
  const p = (profiles ?? []).find((x) => x.no === no);
  return p?.name && p.name !== `Шема ${no}` ? `Шема ${no} – ${p.name}` : `Шема ${no}`;
};
/** Short mark for lists: „Ш2“ (empty for Шема 1). */
export const schemeShort = (no: number | null | undefined): string => (no && no > 1 ? `Ш${no}` : '');

/** Number of overridden kontos of a scheme. */
export const schemeOverrideCount = (p: SchemeProfileOverrides): number =>
  Object.keys(p.sch ?? {}).length + Object.keys(p.vatOut ?? {}).length + Object.keys(p.vatIn ?? {}).length + Object.keys(p.vatImp ?? {}).length;

/**
 * Validate a numbered scheme before saving (shape only — the db side checks the kontos against the chart).
 * Konto: 3–10 digits or „-“ (off); a VAT konto (per rate, art. 32-a) must not be a summary konto and cannot be „-“.
 */
export function validateSchemeProfile(p: { name?: string; sch?: Record<string, unknown> | null; vatOut?: VatAccountMap | null; vatIn?: VatAccountMap | null; vatImp?: VatAccountMap | null }): string[] {
  const errs: string[] = [];
  if (!String(p.name ?? '').trim()) errs.push('Внесете назив на шемата.');
  for (const [k, v0] of Object.entries(p.sch ?? {})) {
    const v = String(v0 ?? '').trim();
    if (!v) continue;
    if (!SCHEME_PROFILE_KEYS.includes(k)) { errs.push(`${k}: не е клуч на шемата`); continue; }
    if (SCHEME_VAT_KEYS.includes(k)) {
      if (!isAccountCode(v)) errs.push(`${k}: „${v}“ не е конто за ДДВ (3–10 цифри)`);
      else if (!isValidVatAccount(v)) errs.push(`${k}: збирното конто ${v} не смее да се користи за ДДВ`);
      continue;
    }
    if (v !== '-' && !isAccountCode(v)) errs.push(`${k}: „${v}“ не е конто (3–10 цифри)`);
  }
  errs.push(...validateVatAccountSettings({ vatOut: p.vatOut, vatIn: p.vatIn, vatImp: p.vatImp }));
  return errs;
}

/** Every konto a scheme refers to (for the chart check). */
export const schemeProfileKontos = (p: SchemeProfileOverrides): string[] => [
  ...Object.values(p.sch ?? {}), ...Object.values(p.vatOut ?? {}), ...Object.values(p.vatIn ?? {}), ...Object.values(p.vatImp ?? {}),
].map((v) => String(v ?? '').trim()).filter((v) => v && v !== '-');

/** Purchase-group kontos that come from the scheme when the purchase is saved (order = priority on equal kontos). */
export const PURCHASE_KONTO_KEYS: readonly string[] = ['purDefault', 'stock', 'material', 'product'];

/**
 * A stored konto under „Шема N“, by konto: the FIRST of `keys` whose Шема 1 value equals the konto owns it; when that
 * key is overridden the konto moves to the profile's value. Every other konto stays.
 */
export function docKontoRemap(base: PostingContext, prof: PostingContext, keys: readonly string[]): (k: string) => string {
  if (base === prof) return (k) => k;
  const M = new Map<string, string>();
  for (const key of keys) {
    const a = schemeValue(base, key);
    if (!a || M.has(a)) continue;
    const b = schemeValue(prof, key);
    M.set(a, b && b !== '-' ? b : a);
  }
  return (k) => M.get(k) ?? k;
}

/**
 * An invoice line's stored revenue konto under „Шема N“. When saved, a line without its own konto got the scheme's
 * revenue konto by item type (`revService` for a service, `revProduct`, `revGoods`, `revDefault` without an article);
 * if that key is overridden in the profile, the line moves to the profile's konto (service on 7400 → 7414). A konto of
 * the article itself or typed by hand stays. The per-rate split (`revByRate`) then runs with the profile's kontos, so
 * an override of `revService_18` alone also works.
 */
export function invoiceLineKonto(base: PostingContext, prof: PostingContext, konto: string, itemType?: string | null): string {
  if (base === prof || !konto) return konto;
  const key = itemType === 'service' ? 'revService' : itemType === 'product' ? 'revProduct' : itemType ? 'revGoods' : 'revDefault';
  if (schemeValue(base, key) !== konto) return konto;
  const b = schemeValue(prof, key);
  return b && b !== '-' ? b : konto;
}

