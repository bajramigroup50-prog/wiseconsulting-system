import { describe, expect, it } from 'vitest';
import { vatDateOf } from './vat-source';

describe('VAT date of a nalog imported from the old program', () => {
  it('counts in the nalog period (as the old program reported)', () => {
    expect(vatDateOf('2026-04-03', '1/1-3', 'import')).toBe('2026-03-31');
    expect(vatDateOf('2026-05-11', '1/1-3', 'import')).toBe('2026-03-31');
    expect(vatDateOf('2026-03-31', '1/4-6', 'import')).toBe('2026-04-01');
    expect(vatDateOf('2026-02-10', '1/1-3', 'import')).toBe('2026-02-10');
    expect(vatDateOf('2026-02-28', '12/2-2', 'import')).toBe('2026-02-28');
    expect(vatDateOf('2026-04-03', '1/1-3У', 'import')).toBe('2026-03-31');
  });
  it('documents and nalozi made in WISE keep their own date', () => {
    expect(vatDateOf('2026-04-03', '1/1-3', null)).toBe('2026-04-03');
    expect(vatDateOf('2026-04-03', '1/1-3', 'bank')).toBe('2026-04-03');
    expect(vatDateOf('2026-04-03', 'Налог 15', 'import')).toBe('2026-04-03');
  });
});
