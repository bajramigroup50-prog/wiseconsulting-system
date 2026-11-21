/**
 * Pure helpers of the nalog grid („Содржина (книжење) на финансов налог“) and the nalog print: the bank konto of a
 * statement shown as ONE line (Должи = Σ приливи, Побарува = Σ одливи, like the old program), the statement line
 * behind a counter line („Бришење (Del)“) and the selection / nalog totals of the footer.
 */

export interface MergeLine { account: string; debit: number; credit: number; partnerId: string | null; note: string | null; currency: string | null; amountCur: number | null; journalId: string }

/**
 * Statement journals (layout `sum`) post the bank konto as two head lines — Σ приливи on Должи and Σ одливи on
 * Побарува. For display they are merged into one line „ИЗВОД БР 30 | 100005 | 100.000,00 | 200.025,00“; the
 * postings (and the kartica) stay as they are. Returns groups of source indexes, one per displayed row.
 */
export function mergeBankHeads<T extends MergeLine>(lines: readonly T[], isBank: (l: T) => boolean, bankKontos: ReadonlySet<string>): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!, b = lines[i + 1];
    if (b && isBank(a) && bankKontos.has(a.account) && a.journalId === b.journalId && a.account === b.account && !a.partnerId && !b.partnerId
      && (a.note ?? '') === (b.note ?? '') && (a.currency ?? '') === (b.currency ?? '')
      && !!a.debit && !a.credit && !b.debit && !!b.credit) {
      out.push([i, i + 1]);
      i++;
    } else out.push([i]);
  }
  return out;
}

/** The statement line behind a counter line of a statement journal (moved to `@wise/core/bank/line-of`). */
export { bankLineOf } from '@wise/core/bank/line-of';

export interface Sums { D: number; P: number; dD: number; dP: number }
/** Σ Должи / Побарува in denars and in foreign currency of the given rows. */
export function sums(rows: readonly { debit: number; credit: number; devD: number; devP: number }[]): Sums {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    D: r2(rows.reduce((s, r) => s + r.debit, 0)), P: r2(rows.reduce((s, r) => s + r.credit, 0)),
    dD: r2(rows.reduce((s, r) => s + r.devD, 0)), dP: r2(rows.reduce((s, r) => s + r.devP, 0)),
  };
}
