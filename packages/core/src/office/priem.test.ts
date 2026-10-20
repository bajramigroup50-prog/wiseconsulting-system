import { describe, expect, it } from 'vitest';
import { priemItemsClean, priemKeepUntil, priemNo, priemPeriodName, priemSubRanges, priemTotal } from './priem';

describe('📥 прием на документи', () => {
  const I = priemItemsClean([{ k: 'in', n: 12 }, { k: 'out', n: 8 }, { k: 'bank', n: 3 }, { k: 'fisk', n: 1, pack: true }, { k: 'plati', n: 0 }, { k: 'xx', n: 5 }]);
  it('cleans the lines and counts the sub-numbers in order (a package is one)', () => {
    expect(I.map((i) => i.k)).toEqual(['in', 'out', 'bank', 'fisk']);
    expect(priemSubRanges(I)).toEqual([{ k: 'in', from: 1, to: 12 }, { k: 'out', from: 13, to: 20 }, { k: 'bank', from: 21, to: 23 }, { k: 'fisk', from: 24, to: 24 }]);
    expect(priemTotal(I)).toBe(24);
  });
  it('number, period and keeping (5 years; payroll / contracts 10)', () => {
    expect(priemNo(157, 2026)).toBe('01-157/26');
    expect(priemPeriodName('2026-10')).toBe('ОКТОМВРИ 2026');
    expect(priemKeepUntil('2026-10', I)).toBe('2031-12-31');
    expect(priemKeepUntil('2026-10', [{ k: 'plati', n: 2 }])).toBe('2036-12-31');
  });
});
