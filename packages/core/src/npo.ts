/**
 * Humanitarian associations (НПО) — the records next to „🍲 Корисници и оброци“:
 * - consent for processing personal data per beneficiary (ЗЗЛП — health / social data are a special category);
 * - the register of members and of the members of the organs (Закон за здруженија и фондации — updated at least every
 *   2 years);
 * - the УЈП-ИДС/ПР report on a received donation / sponsorship (Закон за донации и спонзорства во јавните дејности,
 *   чл. 19 — within 30 days of the fulfilment of the contract);
 * - the kitchen stock: a normative per meal kind (items per portion) → the daily consumption, and the report of what was
 *   received / used / left with the real cost per meal.
 * Pure helpers only.
 */
import { MEALS, isMealKind, type MealKind } from './meals';

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const isIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* ================================================================== consent */

/** Beneficiaries without a signed consent (filter of the register). */
export const withoutConsent = <T extends { consentDate?: string | null; active?: boolean }>(B: readonly T[]): T[] => B.filter((b) => !b.consentDate && b.active !== false);

/** How long the association keeps the beneficiaries' data after the aid ends (years), printed on the consent. */
export const CONSENT_KEEP_YEARS = 5;

/* ================================================================== members register */

/** Organs of an association (statute: собрание, управен одбор, надзорен одбор…) and plain membership. */
export const NPO_ORGANS: readonly string[] = ['Собрание', 'Управен одбор', 'Надзорен одбор', 'Претседател', 'Извршен директор / секретар', 'Член'];
export const NPO_ROLES: readonly string[] = ['претседател', 'потпретседател', 'секретар', 'член', 'благајник'];

export interface MemberInput {
  name: string;
  embg?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  joined?: string | null;
  left?: string | null;
  organ?: string | null;
  role?: string | null;
  note?: string | null;
}

/** The register has to be updated at least every 2 years. */
export const MEMBERS_UPDATE_YEARS = 2;

/** Date by which the register must be updated again (last update + 2 years); null when it was never updated. */
export const membersDue = (last: string | null | undefined): string | null =>
  isIso(last) ? `${Number(last.slice(0, 4)) + MEMBERS_UPDATE_YEARS}${last.slice(4)}` : null;

/** `ok` / `soon` (within 60 days) / `late` (older than 2 years) / `never`. */
export function membersState(last: string | null | undefined, today: string): 'ok' | 'soon' | 'late' | 'never' {
  const due = membersDue(last);
  if (!due) return 'never';
  if (due < today) return 'late';
  return addDays(today, 60) >= due ? 'soon' : 'ok';
}

/** Member is active on a day (joined before / on it, not left before it). */
export const memberActive = (m: Pick<MemberInput, 'joined' | 'left'>, day: string): boolean => (!m.joined || m.joined <= day) && (!m.left || m.left >= day);

/** A date typed in Excel (`31.12.2024`, `2024-12-31`, `31/12/2024`, an Excel serial) → ISO, else null. */
export function parseDateCell(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = clean(v);
  if (isIso(s)) return s;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\.?$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return null;
}

function memberKey(h: string): keyof MemberInput | null {
  const x = h.toLowerCase();
  if (/ембг|embg|матичен|numri am/.test(x)) return 'embg';
  if (/име|emri|name|член$|презиме/.test(x)) return 'name';
  if (/адрес|adres|address|живеалиште|vendbanim/.test(x)) return 'address';
  if (/е-?пошта|e-?mail|email|mail/.test(x)) return 'email';
  if (/телефон|tel|phone|kontakt|контакт/.test(x)) return 'phone';
  if (/зачлен|пристап|joined|anëtarësim|anetaresim|од датум|датум на прием/.test(x)) return 'joined';
  if (/исчлен|престан|left|largim|до датум/.test(x)) return 'left';
  if (/орган|organ/.test(x)) return 'organ';
  if (/функци|улога|role|funksion|детал/.test(x)) return 'role';
  if (/забелешк|note|shënim|shenim/.test(x)) return 'note';
  return null;
}

/** Rows of an Excel sheet (`header: 1`) → members; the header row is the first one with a name column. */
export function parseMembers(rows: readonly (readonly unknown[])[]): { list: MemberInput[]; skipped: number } {
  let hi = -1;
  let cols: (keyof MemberInput | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = (rows[i] ?? []).map((v) => memberKey(clean(v)));
    if (c.includes('name')) { hi = i; cols = c; break; }
  }
  if (hi < 0) return { list: [], skipped: 0 };
  const list: MemberInput[] = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const o: Partial<Record<keyof MemberInput, unknown>> = {};
    cols.forEach((k, j) => { if (k && o[k] == null) o[k] = r?.[j]; });
    const name = clean(o.name);
    if (!name) { if ((r ?? []).some((v) => clean(v))) skipped++; continue; }
    const t = (k: keyof MemberInput) => clean(o[k]) || null;
    list.push({
      name, embg: clean(o.embg).replace(/\D/g, '') || null, address: t('address'), phone: t('phone'), email: t('email'),
      joined: parseDateCell(o.joined), left: parseDateCell(o.left), organ: normOrgan(t('organ')), role: t('role')?.toLowerCase() ?? null, note: t('note'),
    });
  }
  return { list, skipped };
}

/** A typed organ → the canonical name when it matches one of `NPO_ORGANS`. */
export function normOrgan(s: string | null | undefined): string | null {
  const x = clean(s).toLowerCase();
  if (!x) return null;
  if (/собрани|kuvend/.test(x)) return 'Собрание';
  if (/управ|bord drejt|drejtues/.test(x)) return 'Управен одбор';
  if (/надзор|mbikëqyr|mbikeqyr/.test(x)) return 'Надзорен одбор';
  if (/претседат|kryetar/.test(x)) return 'Претседател';
  if (/директор|секретар|drejtor|sekretar/.test(x)) return 'Извршен директор / секретар';
  if (/^член|anëtar|anetar/.test(x)) return 'Член';
  return clean(s);
}

/* ================================================================== УЈП-ИДС/ПР */

/** ЗДС чл. 19: the recipient submits the УЈП-ИДС/ПР within 30 days of the fulfilment of the contract. */
export const IDS_DAYS = 30;

/** The fulfilment date of a donation: entered, else the confirmation date. */
export const idsFulfilled = (d: { fulfilledDate?: string | null; confDate?: string | null }): string | null =>
  (isIso(d.fulfilledDate) ? d.fulfilledDate : null) ?? (isIso(d.confDate) ? d.confDate : null);

export const idsDue = (d: { fulfilledDate?: string | null; confDate?: string | null }): string | null => {
  const f = idsFulfilled(d);
  return f ? addDays(f, IDS_DAYS) : null;
};

export type IdsState = 'na' | 'wait' | 'open' | 'soon' | 'late' | 'filed';
/**
 * State of the report: `na` the firm is the donor; `wait` not fulfilled yet; `filed` submitted; `late` past the due
 * date; `soon` due within 7 days; `open` otherwise.
 */
export function idsState(d: { role: string; fulfilledDate?: string | null; confDate?: string | null; idsFiled?: string | null }, today: string): IdsState {
  if (d.role !== 'received') return 'na';
  if (d.idsFiled) return 'filed';
  const due = idsDue(d);
  if (!due) return 'wait';
  if (due < today) return 'late';
  return addDays(today, 7) >= due ? 'soon' : 'open';
}

export const IDS_STATE_LBL: Record<IdsState, string> = {
  na: '', wait: 'чека исполнување', open: 'за поднесување', soon: 'рокот истекува', late: 'задоцнето', filed: 'поднесен',
};

/** What the donation is (section „Опис на донацијата“ of the form). */
export type IdsWhat = 'money' | 'goods' | 'legacy' | 'rights' | 'other';
export const IDS_WHAT: readonly [IdsWhat, string][] = [
  ['money', 'Финансиски средства'], ['goods', 'Добра или услуги'], ['legacy', 'Легати'], ['rights', 'Пренос на други права'], ['other', 'Друго'],
];
export const idsWhatOf = (d: { inKind: boolean }): IdsWhat => (d.inKind ? 'goods' : 'money');

/* ================================================================== kitchen stock */

export interface NormLine { itemId: string; qty: number }
/** Normative per meal kind: items and quantity per ONE portion. */
export type MealNorms = Partial<Record<MealKind, NormLine[]>>;

/** Kitchen settings in `firms.settings.meals`. */
export interface MealStockSettings {
  /** Kitchen warehouse (`codes` row id), empty = the main warehouse. */
  wh?: string | null;
  /** Expense account of the consumption (Д), default 400 on the NPO chart / 4000. */
  konto?: string | null;
  norm?: MealNorms;
  /** Meal kinds the firm serves (`mealKindsOf`); missing = all three. */
  kinds?: MealKind[];
}

/** Clean the normatives typed in the form (positive quantities, one row per item and meal). */
export function cleanNorms(n: unknown): MealNorms {
  const out: MealNorms = {};
  if (!n || typeof n !== 'object') return out;
  for (const [k, L] of Object.entries(n as Record<string, unknown>)) {
    if (!isMealKind(k) || !Array.isArray(L)) continue;
    const M = new Map<string, number>();
    for (const x of L as { itemId?: unknown; qty?: unknown }[]) {
      const id = String(x?.itemId ?? ''), q = Number(String(x?.qty ?? '').replace(',', '.'));
      if (!/^[0-9a-f-]{36}$/i.test(id) || !(q > 0)) continue;
      M.set(id, r4((M.get(id) ?? 0) + q));
    }
    if (M.size) out[k] = [...M].map(([itemId, qty]) => ({ itemId, qty }));
  }
  return out;
}

/** Portions per day and meal kind: a tick of a family = its members (as in the monthly report). */
export function portionsByDay(B: readonly { id: string; members: number }[], L: readonly { beneficiaryId: string; date: string; meal: string }[]): Map<string, Record<MealKind, number>> {
  const mem = new Map(B.map((b) => [b.id, Math.max(1, b.members || 1)]));
  const out = new Map<string, Record<MealKind, number>>();
  for (const x of L) {
    if (!isMealKind(x.meal) || !mem.has(x.beneficiaryId)) continue;
    const p = out.get(x.date) ?? { b: 0, l: 0, d: 0 };
    p[x.meal] += mem.get(x.beneficiaryId)!;
    out.set(x.date, p);
  }
  return out;
}

/** Consumption of one day: Σ over meal kinds of portions × quantity per portion, per item (rounded to 4 decimals). */
export function mealConsumption(portions: Partial<Record<MealKind, number>>, norms: MealNorms): { itemId: string; qty: number }[] {
  const M = new Map<string, number>();
  for (const [k] of MEALS) {
    const p = portions[k] ?? 0;
    if (!p) continue;
    for (const n of norms[k] ?? []) M.set(n.itemId, (M.get(n.itemId) ?? 0) + p * n.qty);
  }
  return [...M].map(([itemId, qty]) => ({ itemId, qty: r4(qty) })).filter((x) => x.qty > 0);
}

/** Consumption lines differ (re-issue needed)? Compares item and quantity, order-free. */
export function consumptionChanged(a: readonly { itemId: string; qty: number }[], b: readonly { itemId: string; qty: number }[]): boolean {
  if (a.length !== b.length) return true;
  const m = new Map(a.map((x) => [x.itemId, r4(x.qty)]));
  return b.some((x) => m.get(x.itemId) !== r4(x.qty));
}

export interface KitchenMove { itemId: string; date: string; qty: number; value: number; sourceType: string }

/**
 * Stock report of the kitchen for a period: per item the opening stock, what was received (purchases, donations…),
 * what the meals used (`meal_issue`), other issues, and the closing stock; and the totals with the real cost per
 * portion = value used by the meals ÷ portions.
 */
export function kitchenReport(moves: readonly KitchenMove[], from: string, to: string, portions: number) {
  const R = new Map<string, { itemId: string; open: number; openV: number; inQ: number; inV: number; donQ: number; donV: number; useQ: number; useV: number; othQ: number; othV: number; close: number; closeV: number }>();
  for (const m of moves) {
    if (m.date > to) continue;
    const r = R.get(m.itemId) ?? { itemId: m.itemId, open: 0, openV: 0, inQ: 0, inV: 0, donQ: 0, donV: 0, useQ: 0, useV: 0, othQ: 0, othV: 0, close: 0, closeV: 0 };
    if (m.date < from) { r.open += m.qty; r.openV += m.value; }
    else if (m.qty > 0) { r.inQ += m.qty; r.inV += m.value; if (m.sourceType === 'don_receipt') { r.donQ += m.qty; r.donV += m.value; } }
    else if (m.sourceType === 'meal_issue') { r.useQ -= m.qty; r.useV -= m.value; }
    else { r.othQ -= m.qty; r.othV -= m.value; }
    r.close += m.qty; r.closeV += m.value;
    R.set(m.itemId, r);
  }
  const rows = [...R.values()].map((r) => ({
    itemId: r.itemId, open: r4(r.open), openV: r2(r.openV), inQ: r4(r.inQ), inV: r2(r.inV), donQ: r4(r.donQ), donV: r2(r.donV),
    useQ: r4(r.useQ), useV: r2(r.useV), othQ: r4(r.othQ), othV: r2(r.othV), close: r4(r.close), closeV: r2(r.closeV),
  }));
  const s = (k: 'openV' | 'inV' | 'donV' | 'useV' | 'othV' | 'closeV') => r2(rows.reduce((a, r) => a + r[k], 0));
  const used = s('useV');
  return { rows, tot: { openV: s('openV'), inV: s('inV'), donV: s('donV'), useV: used, othV: s('othV'), closeV: s('closeV') }, perPortion: portions > 0 ? r2(used / portions) : 0 };
}

/** Next number of a donation receipt `n/yyyy` (ПД = приемница на донација). */
export function nextReceiptNo(existing: readonly { number: string; date: string }[], y: string): string {
  const n = existing.filter((x) => x.date.startsWith(y)).map((x) => parseInt(x.number.replace(/^\D+/, '').split('/')[0] ?? '', 10) || 0);
  return `${Math.max(0, ...n) + 1}/${y}`;
}
