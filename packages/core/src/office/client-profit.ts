/**
 * 💰 Профит на канцеларијата по клиент: for a period of whole months, per client firm the accounting fee it pays
 * (the monthly fee invoice when issued, else the agreed monthly fee) against the colleagues' active time in that firm
 * (activity log, `activeMinutes`) at an hourly cost — revenue per hour and profit; loss-making clients are flagged
 * „за поскапување“ with the monthly fee that would cover the time.
 */

/** `YYYY-MM` months from `from` to `to` inclusive (both `YYYY-MM`); empty when reversed. At most 36. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ty = +to.slice(0, 4), tm = +to.slice(5, 7);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Fee of a client for the months: the invoiced net of the month when there is a fee invoice, else the monthly fee. */
export function periodFee(months: readonly string[], billed: ReadonlyMap<string, number>, monthly: number): { fee: number; billedMonths: number } {
  let fee = 0, n = 0;
  for (const p of months) {
    const b = billed.get(p);
    if (b != null) { fee += b; n++; } else fee += monthly > 0 ? monthly : 0;
  }
  return { fee: Math.round(fee * 100) / 100, billedMonths: n };
}

export interface ProfitIn { id: string; name: string; fee: number; minutes: number; billedMonths?: number }
export interface ProfitRow extends ProfitIn {
  hours: number;
  /** Fee per hour of work; null without work. */
  perHour: number | null;
  cost: number;
  profit: number;
  /** Profit / fee in % (null without a fee). */
  margin: number | null;
  loss: boolean;
  /** Monthly fee that covers the time at the hourly cost (rounded up to 100 ден), only for loss-making clients. */
  suggest: number | null;
}

/** Rows sorted worst first (lowest profit), then by name. `months` = number of months in the period (for `suggest`). */
export function clientProfit(rows: readonly ProfitIn[], hourCost: number, months: number): ProfitRow[] {
  const c = Math.max(0, hourCost);
  return rows.map((r) => {
    const hours = Math.round(r.minutes / 60 * 100) / 100;
    const cost = Math.round(r.minutes / 60 * c * 100) / 100;
    const profit = Math.round((r.fee - cost) * 100) / 100;
    const loss = profit < 0;
    return {
      ...r, hours, cost, profit, loss,
      perHour: r.minutes > 0 ? Math.round(r.fee / (r.minutes / 60)) : null,
      margin: r.fee > 0 ? Math.round(profit / r.fee * 1000) / 10 : null,
      suggest: loss && months > 0 ? Math.ceil(cost / months / 100) * 100 : null,
    };
  }).sort((a, b) => a.profit - b.profit || a.name.localeCompare(b.name));
}

export function profitTotals(rows: readonly ProfitRow[]) {
  const fee = rows.reduce((s, r) => s + r.fee, 0), cost = rows.reduce((s, r) => s + r.cost, 0), min = rows.reduce((s, r) => s + r.minutes, 0);
  return {
    fee: Math.round(fee * 100) / 100, cost: Math.round(cost * 100) / 100, profit: Math.round((fee - cost) * 100) / 100,
    hours: Math.round(min / 60 * 100) / 100, perHour: min > 0 ? Math.round(fee / (min / 60)) : null, loss: rows.filter((r) => r.loss).length,
  };
}
