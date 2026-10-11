import { describe, expect, it } from 'vitest';
import { NAV, navFlat } from './nav';
import { filterNavByModules } from './nav-industry';

const ids = (n: ReturnType<typeof filterNavByModules>) => n.flatMap(([, it]) => navFlat(it).map(([v]) => v));

describe('industry menu', () => {
  it('adds the freight views to Дејности', () => {
    expect(ids(NAV)).toEqual(expect.arrayContaining(['frTuri', 'frDnev', 'frDok']));
  });
  it('office users see every module (legacy viewOn); clients only the switched-on ones', () => {
    expect(ids(filterNavByModules(NAV, { mods: [] }))).toEqual(expect.arrayContaining(['hotel', 'gradbaIzv', 'rent', 'nalozi']));
    const off = ids(filterNavByModules(NAV, { mods: [] }, true));
    expect(off).not.toContain('hotel');
    expect(off).not.toContain('gradbaIzv');
    expect(off).toContain('nalozi');
    const on = ids(filterNavByModules(NAV, { mods: ['hotel', 'cons'] }, true));
    expect(on).toEqual(expect.arrayContaining(['hotel', 'hotelKniga', 'gradba', 'gradbaIzv']));
    expect(on).not.toContain('rent');
    expect(ids(filterNavByModules(NAV, null))).toContain('rent');
  });
});
