/**
 * „🍲 Корисници и оброци“ (module `meals`): a humanitarian association (народна кујна) keeps a register of the families /
 * persons it feeds and, every day, ticks who came and which of the three meals they took. Pure helpers: the meal kinds,
 * reading the association's own Excel register, and the monthly totals for the printed list.
 */

export const MEALS = [
  ['b', 'Појадок'],
  ['l', 'Ручек'],
  ['d', 'Вечера'],
] as const;
export type MealKind = (typeof MEALS)[number][0];
export const isMealKind = (k: unknown): k is MealKind => k === 'b' || k === 'l' || k === 'd';
export const mealName = (k: string): string => MEALS.find((m) => m[0] === k)?.[1] ?? k;

/** One family / person of the register (as imported or typed in). */
export interface BeneficiaryInput {
  no?: number | null;
  name: string;
  members: number;
  nationality?: string | null;
  note?: string | null;
  embg?: string | null;
  place?: string | null;
  phone?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Column of a header cell (Albanian / Macedonian / English headers of the association's register). */
function headerKey(h: string): keyof BeneficiaryInput | null {
  const x = h.toLowerCase();
  if (/^nr\.?$|^бр\.?$|^р\.?\s*бр|^no\.?$/.test(x)) return 'no';
  if (/emri|име|презиме|name|корисник|familj/.test(x)) return 'name';
  if (/anëtar|anetar|членов|members|број на чл/.test(x)) return 'members';
  if (/nacional|националн/.test(x)) return 'nationality';
  if (/numri am|ембг|embg|матичен/.test(x)) return 'embg';
  if (/vendbanim|место|населба|адреса|adres|place/.test(x)) return 'place';
  if (/kontakt|телефон|tel|phone|контакт/.test(x)) return 'phone';
  if (/përshkrim|pershkrim|gjendj|опис|состојба|забелешка|note/.test(x)) return 'note';
  return null;
}

/**
 * Rows of the register sheet (`header: 1` arrays) → beneficiaries. The header row is the first row that has a name
 * column; empty rows (a number and nothing else) are skipped; the members count defaults to 1.
 */
export function parseRegister(rows: readonly (readonly unknown[])[]): { list: BeneficiaryInput[]; skipped: number } {
  let hi = -1;
  let cols: (keyof BeneficiaryInput | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = (rows[i] ?? []).map((v) => headerKey(clean(v)));
    if (c.includes('name')) { hi = i; cols = c; break; }
  }
  if (hi < 0) return { list: [], skipped: 0 };
  const list: BeneficiaryInput[] = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const o: Record<string, string> = {};
    cols.forEach((k, j) => { if (k && o[k] == null) o[k] = clean(r?.[j]); });
    if (!o.name) { if ((r ?? []).some((v) => clean(v))) skipped++; continue; }
    const m = Number(String(o.members ?? '').replace(',', '.'));
    const no = Number(o.no);
    list.push({
      no: Number.isFinite(no) && no > 0 ? Math.round(no) : null,
      name: o.name,
      members: Number.isFinite(m) && m >= 1 ? Math.round(m) : 1,
      nationality: o.nationality || null,
      note: o.note || null,
      embg: (o.embg ?? '').replace(/\D/g, '') || null,
      place: o.place || null,
      phone: o.phone || null,
    });
  }
  return { list, skipped };
}

/** Same person twice? (ЕМБГ when both have one, else the name without case / extra spaces). */
export const sameBeneficiary = (a: Pick<BeneficiaryInput, 'name' | 'embg'>, b: Pick<BeneficiaryInput, 'name' | 'embg'>): boolean =>
  a.embg && b.embg ? a.embg === b.embg : clean(a.name).toLowerCase() === clean(b.name).toLowerCase();

/** Days of a month `YYYY-MM` as ISO dates. */
export function monthDays(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return [];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

export interface MealLog { beneficiaryId: string; date: string; meal: string }

/**
 * Monthly totals for the printed list: per beneficiary the days they came and the meals per kind, and the totals
 * (meals, portions = meals × members of the family, days with at least one meal).
 */
export function monthSummary(B: readonly { id: string; members: number }[], L: readonly MealLog[]) {
  const per = new Map<string, { days: Set<string>; b: number; l: number; d: number; portions: number }>();
  const mem = new Map(B.map((x) => [x.id, Math.max(1, x.members || 1)]));
  for (const x of L) {
    if (!mem.has(x.beneficiaryId) || !isMealKind(x.meal)) continue;
    const p = per.get(x.beneficiaryId) ?? { days: new Set<string>(), b: 0, l: 0, d: 0, portions: 0 };
    p.days.add(x.date);
    p[x.meal]++;
    p.portions += mem.get(x.beneficiaryId)!;
    per.set(x.beneficiaryId, p);
  }
  const rows = B.map((x) => {
    const p = per.get(x.id);
    return { id: x.id, days: p?.days.size ?? 0, b: p?.b ?? 0, l: p?.l ?? 0, d: p?.d ?? 0, meals: (p?.b ?? 0) + (p?.l ?? 0) + (p?.d ?? 0), portions: p?.portions ?? 0 };
  });
  const tot = rows.reduce((s, r) => ({ b: s.b + r.b, l: s.l + r.l, d: s.d + r.d, meals: s.meals + r.meals, portions: s.portions + r.portions, served: s.served + (r.meals ? 1 : 0) }), { b: 0, l: 0, d: 0, meals: 0, portions: 0, served: 0 });
  return { rows, tot };
}

/** Cost of one portion for the month (food cost ÷ portions), 0 when nothing was served. */
export const costPerPortion = (cost: number, portions: number): number => (portions > 0 ? Math.round((cost / portions) * 100) / 100 : 0);

/**
 * Summary of the register (always shown in the report, also before any meal is ticked): families / persons, members,
 * breakdown by place and by nationality (largest first, „—“ = not entered), and how many have a phone / ЕМБГ / consent.
 */
export function registerSummary(B: readonly { members: number; place?: string | null; nationality?: string | null; phone?: string | null; embg?: string | null; consentDate?: string | null }[]) {
  const group = (k: (b: (typeof B)[number]) => string | null | undefined) => {
    const M = new Map<string, { n: number; members: number }>();
    for (const b of B) {
      const key = clean(k(b)) || '—';
      const x = M.get(key) ?? { n: 0, members: 0 };
      x.n++; x.members += Math.max(1, b.members || 1);
      M.set(key, x);
    }
    return [...M].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'mk'));
  };
  return {
    families: B.length,
    members: B.reduce((s, b) => s + Math.max(1, b.members || 1), 0),
    byPlace: group((b) => b.place),
    byNat: group((b) => b.nationality),
    phone: B.filter((b) => clean(b.phone)).length,
    embg: B.filter((b) => clean(b.embg)).length,
    consent: B.filter((b) => b.consentDate).length,
  };
}
