/** Typed konto checks for the line forms (pure, client-safe): parent, „+ Ново конто“, a synthetic with analytics. */
import { NEW_ACCOUNT_CODE_RE } from './ledger-codes';


/** The nearest existing parent of a konto in the chart (the longest shorter prefix of ≥ 3 digits), or null. */
export function kontoParent<A extends { code: string; name: string }>(chart: readonly A[], code: string): A | null {
  const c = String(code ?? '').trim();
  for (let n = c.length - 1; n >= 3; n--) {
    const p = chart.find((a) => a.code === c.slice(0, n));
    if (p) return p;
  }
  return null;
}

export type KontoHint<A> =
  | { kind: 'empty' }
  | { kind: 'ok'; acc: A }
  /** In the chart, but analytics exist under it — book on an analytic. */
  | { kind: 'synthetic'; acc: A; analytics: A[] }
  /** Not in the chart; can be created under `parent`. */
  | { kind: 'new'; parent: A }
  | { kind: 'missing'; error: string };

/**
 * What a typed konto is (bank line forms): fine, a synthetic with analytics under it („синтетичко конто – изберете
 * аналитика (10301 …)“), a new konto that can be created under its parent, or missing (cannot be created).
 */
export function kontoHint<A extends { code: string; name: string }>(chart: readonly A[], code: string): KontoHint<A> {
  const c = String(code ?? '').trim().split(/\s/)[0] ?? '';
  if (!c) return { kind: 'empty' };
  const acc = chart.find((a) => a.code === c);
  if (acc) {
    const analytics = chart.filter((a) => a.code.length > c.length && a.code.startsWith(c));
    return analytics.length ? { kind: 'synthetic', acc, analytics } : { kind: 'ok', acc };
  }
  const chk = newKontoCheck(chart, c);
  return 'error' in chk ? { kind: 'missing', error: chk.error } : { kind: 'new', parent: chk.parent };
}

/**
 * A konto typed where it does not exist yet (e.g. the bank line form „+ Ново конто“): the chart editor's rules —
 * 4–8 digits (a booking konto, not a group / synthetic of 3), not already in the chart, and its parent synthetic must
 * exist. Returns the parent (its name is the default name) or the error.
 */
export function newKontoCheck<A extends { code: string; name: string }>(chart: readonly A[], code: string): { parent: A } | { error: string } {
  const c = String(code ?? '').trim();
  if (!/^\d{4,8}$/.test(c) || !NEW_ACCOUNT_CODE_RE.test(c)) return { error: 'Новото конто мора да има 4–8 цифри.' };
  if (chart.some((a) => a.code === c)) return { error: `Контото ${c} веќе постои.` };
  const parent = kontoParent(chart, c);
  if (!parent) return { error: `Нема синтетичко конто над ${c} (${c.slice(0, 3)}) во контниот план – прво отворете го.` };
  return { parent };
}
