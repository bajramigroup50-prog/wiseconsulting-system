import { describe, expect, it } from 'vitest';
import { NAV, navFlat, navFor, viewAllowed } from './nav';
import { filterNavByModules } from './nav-industry';

describe('legacy import menu', () => {
  it('sits in Систем right after „Податоци и резервна копија“, once', () => {
    const sys = NAV.find(([g]) => g === 'Систем')![1].map((x) => x[0]);
    expect(sys.indexOf('uvozStara')).toBe(sys.indexOf('sistem') + 1);
    expect(sys.filter((x) => x === 'uvozStara')).toHaveLength(1);
  });
  it('is not hidden by the module filter and not offered to the client portal', () => {
    const ids = filterNavByModules(NAV, { mods: [] }).flatMap(([, it]) => navFlat(it).map(([v]) => v));
    expect(ids).toContain('uvozStara');
    expect(viewAllowed('klient', 'uvozStara')).toBe(false);
    expect(navFor('teren').flatMap(([, it]) => navFlat(it).map(([v]) => v))).not.toContain('uvozStara');
  });
});
