import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_ACTIONS } from '@wise/core/office/productivity';
import { NAV, OWNER_VIEWS, navFlat, viewAllowed, withoutViews } from './nav';
import { routeVerdict } from './route-guard';

describe('📊 Продуктивност на вработените in the menu', () => {
  it('follows Дневник на активности in Систем; office roles may open it, clients and field workers not', () => {
    const ids = navFlat(NAV.find(([g]) => g === 'Систем')![1]).map(([id]) => id);
    expect(ids[ids.indexOf('aktivnost') + 1]).toBe('produktivnost');
    expect(viewAllowed('admin', 'produktivnost')).toBe(true);
    expect(viewAllowed('klient', 'produktivnost')).toBe(false);
    expect(viewAllowed('teren', 'produktivnost')).toBe(false);
    expect(routeVerdict('klient', '/produktivnost', ['klHome', 'izlez'])).toBe('/klHome');
    expect(routeVerdict('klient', '/produktivnost/xlsx', ['klHome'])).toBe('/klHome');
    expect(routeVerdict('klient', '/print/produktivnost', ['klHome'])).toBe('/klHome');
  });
  it('is hidden from everybody but the owner (withoutViews)', () => {
    const hidden = withoutViews(NAV, OWNER_VIEWS);
    const all = hidden.flatMap(([, L]) => navFlat(L).map(([id]) => id));
    expect(all).not.toContain('produktivnost');
    expect(all).toContain('aktivnost');
    expect(withoutViews(NAV, [])).toBe(NAV);
  });
});

/** Every literal `audit({ action })` in the code should be in the classification table (unknown ones go to „Друго“). */
describe('audit action coverage', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', 'dist', 'e2e', 'test'].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        const s = readFileSync(p, 'utf8');
        for (const m of s.matchAll(/\b(?:action|auditAction)\s*:\s*([^,}\n]+)/g)) {
          if (!/audit|postJournal|auditAction/.test(s)) continue;
          for (const l of m[1]!.matchAll(/'([a-z][A-Za-z0-9]+)'/g)) found.add(l[1]!);
        }
      }
    }
  };
  walk(join(root, 'apps/web/app'));
  walk(join(root, 'apps/web/lib'));
  walk(join(root, 'packages/db/src'));
  it('at least 95 % of the actions found in the code are classified', () => {
    const missing = [...found].filter((a) => !KNOWN_ACTIONS.has(a));
    expect(found.size).toBeGreaterThan(300);
    // eslint-disable-next-line no-console
    if (missing.length) console.info('audit actions not in the productivity table:', missing.join(' '));
    expect(missing.length / found.size).toBeLessThan(0.05);
  });
});
