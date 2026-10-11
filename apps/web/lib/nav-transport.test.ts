import { describe, expect, it } from 'vitest';
import { NAV, navFlat } from './nav';
import { filterNavByModules } from './nav-industry';

const ids = (n: typeof NAV) => n.flatMap(([, it]) => navFlat(it).map(([v]) => v));

describe('transport / auto-service menu', () => {
  it('adds the transport invoices and fuel cards next to the freight views', () => {
    const L = ids(NAV);
    expect(L.indexOf('frFak')).toBe(L.indexOf('frTuri') + 1);
    expect(L.indexOf('frGor')).toBe(L.indexOf('frDnev') + 1);
    expect(L).toEqual(expect.arrayContaining(['servis', 'vozila', 'delovi', 'potsetnici', 'pnLive']));
  });
  it('the views follow their modules', () => {
    const off = ids(filterNavByModules(NAV, { mods: ['pn'] }, true));
    expect(off).toContain('pnLive');
    expect(off).not.toContain('servis');
    expect(off).not.toContain('frGor');
    const on = ids(filterNavByModules(NAV, { mods: ['auto', 'frt'] }, true));
    expect(on).toEqual(expect.arrayContaining(['servis', 'vozila', 'delovi', 'potsetnici', 'frFak', 'frGor']));
    expect(on).not.toContain('pnLive');
  });
});
