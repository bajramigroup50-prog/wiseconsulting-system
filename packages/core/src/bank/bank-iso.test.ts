import { describe, expect, it } from 'vitest';
import { bankIsoClean, isoOfBank } from './purpose-codes';

describe('purpose codes per bank', () => {
  const R = bankIsoClean({ '300': { '220': 'gdds', '9999': 'XXXX' }, abc: { '220': 'GDDS' } });
  it('keeps only valid banks, old codes and ISO codes', () => {
    expect(R).toEqual({ '300': { '220': 'GDDS' } });
  });
  it('the payer bank\'s own choice, else the national list', () => {
    expect(isoOfBank('220', '300000000000123', R)).toBe('GDDS');
    expect(isoOfBank('220', 'MK07 300 0000000001 23', R)).toBe('GDDS');
    expect(isoOfBank('220', '270000000000123', R)).toBe('GDSV');
    expect(isoOfBank('SALA', '300000000000123', R)).toBe('SALA');
  });
});
