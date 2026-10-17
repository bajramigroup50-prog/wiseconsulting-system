import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, OWNER_VIEWS, navFlat, viewAllowed, withoutViews } from './nav';
import { BOOK_ONLY_VIEWS, bookVerdict, demoViews, routeVerdict } from './route-guard';

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
  it('⚙ Автоматизации (UX Phase 3) after the AI cost in Систем; owner only, never demo / book-only', () => {
    const sys = navFlat(NAV.find(([g]) => g === 'Систем')![1]).map(([id]) => id);
    expect(sys[sys.indexOf('aiTrosok') + 1]).toBe('avtomatizacii');
    expect(NAV_LBL.avtomatizacii).toBe('⚙ Автоматизации');
    expect(OWNER_VIEWS).toContain('avtomatizacii');
    expect(ids(withoutViews(NAV, OWNER_VIEWS))).not.toContain('avtomatizacii');
    expect(BOOK_ONLY_VIEWS).not.toContain('avtomatizacii');
    expect(demoViews().has('avtomatizacii')).toBe(false);
    expect(routeVerdict('klient', '/avtomatizacii', ['klHome'])).toBe('/klHome');
  });
  it('the payroll / VAT drafts are reachable for a book-only colleague with Плата / ДДВ (and only then)', () => {
    const book = new Set(BOOK_ONLY_VIEWS);
    expect(bookVerdict('/plati/nacrti', book)).toBeNull();
    expect(bookVerdict('/ddv/nacrti', book)).toBeNull();
    expect(bookVerdict('/plati/nacrti', new Set(['banka']))).toBe('/');
    expect(bookVerdict('/ddv/nacrti', new Set(['banka']))).toBe('/');
    // the office review screens stay hidden from the default book-only list
    for (const v of ['zatvoranje', 'mesIzv', 'autop', 'aml', 'lawrep', 'payBatch']) expect(bookVerdict('/' + v, book), v).toBe('/');
  });
});
