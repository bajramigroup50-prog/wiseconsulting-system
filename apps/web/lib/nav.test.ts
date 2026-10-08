import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, hrefFor, navFlat, navFor, viewAllowed } from './nav';

describe('nav (legacy NAV)', () => {
  it('keeps all 14 legacy groups and resolves labels', () => {
    expect(NAV).toHaveLength(14);
    expect(NAV_LBL.firmi).toBe('Фирми (регистрација и избор)');
    expect(hrefFor('home')).toBe('/');
    expect(hrefFor('banka')).toBe('/banka');
  });
  it('flattens separators and submenus', () => {
    const fin = NAV.find(([g]) => g === 'Финансово')![1];
    const flat = navFlat(fin);
    expect(flat.some(([id]) => id === '-' || id === '>')).toBe(false);
    expect(flat.length).toBeGreaterThan(fin.filter((x) => x[0] !== '-' && x[0] !== '>').length);
  });
  it('limits teren and klient menus', () => {
    expect(viewAllowed('teren', 'mojzad')).toBe(true);
    expect(viewAllowed('teren', 'banka')).toBe(false);
    expect(viewAllowed('klient', 'korisnici')).toBe(false);
    expect(viewAllowed('acc', 'banka')).toBe(true);
    expect(navFor('admin')).toBe(NAV);
  });
});
