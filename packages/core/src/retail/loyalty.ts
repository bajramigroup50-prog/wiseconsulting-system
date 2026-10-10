/**
 * Loyalty cards and coupons (legacy 9927–9942: `LOY`, `lcFind`, `cpCheck`, `posDisc`, the `posSell` wrapper).
 */
import { num, r2 } from '../stock/num';

export interface LoyaltyRules { per: number; val: number; min: number }
export const LOYALTY_DEFAULTS: LoyaltyRules = { per: 100, val: 1, min: 100 };

export interface LoyaltyCard { id: string; no: string; name: string; phone?: string | null; disc?: number | string | null; points?: number | string | null }
export interface Coupon { id: string; code: string; kind: 'pct' | 'amt'; val: number | string; from?: string | null; to?: string | null; max?: number | null; used?: number | null; minTotal?: number | string | null }

/** Card by number or by the last 8 digits of the phone (legacy `lcFind`). */
export function findCard<C extends LoyaltyCard>(cards: readonly C[], q: string): C | null {
  const s = String(q ?? '').trim();
  if (!s) return null;
  const n = s.replace(/\D/g, '');
  return cards.find((c) => String(c.no) === s || (n.length >= 6 && String(c.phone ?? '').replace(/\D/g, '').endsWith(n.slice(-8)))) ?? null;
}

/** Legacy `cpCheck`: validity window, uses left, minimum total; discount % or a fixed amount (≤ total). */
export function couponCheck<C extends Coupon>(coupons: readonly C[], code: string, total: number, today: string): { err: string } | { c: C; disc: number } {
  const c = coupons.find((x) => String(x.code).toUpperCase() === String(code ?? '').trim().toUpperCase());
  if (!c) return { err: 'Купонот не постои.' };
  const dmy = (d: string) => d.split('-').reverse().join('.');
  if (c.from && today < c.from) return { err: 'Купонот важи од ' + dmy(c.from) + '.' };
  if (c.to && today > c.to) return { err: 'Купонот истече на ' + dmy(c.to) + '.' };
  if (num(c.max) && num(c.used) >= num(c.max)) return { err: 'Купонот е веќе искористен.' };
  if (num(c.minTotal) && total < num(c.minTotal)) return { err: 'Минимален износ ' + num(c.minTotal).toFixed(2) + '.' };
  return { c, disc: r2(c.kind === 'pct' ? (total * num(c.val)) / 100 : Math.min(total, num(c.val))) };
}

export interface PosDiscount { tot: number; disc: number; pay: number; red: number; redPts: number; parts: string[]; err?: string }

/**
 * Legacy `posDisc`: card's permanent discount %, then a coupon on the rest, then redeemed points (only above the
 * minimum, in whole point values, never more than the rest).
 */
export function posDiscount(total: number, a: { card?: LoyaltyCard | null; coupon?: { err: string } | { disc: number; c: Coupon } | null; usePts?: boolean; rules: LoyaltyRules }): PosDiscount {
  const tot = r2(total);
  let disc = 0;
  const parts: string[] = [];
  if (a.card && num(a.card.disc)) {
    const x = r2((tot * num(a.card.disc)) / 100);
    disc += x;
    parts.push('попуст ' + num(a.card.disc) + '% ' + x.toFixed(2));
  }
  let err: string | undefined;
  if (a.coupon) {
    if ('err' in a.coupon) err = a.coupon.err;
    else { disc += a.coupon.disc; parts.push('купон ' + a.coupon.c.code + ' ' + a.coupon.disc.toFixed(2)); }
  }
  let red = 0;
  if (a.card && a.usePts && num(a.card.points) >= a.rules.min && a.rules.val > 0) {
    red = Math.min(r2(num(a.card.points) * a.rules.val), r2(tot - disc));
    red = Math.floor(red / a.rules.val) * a.rules.val;
    disc += red;
    parts.push('поени ' + red.toFixed(2));
  }
  return { tot, disc: r2(disc), pay: r2(tot - disc), red, redPts: a.rules.val ? Math.round(red / a.rules.val) : 0, parts, ...(err ? { err } : {}) };
}

/** Points earned on a paid amount (legacy `Math.floor(pay / per)`). */
export const pointsEarned = (pay: number, rules: LoyaltyRules): number => (rules.per > 0 ? Math.floor(pay / rules.per) : 0);

/** New internal card number `28` + 10 digits of the timestamp (legacy `lcNew`). */
export const newCardNo = (now = Date.now()): string => '28' + String(now).slice(-10);
