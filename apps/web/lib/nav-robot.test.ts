import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';
import { routeVerdict } from './route-guard';

describe('🤖 WISE Робот menu item', () => {
  it('follows Контролна табла in Фирми', () => {
    const f = navFlat(NAV.find(([g]) => g === 'Фирми')![1]).map(([id]) => id);
    expect(f[f.indexOf('home') + 1]).toBe('robot');
    expect(f.filter((x) => x === 'robot')).toHaveLength(1);
    expect(NAV_LBL.robot).toBe('🤖 WISE Робот');
  });
  it('office roles only', () => {
    for (const r of ['admin', 'senior', 'acc', 'oper', 'view'] as const) expect(viewAllowed(r, 'robot')).toBe(true);
    expect(viewAllowed('klient', 'robot')).toBe(false);
    expect(viewAllowed('teren', 'robot')).toBe(false);
    expect(routeVerdict('klient', '/robot', ['klHome'])).toBe('/klHome');
  });
});
