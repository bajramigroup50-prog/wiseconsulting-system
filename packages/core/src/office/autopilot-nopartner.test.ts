import { describe, expect, it } from 'vitest';
import { NO_PARTNER_KONTO_RE } from './autopilot';

describe('kontos without a partner by nature', () => {
  it('card / POS takings need no customer', () => {
    expect(NO_PARTNER_KONTO_RE.test('Плаќање со картици од купувачи')).toBe(true);
    expect(NO_PARTNER_KONTO_RE.test('Побарувања по ПОС терминал')).toBe(true);
  });
  it('ordinary customers / art. 32-a do', () => {
    expect(NO_PARTNER_KONTO_RE.test('Побарувања од купувачи по член 32 а')).toBe(false);
    expect(NO_PARTNER_KONTO_RE.test('Побарување од купувачи од продажба на добра')).toBe(false);
  });
});
