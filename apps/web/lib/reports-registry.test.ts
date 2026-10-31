/** „📊 Извештаи“: every listed report is a real menu screen (no dead link), the period goes only to the screens that take it. */
import { describe, expect, it } from 'vitest';
import { NAV, navFlat } from './nav';
import { REPORTS, reportHref } from './reports-registry';

describe('reports registry', () => {
  it('every report opens a view of the menu', () => {
    const views = new Set(NAV.flatMap(([, L]) => navFlat(L).map(([v]) => v)));
    expect(REPORTS.filter((r) => !views.has(r.acc ?? r.view)).map((r) => r.view)).toEqual([]);
    expect(REPORTS.length).toBeGreaterThan(50);
  });
  it('the common period only for the screens with from / to', () => {
    const b = REPORTS.find((r) => r.view === 'bilanc')!, d = REPORTS.find((r) => r.view === 'ddv')!;
    expect(reportHref(b, '2026-01-01', '2026-06-30')).toBe('/bilanc?from=2026-01-01&to=2026-06-30');
    expect(reportHref(d, '2026-01-01', '2026-06-30')).toBe('/ddv');
    expect(reportHref(REPORTS[0]!, '2026-01-01', '2026-06-30')).toBe('/izvestai/starost');
  });
});
