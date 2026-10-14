import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, OWNER_VIEWS, navFlat, viewAllowed, withoutViews } from './nav';
import { routeVerdict } from './route-guard';

const ids = (g: readonly typeof NAV[number][]) => g.flatMap(([, L]) => navFlat(L).map(([id]) => id));
const firmi = () => navFlat(NAV.find(([g]) => g === 'Фирми')![1]).map(([id]) => id);

describe('office automations in the menu', () => {
  it('📅 Календар на рокови after the all-firms block; office staff only', () => {
    const f = firmi();
    expect(f[f.indexOf('efPrep') + 1]).toBe('rokovi');
    expect(NAV_LBL.rokovi).toBe('📅 Календар на рокови');
    expect(viewAllowed('acc', 'rokovi')).toBe(true);
    expect(viewAllowed('klient', 'rokovi')).toBe(false);
    expect(viewAllowed('teren', 'rokovi')).toBe(false);
    expect(routeVerdict('klient', '/rokovi', ['klHome'])).toBe('/klHome');
  });
  it('🧾 monthly fee invoices after the contracts; owner only (hidden from everybody else)', () => {
    const f = firmi();
    expect(f[f.indexOf('kdogovori') + 1]).toBe('kdfakturi');
    expect(OWNER_VIEWS).toContain('kdfakturi');
    expect(ids(withoutViews(NAV, OWNER_VIEWS))).not.toContain('kdfakturi');
    expect(viewAllowed('klient', 'kdfakturi')).toBe(false);
    expect(routeVerdict('klient', '/kdfakturi', ['klHome'])).toBe('/klHome');
  });
});
