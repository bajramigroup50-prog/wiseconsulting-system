/**
 * „Аналитика“ (old desktop program: Аналитика → Избор на конто за аналитика → комитенти на контото → картица) — the pure
 * part, shared by the screen (`app/(app)/akart`), its keyboard component and the tests:
 *
 * - konto list with turnover in the period (as the `kartici` picker), search that filters and jumps („2200“);
 * - partner konto detection (120–128 / 220–228, 1620 / 2620, or any konto that has partner lines);
 * - partner list of one konto: Должи / Побарува / Салдо, Салдо ПС, доспеан износ and days late (open items FIFO),
 *   filter Активни (with balance) / Пасивни (zero balance) / Сите;
 * - previous / next partner of the list (F4 / F5 on the card);
 * - the card in foreign currency (Девизна / Денарско-девизна).
 */
import { r2 } from '@wise/core/money';
import { cardSort, daysLate, type CardSort } from '@wise/core/finance';
import { akMatch, akSearchText } from './akart-match';

export { akMatch, akSearchText };

export type AkMode = 'd' | 'v' | 'dv';
export const akMode = (v: unknown): AkMode => (v === 'v' || v === 'dv' ? v : 'd');
export const AK_MODE_LABEL: Record<AkMode, string> = { d: 'денарска', v: 'девизна', dv: 'денарско-девизна' };

export type AkFilter = 'a' | 'p' | 's';
export const akFilter = (v: unknown): AkFilter => (v === 'p' || v === 's' ? v : 'a');

/* ---------------------------------------------------------------- konto list */

export interface AkKontoRow { c: string; n: string; d: number; p: number }

/** Konto list (legacy picker): every chart konto with the turnover of its sub-kontos; analytic kontos not in the chart too. */
export function kontoRows(lines: readonly { account: string; debit: number; credit: number; kind?: string | null }[], chart: readonly { code: string; name: string }[], o: { post?: boolean } = {}): AkKontoRow[] {
  const B = new Map<string, { d: number; p: number }>();
  for (const l of lines) {
    if (l.kind === 'close') continue;
    const b = B.get(l.account) ?? { d: 0, p: 0 };
    b.d += +l.debit || 0; b.p += +l.credit || 0;
    B.set(l.account, b);
  }
  const BK = [...B.entries()];
  const rows: AkKontoRow[] = chart.map((a) => {
    const pr = BK.filter(([x]) => x.startsWith(a.code));
    return { c: a.code, n: a.name, d: r2(pr.reduce((t, [, b]) => t + b.d, 0)), p: r2(pr.reduce((t, [, b]) => t + b.p, 0)) };
  });
  const codes = new Set(chart.map((a) => a.code));
  for (const [x, b] of BK) if (!codes.has(x)) rows.push({ c: x, n: '(аналитика)', d: r2(b.d), p: r2(b.p) });
  rows.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
  return o.post ? rows.filter((r) => r.d || r.p) : rows;
}

/** Konto list filtered by the search box. */
export const filterKontos = (rows: readonly AkKontoRow[], q: string) => rows.filter((r) => akMatch(r.c, akSearchText(r.c, r.n), q));

/** Where the search jumps: the exact code, else the first row that matches (−1 = none). */
export function jumpIndex(rows: readonly { c: string; n: string }[], q: string): number {
  const s = q.trim();
  if (!s) return -1;
  const i = rows.findIndex((r) => r.c === s);
  return i >= 0 ? i : rows.findIndex((r) => akMatch(r.c, akSearchText(r.c, r.n), s));
}

/* ---------------------------------------------------------------- partner kontos */

/** Kontos whose card goes through the partner list: customers / suppliers, loans, or any konto with partner lines. */
export const PARTNER_KONTO = /^(12[0-8]|22[0-8]|1620|2620)/;
export function isPartnerKonto(k: string, lines: readonly { account: string; partnerId?: string | null }[] = []): boolean {
  return PARTNER_KONTO.test(k) || lines.some((l) => !!l.partnerId && l.account.startsWith(k));
}

/* ---------------------------------------------------------------- partner list */

export interface AkLine {
  account: string; debit: number; credit: number; date: string; partnerId?: string | null; kind?: string | null;
  due?: string | null; number?: string | null;
}
export interface AkPartnerInfo { id: string; code?: string | null; name: string; edb?: string | null; embs?: string | null; address?: string | null; city?: string | null; bankAccount?: string | null; data?: unknown }
export interface AkPartnerRow {
  id: string; code: string; name: string; d: number; p: number; s: number;
  /** Доспеан износ (open, due on `asOf` or earlier) and the days late of the oldest such item. */
  over: number; late: number;
  /** Салдо ПС: opening journal + lines before `from`. */
  ps: number;
  extra: string; bank: string; city: string; ids: string; address: string;
}

/**
 * Open items of one partner on one konto, FIFO: the items are the lines on the konto's natural side (debit for
 * classes 0/1 and other asset kontos, credit for 2 — liabilities), the other side pays the oldest first. An item is
 * due on its document's due date (else the booking date). Returns the overdue amount and the days late of the oldest.
 */
export function overdue(lines: readonly AkLine[], k: string, asOf: string): { over: number; late: number; open: number } {
  const liab = k.startsWith('2');
  const items: { amt: number; due: string }[] = [];
  let pay = 0;
  const L = [...lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const l of L) {
    if (l.date > asOf) continue;
    const plus = liab ? +l.credit || 0 : +l.debit || 0;
    const minus = liab ? +l.debit || 0 : +l.credit || 0;
    // red storno on the item side reduces the items; on the paying side it reduces payments
    if (plus > 0) items.push({ amt: plus, due: l.due || l.date }); else if (plus < 0) pay += -plus;
    if (minus > 0) pay += minus; else if (minus < 0) items.push({ amt: -minus, due: l.due || l.date });
  }
  for (const it of items) { const t = Math.min(it.amt, pay); it.amt = r2(it.amt - t); pay = r2(pay - t); if (pay <= 0) break; }
  const open = items.filter((x) => x.amt > 0.004);
  const od = open.filter((x) => x.due <= asOf);
  return {
    open: r2(open.reduce((a, x) => a + x.amt, 0)),
    over: r2(od.reduce((a, x) => a + x.amt, 0)),
    late: od.length ? Math.max(0, ...od.map((x) => daysLate(x.due, asOf))) : 0,
  };
}

const extraName = (p: AkPartnerInfo) => {
  const d = (p.data ?? {}) as Record<string, unknown>;
  return String(d.name2 ?? d.fullName ?? d.dopNaziv ?? '').trim();
};

/**
 * Partner list of konto `k` (lines of the year up to `to`, already limited to the konto): per partner turnover up to
 * `to`, balance, opening, overdue on `asOf`. Sorted by name; `flt` a = with balance, p = zero balance, s = all; `q`
 * searches name, code, ЕДБ, ЕМБС, city.
 */
export function partnerRows(lines: readonly AkLine[], P: ReadonlyMap<string, AkPartnerInfo>, o: { k: string; from: string; to: string; asOf: string; flt?: AkFilter; q?: string }): AkPartnerRow[] {
  const by = new Map<string, AkLine[]>();
  for (const l of lines) {
    if (!l.partnerId || l.date > o.to || !l.account.startsWith(o.k)) continue;
    const a = by.get(l.partnerId) ?? [];
    a.push(l);
    by.set(l.partnerId, a);
  }
  let rows: AkPartnerRow[] = [...by].map(([id, L]) => {
    const p = P.get(id);
    const d = r2(L.reduce((a, l) => a + (+l.debit || 0), 0)), c = r2(L.reduce((a, l) => a + (+l.credit || 0), 0));
    const ps = r2(L.filter((l) => l.kind === 'open' || l.date < o.from).reduce((a, l) => a + (+l.debit || 0) - (+l.credit || 0), 0));
    const od = overdue(L, o.k, o.asOf < o.to ? o.asOf : o.to);
    return {
      id, code: p?.code ?? '', name: p?.name ?? '—', d, p: c, s: r2(d - c), over: od.over, late: od.late, ps,
      extra: p ? extraName(p) : '', bank: p?.bankAccount ?? '', city: p?.city ?? '', address: p?.address ?? '',
      ids: [p?.edb, p?.embs].filter(Boolean).join(' / '),
    };
  });
  const f = o.flt ?? 'a';
  if (f === 'a') rows = rows.filter((r) => Math.abs(r.s) > 0.009);
  if (f === 'p') rows = rows.filter((r) => Math.abs(r.s) <= 0.009);
  if (o.q?.trim()) rows = rows.filter((r) => akMatch(r.code, akSearchText(r.code, r.name, r.ids, r.city, r.extra), o.q!, true));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'mk') || a.code.localeCompare(b.code));
}

export function partnerTotals(rows: readonly AkPartnerRow[]) {
  const s = (f: 'd' | 'p' | 's' | 'over' | 'ps') => r2(rows.reduce((a, r) => a + r[f], 0));
  return { d: s('d'), p: s('p'), s: s('s'), over: s('over'), ps: s('ps') };
}

/** Previous / next partner of the list (F4 / F5 on the card); null at the ends. */
export function neighbours<T extends { id: string }>(rows: readonly T[], id: string): { i: number; prev: T | null; next: T | null } {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return { i, prev: null, next: rows[0] ?? null };
  return { i, prev: rows[i - 1] ?? null, next: rows[i + 1] ?? null };
}

/* ---------------------------------------------------------------- the card */

export interface AkCardRow<L> { line: L; balance: number }

/** Sort the card by nalog or date (old program „Сортирање по Налог / Датум“) and recompute the running balance. */
export function sortCard<L extends { date: string; number?: string | null; debit: number; credit: number }>(rows: readonly AkCardRow<L>[], opening: number, sort: CardSort): AkCardRow<L>[] {
  if (sort !== 'nal') return [...rows];
  let s = opening;
  return cardSort(rows.map((r) => ({ ...r })), 'nal').map((r) => { s = r2(s + (+r.line.debit || 0) - (+r.line.credit || 0)); return { ...r, balance: s }; });
}

/** Foreign-currency amount of a line, signed like the denar side (debit +, credit −); null when the line has none. */
export function curAmount(l: { debit: number; credit: number; currency?: string | null; amountCur?: number | string | null }): number | null {
  if (!l.currency || l.amountCur == null || l.amountCur === '') return null;
  const a = Math.abs(Number(l.amountCur) || 0);
  return (+l.debit || 0) - (+l.credit || 0) < 0 ? -a : a;
}

/** Running foreign saldo per currency (Девизна картица); lines without currency keep the previous value. */
export function curRunning(lines: readonly { debit: number; credit: number; currency?: string | null; amountCur?: number | string | null }[]): { cur: string; amt: number | null; s: number | null }[] {
  const S = new Map<string, number>();
  return lines.map((l) => {
    const a = curAmount(l);
    if (a == null) return { cur: '', amt: null, s: null };
    const c = l.currency!.toUpperCase();
    const s = r2((S.get(c) ?? 0) + a);
    S.set(c, s);
    return { cur: c, amt: a, s };
  });
}

/**
 * „Групно по изводи“: consecutive lines of one bank statement (same nalog, source bank_statement / kind bank) become
 * one row — the sum of the statement and the balance after it (`n` = how many lines were merged; 0 = not a statement).
 */
export function groupByStatement<L extends { journalId?: string | null; sourceType?: string | null; kind?: string | null; debit: number; credit: number }>(rows: readonly AkCardRow<L>[]): (AkCardRow<L> & { n: number })[] {
  const out: (AkCardRow<L> & { n: number })[] = [];
  for (const r of rows) {
    const bank = r.line.sourceType === 'bank_statement' || r.line.kind === 'bank';
    const last = out[out.length - 1];
    if (bank && last && last.n > 0 && last.line.journalId && last.line.journalId === r.line.journalId) {
      last.line = { ...last.line, debit: r2(last.line.debit + r.line.debit), credit: r2(last.line.credit + r.line.credit) };
      last.balance = r.balance;
      last.n++;
    } else out.push({ ...r, line: { ...r.line }, n: bank ? 1 : 0 });
  }
  return out;
}
