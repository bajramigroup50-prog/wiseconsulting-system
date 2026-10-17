import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, navFor, viewAllowed } from './nav';
import { newMenu } from './nav-new';
import { BOOK_ONLY_VIEWS, DEMO_BOOK_VIEWS, routeVerdict } from './route-guard';
import { inboxScope, routeRefLink } from './incoming-scope';

describe('📥 Пристигнати документи menu item', () => {
  it('follows 🤖 WISE Робот in Фирми, once (classic and new menu)', () => {
    const f = navFlat(NAV.find(([g]) => g === 'Фирми')![1]).map(([id]) => id);
    expect(f[f.indexOf('robot') + 1]).toBe('prist');
    expect(f.filter((x) => x === 'prist')).toHaveLength(1);
    expect(NAV_LBL.prist).toBe('📥 Пристигнати документи');
    const n = navFlat(newMenu(navFor('admin')).find(([g]) => g === 'Фирми')![1]).map(([id]) => id);
    expect(n[n.indexOf('robot') + 1]).toBe('prist');
  });
  it('office roles, book-only and demo allow-lists; never klient / teren', () => {
    for (const r of ['admin', 'senior', 'acc', 'oper', 'view'] as const) expect(viewAllowed(r, 'prist')).toBe(true);
    expect(viewAllowed('klient', 'prist')).toBe(false);
    expect(viewAllowed('teren', 'prist')).toBe(false);
    expect(routeVerdict('klient', '/prist', ['klHome', 'klSend'])).toBe('/klHome');
    expect(BOOK_ONLY_VIEWS).toContain('prist');
    expect(DEMO_BOOK_VIEWS).toContain('prist');
  });
  it('scope and links', () => {
    expect(inboxScope({ role: 'klient' }, { firmIds: ['a'], restricted: null, owner: false })).toEqual({ firmIds: [], office: false, mpin: false });
    expect(inboxScope({ role: 'acc' }, { firmIds: ['a'], restricted: null, owner: true }).office).toBe(true);
    expect(routeRefLink('bank_import:x', 'bank', ['2/03'])).toEqual({ href: '/nalozi?n=2%2F03', label: '📒 Налог 2/03' });
    expect(routeRefLink('ai_document:1', 'sale')?.href).toBe('/skan?k=sale');
  });
});
