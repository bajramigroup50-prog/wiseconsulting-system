/**
 * PDF / image bank statement read with `BANK_PROMPT` → `Statement` for the normal import pipeline (`planImport` /
 * `saveImport`). Port of the mapping half of legacy `importBankImg` (4796): one line per item with a date and an
 * amount, description = `desc` or „name – purpose“, payment code, reference, denar counter-value with the sign of the
 * amount (`fxItem`), statement number without the year prefix, balances and turnover only for a one-day statement.
 *
 * Legacy stored the printed exchange rate as the day's rate (`izvRate`) when none was set; here it fills the denar
 * counter-value of lines that have none (same amounts; the statement rate itself still comes from the rate list).
 * Account detection (last 10 digits) and the owner check are done by `planImport` like for every other format.
 */
import { stripYearPrefix, type Statement, type StatementLine } from '../bank-parsers';
import { toCents } from '../bank/cents';
import { r2 } from '../money';

export interface ReadStatementItem {
  date?: string; desc?: string; name?: string; purpose?: string; ref?: string; code?: string | number;
  amount?: number | string; amountMkd?: number | string;
}
export interface ReadStatement {
  number?: string | number; totalDebit?: number | string; totalCredit?: number | string; openingBalance?: number | string; closingBalance?: number | string;
  account?: string | number; owner?: string; currency?: string; rate?: number | string; items?: ReadStatementItem[];
}

/** Statement number as legacy `importBankImg` cleaned it (`2026105/1` → `105`). */
export const readStatementNo = (n: unknown): string => stripYearPrefix(String(n ?? '').replace(/[^\d/.-]/g, '').split('/')[0]!);

/** `BANK_PROMPT` reply (object or bare item array) → statement, or null when no line has a date and an amount. */
export function statementFromRead(r: unknown): Statement | null {
  if (!r || typeof r !== 'object') return null;
  const R: ReadStatement = Array.isArray(r) ? { items: r as ReadStatementItem[] } : (r as ReadStatement);
  const rate = +(R.rate ?? 0) || 0;
  const lines: StatementLine[] = [];
  for (const b of R.items ?? []) {
    if (!(b && b.date && +(b.amount ?? 0))) continue;
    const amt = r2(+b.amount!);
    const nm = String(b.name || '').trim(), pu = String(b.purpose || '').trim();
    const mkd = +(b.amountMkd ?? 0) || (rate ? r2(Math.abs(amt) * rate) : 0);
    const code = String(b.code ?? '').trim(), ref = String(b.ref || '').trim();
    lines.push({
      date: String(b.date).slice(0, 10), amount: toCents(amt), counterparty: nm, ref, purpose: pu,
      desc: String(b.desc || '') || [nm, pu].filter(Boolean).join(' – '),
      ...(mkd ? { amountMkd: Math.sign(amt) * Math.abs(toCents(mkd)) } : {}),
      ...(code ? { osnov: code } : {}),
    });
  }
  if (!lines.length) return null;
  const oneDay = new Set(lines.map((l) => l.date)).size === 1;
  const c = (v: unknown) => toCents(+(v ?? 0) || 0);
  const bal = oneDay && (+(R.openingBalance ?? 0) || +(R.closingBalance ?? 0));
  const tot = oneDay && (+(R.totalDebit ?? 0) || +(R.totalCredit ?? 0));
  return {
    format: 'ai', account: String(R.account ?? '').replace(/\D/g, ''), owner: String(R.owner || '').trim(), no: readStatementNo(R.number),
    date: lines.map((l) => l.date).sort().pop()!, currency: String(R.currency || '').trim().toUpperCase(),
    opening: bal ? c(R.openingBalance) : null, closing: bal ? c(R.closingBalance) : null,
    debit: tot ? c(R.totalDebit) : null, credit: tot ? c(R.totalCredit) : null,
    ...(rate > 0 ? { rate } : {}),
    lines,
  };
}
