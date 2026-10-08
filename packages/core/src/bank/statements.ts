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

/** What a statement file contains (legacy `bkAnalyze` 12727) — shown before importing, to pick the best format per bank. */
export interface StatementAnalysis {
  fmt: string;
  bank: string;
  no: string;
  /** Number of lines; how many carry a counterparty name / a purpose. */
  n: number;
  names: number;
  purp: number;
  bal: boolean;
  mkd: boolean;
  osnov: boolean;
  note: string;
}

const FMT_LBL: Record<string, string> = { mt940: 'MT940', 'halk-xml': 'XML RacunPrivredaIzvod', 'camt.053': 'XML camt.053', kb: 'KBFileFormat', table: 'Табела' };

/** Summarise parsed statements of one file (`kind` from `detectStatementFormat`, `bank` from `bankByText` / IBAN). */
export function analyzeStatements(S: readonly Statement[] | null, kind: string, bank: string, text = ''): StatementAnalysis {
  const R: StatementAnalysis = { fmt: FMT_LBL[kind] ?? kind, bank, no: '', n: 0, names: 0, purp: 0, bal: false, mkd: false, osnov: false, note: '' };
  if (kind === 'ai') return { ...R, fmt: 'PDF / слика', note: 'Се чита со AI при увоз – побавно и ретко може да згреши. Користете го ако банката нема XML.' };
  if (!S || !S.length) return { ...R, fmt: R.fmt + ' (не е препознаено)' };
  const it = S.flatMap((s) => s.lines);
  R.n = it.length;
  R.names = it.filter((l) => String(l.counterparty || '').trim()).length;
  R.purp = it.filter((l) => String(l.purpose || l.desc || '').replace(/^(Налог бр\.|Прилив|Одлив|Реф\.).*$/, '').trim()).length;
  R.no = S[0]!.no;
  R.bal = S.some((s) => s.opening != null || s.closing != null);
  R.mkd = it.some((l) => !!l.amountMkd);
  R.osnov = it.some((l) => !!l.osnov);
  if (kind === 'kb' && !it.length) { R.fmt = 'KBFileFormat – водечки слог (само салда)'; R.note = 'Оваа датотека има само салда – ставките се во „Izvod_stavki…“.'; }
  if (kind === 'mt940' && !/^:86:/m.test(text)) { R.fmt += ' (без :86:)'; R.note = 'Банката не го пополнила полето :86: – нема назив ни цел.'; }
  if (kind === 'table' && R.n && !R.names) R.note = 'Нема колона за назив на комитентот.';
  if (!R.bank) R.bank = S.map((s) => (s.iban || s.account || '').match(/MK\s*\d{2}\s*(\d{3})/i)?.[1] ?? (String(s.account).replace(/\D/g, '').length === 15 ? String(s.account).replace(/\D/g, '').slice(0, 3) : '')).find(Boolean) ?? '';
  return R;
}

/** Legacy `bkScore`: ≥ 4 complete, ≥ 2.5 partial, else weak. */
export function statementScore(R: Pick<StatementAnalysis, 'n' | 'names' | 'purp' | 'bal' | 'no' | 'mkd' | 'osnov' | 'fmt'>): number {
  if (!R.n) return R.fmt.startsWith('PDF') ? 2 : 0;
  const nm = R.names / R.n, pu = R.purp / R.n;
  return (nm >= 0.8 ? 2 : nm > 0 ? 1 : 0) + (pu >= 0.8 ? 1 : 0) + (R.bal ? 1 : 0) + (R.no ? 0.5 : 0) + (R.mkd ? 0.5 : 0) + (R.osnov ? 0.5 : 0);
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
