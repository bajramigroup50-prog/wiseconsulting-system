/**
 * Compensations (компензации) helpers — legacy `kompNextNo` (8918) and ACT `kompAuto` (8961). Posting is
 * `kompEntries` / `kompTot` in posting.ts. Amounts in cents.
 */

/** К-nnn/yyyy, next number in the year of `date` (`numbers` = that year's numbers). */
export function kompNextNumber(date: string, numbers: readonly (string | null | undefined)[]): string {
  const y = String(date).slice(0, 4);
  const n = numbers.map((x) => parseInt(String(x ?? '').replace(/^\D+/, '')) || 0);
  return 'К-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0') + '/' + y;
}

/**
 * Legacy `kompAuto`: fill both sides up to the smaller total, oldest documents first. Returns the amount per row
 * (same order); a partner without both receivables and payables gets zeros.
 */
export function kompAutoFill(rows: readonly { side: 'rec' | 'pay'; open: number }[]): number[] {
  const sum = (s: 'rec' | 'pay') => rows.filter((r) => r.side === s).reduce((a, r) => a + Math.max(0, r.open), 0);
  const X = Math.min(sum('rec'), sum('pay'));
  const left = { rec: X, pay: X };
  return rows.map((r) => {
    const a = Math.max(0, Math.min(r.open, left[r.side]));
    left[r.side] -= a;
    return a;
  });
}
