import { describe, expect, it } from 'vitest';
import { klSectionOpen, viewAllowed } from './nav';

describe('client portal sections open their pages', () => {
  const firm = { settings: { kl: { on: { obr: true } } }, mods: ['meals'] };
  it('a switched-on section of the client firm opens, others stay closed', () => {
    expect(viewAllowed('klient', 'obroci')).toBe(false);
    expect(klSectionOpen(firm, 'obroci')).toBe(true);
    expect(klSectionOpen({ ...firm, mods: [] }, 'obroci')).toBe(false);
    expect(klSectionOpen({ settings: {}, mods: ['meals'] }, 'obroci')).toBe(false);
    expect(klSectionOpen(firm, 'banka')).toBe(false);
    expect(klSectionOpen(null, 'obroci')).toBe(false);
  });
});
