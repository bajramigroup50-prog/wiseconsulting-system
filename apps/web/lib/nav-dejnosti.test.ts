import { describe, expect, it } from 'vitest';
import { NAV } from './nav';

const ids = (a: readonly unknown[]): string[] => (a as [string, string?, unknown[]?][]).flatMap((x) => (x[0] === '-' ? [] : x[0] === '>' ? ids(x[2] ?? []) : [x[0]]));
const grp = (g: string) => NAV.find(([n]) => n === g)![1];

describe('Дејности / Производство menu (legacy runtime NAV patches)', () => {
  it('production is a submenu in Материјално and Малопродажба', () => {
    for (const g of ['Материјално', 'Малопродажба']) {
      const sub = grp(g).find((x) => x[0] === '>' && x[1] === '🏭 Производство');
      expect(sub && ids(sub[2] ?? [])).toEqual(['normativ', 'prod', 'rasNorm', 'mrp', 'prodCost', 'lotovi']);
    }
  });
  it('module views live only in Дејности', () => {
    const dej = new Set(ids(grp('Дејности')));
    for (const v of ['pnalozi', 'pnLive', 'pnGorivo', 'kasa', 'restoran', 'kujna', 'servis', 'hotel']) {
      if (!dej.has(v)) continue;
      for (const [g, it] of NAV) if (g !== 'Дејности') expect(ids(it)).not.toContain(v);
    }
    expect(dej.has('pnalozi')).toBe(true);
  });
  it('each view appears once in Материјално', () => {
    const m = ids(grp('Материјално'));
    expect(new Set(m).size).toBe(m.length);
  });
});
