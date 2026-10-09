import { describe, expect, it } from 'vitest';
import { NAV, navFlat } from './nav';
import { filterNavByModules } from './nav-industry';

const ids = (n: ReturnType<typeof filterNavByModules>) => n.flatMap(([, it]) => navFlat(it).map(([v]) => v));

describe('industry menu', () => {
  it('adds the freight views to Дејности', () => {
    expect(ids(NAV)).toEqual(expect.arrayContaining(['frTuri', 'frDnev', 'frDok']));
  });
  it('hides switched-off modules for office users too (FIX 10.4 item 9)', () => {
    const off = ids(filterNavByModules(NAV, { mods: [] }));
    expect(off).not.toContain('hotel');
    expect(off).not.toContain('gradbaIzv');
    expect(off).toContain('nalozi');
    const on = ids(filterNavByModules(NAV, { mods: ['hotel', 'cons'] }));
    expect(on).toEqual(expect.arrayContaining(['hotel', 'hotelKniga', 'gradba', 'gradbaIzv']));
    expect(on).not.toContain('rent');
    expect(ids(filterNavByModules(NAV, null))).toContain('rent');
  });
});
