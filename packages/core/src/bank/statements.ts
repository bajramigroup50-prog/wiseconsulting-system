/**
 * Statement import helpers (Phase 4): turning a parsed file into per-day statements the way legacy
 * grouped bank rows (`izvKey` = account + date), matching the file to a firm bank account, owner check,
 * duplicate detection. Pure; amounts in cents.
 */
import type { Statement, StatementLine } from '../bank-parsers';
import { bkCore, type BankAccount } from '../bank-match';

export interface StatementDay {
  date: string;
  /** Statement number for this day ('' = assign later). */
  no: string;
  /** Opening / closing balance in the statement currency (cents), null when unknown. */
  opening: number | null;
  closing: number | null;
  lines: StatementLine[];
}

/**
 * Split a parsed statement into one statement per booking date (legacy: one izvod per account and day).
 * Balances: with an opening balance each day opens with the previous day's closing; with only a closing
 * balance the opening is derived backwards. The file's statement number goes to its last day (where
 * legacy keyed balances, `ensureIzvNos` FIX #12); KB files carry a number per line.
 */
export function splitStatementByDate(st: Statement): StatementDay[] {
  const by = new Map<string, StatementLine[]>();
  for (const l of st.lines) {
    const d = l.date || st.date;
    if (!d) continue;
    (by.get(d) ?? by.set(d, []).get(d)!).push(l);
  }
  const dates = [...by.keys()].sort();
  const sum = (L: StatementLine[]) => L.reduce((s, l) => s + l.amount, 0);
  let open: number | null = st.opening;
  if (open == null && st.closing != null) open = st.closing - st.lines.reduce((s, l) => s + l.amount, 0);
  const out: StatementDay[] = [];
  dates.forEach((d, i) => {
    const L = by.get(d)!;
    const close: number | null = open == null ? null : open + sum(L);
    const lineNo = L.find((l) => l.stmtNo)?.stmtNo;
    out.push({ date: d, no: lineNo || (i === dates.length - 1 ? st.no : ''), opening: open, closing: close, lines: L });
    open = close;
  });
  return out;
}

const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** The firm bank account a statement belongs to: by IBAN / account number (last 10 digits). */
export function statementAccount<T extends Pick<BankAccount, 'id' | 'account'> & { iban?: string | null; cur?: string }>(st: Pick<Statement, 'account' | 'iban' | 'currency'>, accounts: readonly T[]): T | null {
  const keys = [dig(st.iban), dig(st.account)].filter((x) => x.length >= 10).map((x) => x.slice(-10));
  if (!keys.length) return null;
  const hits = accounts.filter((a) => [dig(a.account), dig(a.iban)].some((x) => x.length >= 10 && keys.includes(x.slice(-10))));
  if (hits.length <= 1) return hits[0] ?? null;
  return hits.find((a) => (a.cur || 'MKD') === (st.currency || 'MKD')) ?? hits[0]!;
}

/**
 * Legacy `ownerCheck` (12888): the statement names a different company than the firm → warn before
 * importing into the wrong firm. `true` only when both names are known and clearly different.
 */
export function statementOwnerMismatch(owner: string | undefined, firmName: string): boolean {
  const a = bkCore(owner), b = bkCore(firmName);
  if (a.length < 4 || b.length < 4) return false;
  return !(a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a));
}
