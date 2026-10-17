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

/**
 * The statement line behind a counter line of a statement journal: same amount and side, same partner, same konto
 * (own or effective) — the first such line. Head lines on the bank konto are automatic and have no single source.
 */
export function bankLineOf<T extends { id: string; amount: number; partnerId: string | null; konto: string }>(
  jl: { account: string; debit: number; credit: number; partnerId: string | null }, lines: readonly T[], bankKonto: string,
): T | { error: string } {
  if (jl.account === bankKonto) return { error: `Банкарското конто ${bankKonto} се книжи автоматски (збир на изводот) – избришете ја ставката од изводот.` };
  // counter Побарува = прилив (+), counter Должи = одлив (−)
  const a = Math.round((jl.credit - jl.debit) * 100);
  const same = lines.filter((l) => Math.round(l.amount * 100) === a && (l.partnerId ?? null) === (jl.partnerId ?? null));
  const hit = same.find((l) => l.konto === jl.account) ?? (same.length === 1 ? same[0] : undefined);
  return hit ?? { error: 'Ставката на изводот не е пронајдена (поделена или поврзана ставка) – избришете ја во „Изводи во налогот“.' };
}

export interface Sums { D: number; P: number; dD: number; dP: number }
/** Σ Должи / Побарува in denars and in foreign currency of the given rows. */
export function sums(rows: readonly { debit: number; credit: number; devD: number; devP: number }[]): Sums {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    D: r2(rows.reduce((s, r) => s + r.debit, 0)), P: r2(rows.reduce((s, r) => s + r.credit, 0)),
    dD: r2(rows.reduce((s, r) => s + r.devD, 0)), dP: r2(rows.reduce((s, r) => s + r.devP, 0)),
  };
}
