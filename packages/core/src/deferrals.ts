/**
 * 📆 Временски разграничувања (распоред по месеци). An amount paid or invoiced once for several months — annual
 * insurance, rent paid in advance, a yearly licence, a subscription invoiced to a client for 12 months — is booked
 * first on the deferral konto (19x / 29x), then moved to the cost / revenue of each month:
 *
 *   трошок (однапред платен):     Д трошок (4xxx)   / П 1909 Останати однапред платени трошоци
 *   приход (однапред наплатен):   Д 2930 Однапред наплатени приходи / П приход (7xxx)
 *
 * The amount is split in equal monthly parts in cents; the remainder goes to the last month, so the parts always add
 * up to the total. Each month is one journal (source `deferral` / `<id>:<YYYY-MM>`), re-postable and undoable.
 * Pure: the schedules live in `firms.settings.deferrals`, the db layer posts.
 */
import { r2 } from './money';

export type DeferralKind = 'cost' | 'income';

export interface Deferral {
  id: string;
  name: string;
  kind: DeferralKind;
  /** Total amount in denars. */
  amount: number;
  /** First month `YYYY-MM`. */
  from: string;
  /** Number of months (1–120). */
  months: number;
  /** Cost (4xxx) or revenue (7xxx) konto of each month. */
  konto: string;
  /** Deferral konto (default 1909 for a cost, 2930 for an income). */
  defKonto: string;
  partnerId?: string | null;
  doc?: string | null;
  /** Stopped (contract ended early): no further months are booked. */
  stopped?: boolean;
  createdAt?: string;
}

export const DEFERRAL_KONTO: Record<DeferralKind, string> = { cost: '1909', income: '2930' };
export const DEFERRAL_SOURCE = 'deferral';
export const deferralSourceId = (id: string, ym: string) => `${id}:${ym}`;

export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const ymAdd = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export interface DeferralPart { ym: string; amount: number; no: number }

/** The monthly parts (equal, in cents; the last month takes the remainder). */
export function deferralParts(d: Pick<Deferral, 'amount' | 'from' | 'months'>): DeferralPart[] {
  const n = Math.max(1, Math.floor(d.months));
  const total = Math.round(r2(d.amount) * 100);
  const each = Math.trunc(total / n);
  return Array.from({ length: n }, (_, i) => ({
    ym: ymAdd(d.from, i), no: i + 1,
    amount: (i === n - 1 ? total - each * (n - 1) : each) / 100,
  }));
}

export const deferralTo = (d: Pick<Deferral, 'from' | 'months'>) => ymAdd(d.from, Math.max(1, Math.floor(d.months)) - 1);

export interface DeferralLine { account: string; debit: number; credit: number; partnerId: string | null; note: string; doc: string | null }

/** Journal lines of one month. */
export function deferralLines(d: Deferral, part: DeferralPart): DeferralLine[] {
  const note = `${d.name} – ${part.no}/${d.months} (${part.ym.slice(5)}.${part.ym.slice(0, 4)})`;
  const doc = d.doc || null;
  // the partner goes on the deferral konto only when it is a partner konto; otherwise it is informative and left out
  return d.kind === 'cost'
    ? [
      { account: d.konto, debit: part.amount, credit: 0, partnerId: null, note, doc },
      { account: d.defKonto, debit: 0, credit: part.amount, partnerId: null, note, doc },
    ]
    : [
      { account: d.defKonto, debit: part.amount, credit: 0, partnerId: null, note, doc },
      { account: d.konto, debit: 0, credit: part.amount, partnerId: null, note, doc },
    ];
}

export interface DeferralState {
  d: Deferral;
  parts: (DeferralPart & { posted: boolean })[];
  posted: number;
  /** Amount still on the deferral konto. */
  remaining: number;
  /** Months up to `uptoYm` not yet booked (none when stopped). */
  due: DeferralPart[];
}

/** Which months of each schedule are booked (by source id) and which are due up to `uptoYm`. */
export function deferralState(d: Deferral, postedIds: ReadonlySet<string>, uptoYm: string): DeferralState {
  const parts = deferralParts(d).map((p) => ({ ...p, posted: postedIds.has(deferralSourceId(d.id, p.ym)) }));
  const posted = r2(parts.filter((p) => p.posted).reduce((s, p) => s + p.amount, 0));
  const due = d.stopped ? [] : parts.filter((p) => !p.posted && p.ym <= uptoYm);
  return { d, parts, posted, remaining: r2(r2(d.amount) - posted), due };
}

/** Validation of a schedule entered on the screen; returns the error message or null. */
export function deferralError(d: Partial<Deferral>): string | null {
  if (!d.name?.trim()) return 'Внесете опис (на пр. „Осигурување на возила 2027“).';
  if (d.kind !== 'cost' && d.kind !== 'income') return 'Изберете трошок или приход.';
  if (!(Number(d.amount) > 0)) return 'Износот мора да е поголем од 0.';
  if (!d.from || !YM_RE.test(d.from)) return 'Изберете почетен месец.';
  const n = Number(d.months);
  if (!Number.isInteger(n) || n < 1 || n > 120) return 'Бројот на месеци мора да е од 1 до 120.';
  if (!/^\d{3,10}$/.test(d.konto ?? '')) return d.kind === 'cost' ? 'Внесете конто на трошокот (на пр. 4490).' : 'Внесете конто на приходот (на пр. 7400).';
  if (!/^\d{3,10}$/.test(d.defKonto ?? '')) return 'Внесете конто за разграничување (на пр. 1909 / 2930).';
  if (d.konto === d.defKonto) return 'Контото на трошокот/приходот и контото за разграничување мора да се различни.';
  if (d.kind === 'cost' && !/^4/.test(d.konto!)) return 'Трошокот треба да е на конто од класа 4.';
  if (d.kind === 'income' && !/^7/.test(d.konto!)) return 'Приходот треба да е на конто од класа 7.';
  return null;
}
