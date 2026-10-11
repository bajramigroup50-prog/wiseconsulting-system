import { describe, expect, it } from 'vitest';
import { apClCustom, apClPeriodFor, prevMonth, prevQuarter } from './ap-close';

describe('autopilot period close (legacy apCloseHTML)', () => {
  it('previous month / quarter across the year end', () => {
    expect(prevMonth('2026-01-15')).toBe('2025-12');
    expect(prevMonth('2026-10-11')).toBe('2026-09');
    expect(prevQuarter('2026-02-01')).toBe('2025-Т4');
    expect(prevQuarter('2026-10-11')).toBe('2026-Т3');
  });
  it('mode → period per firm kind', () => {
    expect(apClPeriodFor('auto', 'month', '2026-10-11')).toBe('2026-09');
    expect(apClPeriodFor('auto', 'quarter', '2026-10-11')).toBe('2026-Т3');
    expect(apClPeriodFor('m', 'quarter', '2026-10-11')).toBeNull();
    expect(apClPeriodFor('2026-T2', 'quarter', '2026-10-11')).toBe('2026-Т2');
    expect(apClPeriodFor('2026-08', 'quarter', '2026-10-11')).toBeNull();
  });
  it('custom input check', () => {
    expect(apClCustom('2026-09')).toBe('2026-09');
    expect(apClCustom('2026-t3')).toBe('2026-Т3');
    expect(apClCustom('09/2026')).toBeNull();
  });
});
