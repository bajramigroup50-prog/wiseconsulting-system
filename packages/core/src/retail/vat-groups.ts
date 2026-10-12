/**
 * VAT tax-group letters of Macedonian fiscal devices (даночни групи на фискалниот апарат) — the ONE mapping used by the
 * receipt builder (`retail/fiscal` `vatGroup`), the fiscal-report reader (`ai/fisk` `FISK_G0`), the AI prompt for
 * fiscal reports and the desktop device driver (desktop/fiscal/vat-groups.js is a copy, kept equal by a test).
 *
 * Rule: Правилник за техничките и функционалните карактеристики на фискалните системи на опрема, чл. 26 ст. 1, as
 * amended by „Сл. весник на РСМ“ бр. 315/2020 (in force 2021) and supplemented by бр. 60/2022 (14.03.2022):
 *   „А“ — општа даночна стапка 18 %;  „Б“ — повластена стапка 5 %;  „В“ — повластена стапка 10 %;
 *   „Г“ — промет ослободен од ДДВ, and every sale of a taxpayer that is not registered for VAT (0 %).
 * Before that amendment exempt sales were marked „В“; the old WISE program (and older device programming) assumed
 * В = 0 %, Г = 10 % (`FISCAL_VAT_GROUPS_OLD`). A device may still be programmed that way, so the device settings carry
 * a per-device override and the X report's rates are checked against it (`checkVatGroups`).
 */

export type VatGroup = 'А' | 'Б' | 'В' | 'Г';
export type FiscalVatGroups = Readonly<Record<VatGroup, number>>;

export const VAT_GROUP_LETTERS: readonly VatGroup[] = Object.freeze(['А', 'Б', 'В', 'Г'] as const);
/** The VAT rates (%) a device group may carry. */
export const FISCAL_VAT_RATES: readonly number[] = Object.freeze([18, 10, 5, 0]);

/** Legal mapping since the 2020/2022 amendments: А 18 %, Б 5 %, В 10 %, Г 0 % / exempt. */
export const FISCAL_VAT_GROUPS: FiscalVatGroups = Object.freeze({ А: 18, Б: 5, В: 10, Г: 0 });
/** Pre-amendment programming (exempt in В) as the legacy WISE program assumed it: А 18, Б 5, В 0, Г 10. */
export const FISCAL_VAT_GROUPS_OLD: FiscalVatGroups = Object.freeze({ А: 18, Б: 5, В: 0, Г: 10 });

/** Latin look-alikes / transliterations of the letters (A→А, B→Б, V→В, G→Г). */
const LATIN: Readonly<Record<string, VatGroup>> = { A: 'А', B: 'Б', V: 'В', G: 'Г', А: 'А', Б: 'Б', В: 'В', Г: 'Г' };
export const groupLetter = (s: unknown): VatGroup | null => LATIN[String(s ?? '').trim().toUpperCase()] ?? null;

const rateOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 100) / 100;
  return FISCAL_VAT_RATES.includes(r) ? r : null;
};

/**
 * Validates a device mapping (letter → rate). Every letter must carry one of 18 / 10 / 5 / 0 and no two letters the same
 * rate (so a rate maps back to exactly one letter). Missing letters take the legal default. Throws with a Macedonian
 * message on a bad mapping.
 */
export function cleanVatGroups(x: unknown): FiscalVatGroups {
  if (x == null || x === '') return FISCAL_VAT_GROUPS;
  if (typeof x !== 'object') throw new Error('Даночните групи на апаратот не се исправни.');
  const out: Record<VatGroup, number> = { ...FISCAL_VAT_GROUPS };
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const L = groupLetter(k);
    if (!L) throw new Error(`Непозната даночна група „${k}“.`);
    const r = rateOf(v);
    if (r == null) throw new Error(`Даночна група ${L}: стапката мора да е 18, 10, 5 или 0 %.`);
    out[L] = r;
  }
  const seen = new Map<number, VatGroup>();
  for (const L of VAT_GROUP_LETTERS) {
    const p = seen.get(out[L]);
    if (p) throw new Error(`Групите ${p} и ${L} имаат иста стапка ${out[L]} %.`);
    seen.set(out[L], L);
  }
  return Object.freeze(out);
}

/** VAT rate (%) → letter of the device (`groups` = the device's programming; default the legal mapping). */
export function vatGroupFor(rate: number, groups: FiscalVatGroups = FISCAL_VAT_GROUPS): VatGroup {
  const r = Number(rate);
  const hit = VAT_GROUP_LETTERS.find((L) => groups[L] === r);
  if (hit) return hit;
  // an unknown rate goes to the exempt / 0 % group of the device (Г by default)
  return VAT_GROUP_LETTERS.find((L) => groups[L] === 0) ?? 'Г';
}

/** A letter of the legal mapping → the letter of a device programmed with `groups` (same VAT rate). */
export const remapGroup = (L: VatGroup, groups: FiscalVatGroups): VatGroup => vatGroupFor(FISCAL_VAT_GROUPS[L], groups);

/** „А 18 % · Б 5 % · В 10 % · Г 0 %“. */
export const vatGroupsLabel = (g: FiscalVatGroups = FISCAL_VAT_GROUPS): string => VAT_GROUP_LETTERS.map((L) => `${L} ${g[L]} %`).join(' · ');

/** Hint shown after the mismatches of the device's own X report. */
export const VAT_GROUPS_HINT = 'Поправете ги „Даночни групи на апаратот“ (Фискална каса → ⚙️ Фискален апарат) според X извештајот — инаку сметките одат во погрешна ДДВ група.';

/**
 * Rates printed on the device's X / Z report (or read from the device) vs the expected mapping: one line per group
 * that differs (empty = they match). Letters not printed / not in `only` are not checked.
 */
export function checkVatGroups(
  printed: Readonly<Record<string, unknown>> | null | undefined,
  expected: FiscalVatGroups = FISCAL_VAT_GROUPS,
  only?: readonly string[],
): string[] {
  const W: string[] = [];
  for (const [k, v] of Object.entries(printed ?? {})) {
    const L = groupLetter(k);
    if (!L || v == null || v === '' || (only && !only.includes(L))) continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace('%', '').replace(',', '.').trim());
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n - expected[L]) > 0.001) W.push(`Група ${L}: на извештајот ${n} %, очекувано ${expected[L]} %.`);
  }
  return W;
}
