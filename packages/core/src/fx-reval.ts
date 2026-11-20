/**
 * 💱 Усогласување на девизни сметки со средниот курс (МСС 21 — монетарни ставки во странска валута на крајот на
 * периодот). For every foreign-currency bank account: balance in currency (statement chain) × НБРМ middle rate on the
 * date = what the konto should show in denars; the difference to the ledger balance is booked as an FX difference:
 *
 *   курсот пораснал (средство вреди повеќе):  Д девизна сметка / П 7810 Позитивни курсни разлики
 *   курсот паднал:                            Д 4810 Негативни курсни разлики / П девизна сметка
 *
 * A credit balance in currency (overdraft) works the same way through the signs. Pure: the db layer gathers the inputs.
 */
import { r2 } from './money';

export interface FxRevalInput {
  /** Bank konto (1030…) the account is booked on. */
  konto: string;
  cur: string;
  /** Bank account names on this konto (for the screen). */
  name: string;
  /** Balance in currency at the date (statement chain); null = no statement with a balance up to the date. */
  balCur: number | null;
  /** Ledger balance of the konto in denars (debit − credit) at the date, without this date's own revaluation. */
  balMkd: number;
  /** НБРМ middle rate of `cur` on the date (1 unit = MKD). */
  rate: number;
  /** Set by the db layer when the konto cannot be revalued automatically (shown, not booked). */
  skip?: string;
}

export interface FxRevalRow extends FxRevalInput {
  /** balCur × rate (denars). */
  target: number;
  /** target − balMkd: positive = gain, negative = loss. */
  diff: number;
}

export interface FxRevalLine { account: string; debit: number; credit: number; note: string }

export interface FxRevalPlan {
  rows: FxRevalRow[];
  lines: FxRevalLine[];
  gain: number;
  loss: number;
}

/** Differences under one denar are rounding noise of the statement amounts, not a revaluation. */
export const FX_REVAL_MIN = 1;

export function fxRevalPlan(input: readonly FxRevalInput[], konta: { gain: string; loss: string }): FxRevalPlan {
  const rows: FxRevalRow[] = [];
  const lines: FxRevalLine[] = [];
  let gain = 0, loss = 0;
  for (const x of input) {
    const ok = !x.skip && x.balCur != null && x.rate > 0;
    const target = ok ? r2(x.balCur! * x.rate) : 0;
    const diff = ok ? r2(target - x.balMkd) : 0;
    const row: FxRevalRow = { ...x, target, diff: Math.abs(diff) < FX_REVAL_MIN ? 0 : diff };
    rows.push(row);
    if (!row.diff) continue;
    const note = `${x.cur} ${fmt4(x.balCur!)} × ${x.rate.toFixed(4)}`;
    if (row.diff > 0) {
      gain = r2(gain + row.diff);
      lines.push({ account: x.konto, debit: row.diff, credit: 0, note });
      lines.push({ account: konta.gain, debit: 0, credit: row.diff, note: `Позитивни курсни разлики ${x.cur} (${x.konto})` });
    } else {
      loss = r2(loss - row.diff);
      lines.push({ account: konta.loss, debit: -row.diff, credit: 0, note: `Негативни курсни разлики ${x.cur} (${x.konto})` });
      lines.push({ account: x.konto, debit: 0, credit: -row.diff, note });
    }
  }
  return { rows, lines, gain, loss };
}

const fmt4 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Last day of a month `YYYY-MM`. */
export const monthEnd = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
