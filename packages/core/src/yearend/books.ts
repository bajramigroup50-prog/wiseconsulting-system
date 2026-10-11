/**
 * Simple-bookkeeping books from the ledger:
 *  - NPO (legacy `VIEWS.zsNPO` tabs `db` / `small` 10468–10474): ДБ-НП rows 01–04, Книга на приходи и расходи,
 *    Книга за благајна, the „small NPO“ (< 2.500 €) test;
 *  - sole trader / self-employed (legacy `tpBookHTML` 10512–10515): КП, КТ, КО, КПС.
 */
import type { LedgerLine } from '../ledger';
import { yeSumPref, type YeBalances } from './balances';

const r2 = (v: number) => Math.round(v * 100) / 100;
const byDate = (a: LedgerLine, b: LedgerLine) => String(a.date).localeCompare(String(b.date));
const docOf = (l: LedgerLine) => l.number || l.doc || l.sourceType || '';

/** ДБ-НП/ВП rows 01–04 (credit-side sums of the balances without the close). `co` = the firm uses the company chart. */
export function npoDbRows(B: YeBalances, co: boolean): [string, string, number][] {
  const r = (k: string) => r2(yeSumPref(B, k.split(','), -1));
  return [
    ['01', 'Приходи од продажба на производи / стоки', r(co ? '73,740,741,742,743,744,748,749,710' : '710')],
    ['02', 'Приходи од услуги', r('715')],
    ['03', 'Кирии и закупнини', r(co ? '747' : '740')],
    ['04', 'Сопствени приходи', co ? 0 : r('750')],
  ];
}

export interface BookRow { no: number; date: string; doc: string; text: string; inc: number; exp: number }

/** Книга на приходи и расходи: lines on classes 4 / 7 without open / close, by date. */
export function npoIncomeBook(lines: readonly LedgerLine[], names: Readonly<Record<string, string>>): BookRow[] {
  return lines.filter((l) => l.kind !== 'close' && l.kind !== 'open' && /^[47]/.test(l.account)).slice().sort(byDate).map((l, i) => ({
    no: i + 1, date: l.date, doc: docOf(l), text: l.note || l.description || names[l.account] || l.account,
    inc: /^7/.test(l.account) ? r2((+l.credit || 0) - (+l.debit || 0)) : 0,
    exp: /^4/.test(l.account) ? r2((+l.debit || 0) - (+l.credit || 0)) : 0,
  }));
}

export interface CashRow { date: string; doc: string; text: string; inn: number; out: number; bal: number }

/** Книга за благајна: lines on 101* (or the cash scheme konto) with a running balance. */
export function cashBook(lines: readonly LedgerLine[], cashKonto = '101'): CashRow[] {
  let bal = 0;
  return lines.filter((l) => l.account.startsWith('101') || l.account === cashKonto).slice().sort(byDate).map((l) => {
    bal = r2(bal + (+l.debit || 0) - (+l.credit || 0));
    return { date: l.date, doc: docOf(l), text: l.note || l.description || '', inn: +l.debit || 0, out: +l.credit || 0, bal };
  });
}

/** Legacy: small NPO when max(income, assets 042) < 2.500 € × rate. */
export const npoSmall = (inc: number, assets: number, eur = 61.5): boolean => Math.max(inc, assets) < 2500 * eur;

export interface TpBookRow { no: number; date: string; doc: string; who: string; konto: string; amt: number }

/** КП (class 7, credit − debit) / КТ (class 4, debit − credit) without open / close, by date. */
export function tpBook(kind: 'kp' | 'kt', lines: readonly LedgerLine[], names: Readonly<Record<string, string>>, partners: Readonly<Record<string, string>> = {}): TpBookRow[] {
  const cls = kind === 'kp' ? '7' : '4';
  return lines.filter((l) => l.kind !== 'close' && l.kind !== 'open' && l.account.startsWith(cls)).slice().sort(byDate).map((l, i) => ({
    no: i + 1, date: l.date, doc: docOf(l),
    who: [l.partnerId ? partners[l.partnerId] ?? '' : '', l.note || l.description || ''].filter(Boolean).join(' · '),
    konto: `${l.account} ${names[l.account] ?? ''}`.trim(),
    amt: kind === 'kp' ? r2((+l.credit || 0) - (+l.debit || 0)) : r2((+l.debit || 0) - (+l.credit || 0)),
  }));
}

/** КПС: balances of classes 1 / 2 over the whole ledger (|s| > 0.004). */
export function tpKps(lines: readonly LedgerLine[], names: Readonly<Record<string, string>>): { k: string; n: string; d: number; p: number; s: number }[] {
  const by: Record<string, { d: number; p: number }> = {};
  for (const l of lines) {
    if (!/^[12]/.test(l.account)) continue;
    const x = (by[l.account] ??= { d: 0, p: 0 });
    x.d += +l.debit || 0; x.p += +l.credit || 0;
  }
  return Object.entries(by).map(([k, v]) => ({ k, n: names[k] ?? '', d: r2(v.d), p: r2(v.p), s: r2(v.d - v.p) })).filter((x) => Math.abs(x.s) > 0.004).sort((a, b) => a.k.localeCompare(b.k));
}
