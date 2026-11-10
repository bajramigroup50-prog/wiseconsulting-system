import { describe, expect, it } from 'vitest';
import { firstRecDay } from './other-parity';

describe('first invoicing day of an imported recurring invoice', () => {
  it('takes this month when the day is still ahead, else next month', () => {
    expect(firstRecDay('2026-11-10', 15)).toBe('2026-11-15');
    expect(firstRecDay('2026-11-10', 10)).toBe('2026-11-10');
    expect(firstRecDay('2026-11-10', 1)).toBe('2026-12-01');
    expect(firstRecDay('2026-12-20', 5)).toBe('2027-01-05');
    expect(firstRecDay('2026-01-02', 31)).toBe('2026-01-31');
    expect(firstRecDay('2026-02-10', 31)).toBe('2026-02-28');
  });
});
