import { describe, expect, it } from 'vitest';
import { klAllowedViews, KL_SEC } from '@wise/core/office';
import { ROBOT_OWNER_ONLY } from '@wise/db';
import { NAV, NAV_LBL, OWNER_VIEWS, navFlat, viewAllowed, withoutViews } from './nav';
import { routeVerdict } from './route-guard';

const ids = (G: typeof NAV) => G.flatMap(([, L]) => navFlat(L).map(([id]) => id));

describe('🗂 Целосен извештај за фирма in the menu', () => {
  it('follows the monthly fee invoice in Фирми (after the contracts) and is owner-only', () => {
    const f = navFlat(NAV.find(([g]) => g === 'Фирми')![1]).map(([id]) => id);
    expect(f.slice(f.indexOf('kdogovori'), f.indexOf('kdogovori') + 3)).toEqual(['kdogovori', 'kdfakturi', 'firmIzv']);
    expect(NAV_LBL.firmIzv).toBe('🗂 Целосен извештај за фирма');
    expect(OWNER_VIEWS).toContain('firmIzv');
    expect(ids(withoutViews(NAV, OWNER_VIEWS))).not.toContain('firmIzv');
    expect(ROBOT_OWNER_ONLY).toContain('firmIzv');
  });
  it('never for clients or field workers (menu, portal sections, route guard incl. print / Word)', () => {
    expect(viewAllowed('klient', 'firmIzv')).toBe(false);
    expect(viewAllowed('teren', 'firmIzv')).toBe(false);
    expect(KL_SEC.some((s) => s[3] === 'firmIzv')).toBe(false);
    expect(klAllowedViews({ on: Object.fromEntries(KL_SEC.map((s) => [s[0], true])) })).not.toContain('firmIzv');
    expect(routeVerdict('klient', '/firmIzv', ['klHome'])).toBe('/klHome');
    expect(routeVerdict('klient', '/firmIzv/word', ['klHome'])).toBe('/klHome');
    expect(routeVerdict('klient', '/print/firmIzv', ['klHome'])).toBe('/klHome');
    expect(routeVerdict('teren', '/firmIzv', [])).toBe('/mojzad');
  });
});
