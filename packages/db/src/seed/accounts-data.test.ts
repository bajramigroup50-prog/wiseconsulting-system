/** The built-in chart of accounts (seed data): codes are digits, names are clean text. */
import { describe, expect, it } from 'vitest';
import ACCOUNTS from './data/accounts.json' with { type: 'json' };

describe('built-in chart of accounts', () => {
  it('has numeric codes and no stray keyboard characters in the names (e.g. „допо;нителен“)', () => {
    const A = ACCOUNTS as [string, string][];
    expect(A.length).toBeGreaterThan(2000);
    expect(A.filter(([c]) => !/^\d{1,10}$/.test(c))).toEqual([]);
    expect(A.filter(([, n]) => /[;\[\]{}<>|\\]/.test(n))).toEqual([]);
    expect(A.find(([c]) => c === '2343')?.[1]).toBe('Обврски за дополнителен придонес за здраствено осигурување');
  });
});
