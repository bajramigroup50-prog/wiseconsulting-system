/**
 * Tab-container screens (P5 / P8 / P9, `lib/nav-hubs.ts`): old URLs → their tab, the container address `/ekran/<hub>`,
 * and per-tab access (`lib/screen-access.ts`): a book-only colleague and a demo user never see a forbidden tab.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Role } from '@wise/core';
import { HUBS, hubByKey, hubTarget, tabHref, visibleTabs } from './nav-hubs';
import { mayOpen, type ScreenCtx } from './screen-access';
import { BOOK_ALWAYS_VIEWS, BOOK_ONLY_VIEWS, allowListVerdict, bookVerdict, demoVerdict, demoViews, restrictedViews, routeVerdict } from './route-guard';

const ctx = (o: Partial<ScreenCtx> & { role?: Role } = {}): ScreenCtx => ({ role: 'admin', demo: false, owner: true, views: null, can: () => true, ...o });
const may = (c: ScreenCtx) => (v: string, p?: string) => mayOpen(c, v, p);
const tabs = (key: string, c: ScreenCtx) => visibleTabs(hubByKey(key)!, may(c)).map((t) => t.view);

const BOOK = restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null })!;
const book = ctx({ role: 'acc', owner: false, views: BOOK });
const demo = ctx({ role: 'admin', demo: true, owner: false });

describe('old URLs keep working: each old address IS its tab (or redirects to it)', () => {
  const OLD: Record<string, [string, string]> = {
    // P8 „⚖ Закони“
    '/zakoni': ['zakoni', '/zakoni'], '/lawAi': ['zakoni', '/lawAi'], '/ujpZakoni': ['zakoni', '/ujpZakoni'], '/lawrep': ['zakoni', '/lawrep'], '/zakon': ['zakoni', '/zakon'],
    // P9 „📅 Рокови“
    '/rokovi': ['rokovi', '/rokovi'], '/zsRok': ['rokovi', '/zsRok'],
    // P5 „Изводи → ⚙“: /banke redirects to the accounts tab, /bankFmt is the formats tab
    '/banke': ['izvodiCfg', '/banka?banks=1'], '/bankFmt': ['izvodiCfg', '/bankFmt'],
  };
  it.each(Object.entries(OLD))('%s → tab %s', (old, [key, href]) => {
    const hub = hubByKey(key)!;
    expect(hub.tabs.map(tabHref)).toContain(href);
    if (old === '/banke') expect(readFileSync(new URL('../app/(app)/banke/page.tsx', import.meta.url), 'utf8')).toContain(`redirect('${href}')`);
    else expect(old).toBe(href);
    // every tab is a real page that renders the strip
    const view = hub.tabs.find((t) => tabHref(t) === href)!.view;
    const page = view === 'banka' || view === 'devizni' ? '../app/(app)/banka/bank-view.tsx' : `../app/(app)/${view}/page.tsx`;
    expect(readFileSync(new URL(page, import.meta.url), 'utf8')).toContain(`hubTabs('${key}'`);
  });
  it('the container address goes to the asked tab, else the first allowed one, else nowhere', () => {
    const z = hubByKey('zakoni')!;
    expect(hubTarget(z, may(ctx()), 'lawAi')).toBe('/lawAi');
    expect(hubTarget(z, may(ctx()), null)).toBe('/zakoni');
    expect(hubTarget(z, may(demo), 'lawAi')).toBe('/lawrep'); // lawAi is not a demo view → first allowed tab
    expect(hubTarget(z, may(book), 'zakoni')).toBeNull(); // book-only: no law tab at all → 404
    expect(hubTarget(hubByKey('izvodiCfg')!, may(book), 'bankFmt')).toBe('/banka?banks=1');
  });
});

describe('a tab is shown only when its view may be opened', () => {
  it('owner: every tab', () => {
    for (const h of HUBS) expect(tabs(h.key, ctx())).toEqual(h.tabs.map((t) => t.view));
  });
  it('🔒 book-only colleague: no law tab, no deadline tab, no bank formats; the bank accounts stay', () => {
    expect(tabs('zakoni', book)).toEqual([]);
    expect(tabs('rokovi', book)).toEqual([]);
    expect(tabs('izvodiCfg', book)).toEqual(['banka', 'devizni']);
    for (const h of HUBS) for (const t of tabs(h.key, book)) expect(BOOK.has(t), t).toBe(true);
  });
  it('🔒 „Прилагодено“ with one law screen: only that tab', () => {
    const c = ctx({ role: 'acc', owner: false, views: new Set(['lawrep', ...BOOK_ALWAYS_VIEWS]) });
    expect(tabs('zakoni', c)).toEqual(['lawrep']);
  });
  it('🎭 demo: only demo views (lawAi / zakoni / ujpZakoni / bankFmt are not)', () => {
    expect(tabs('zakoni', demo)).toEqual(['lawrep', 'zakon']);
    expect(tabs('rokovi', demo)).toEqual(['rokovi', 'zsRok']);
    expect(tabs('izvodiCfg', demo)).toEqual(['banka', 'devizni']);
    const D = demoViews();
    for (const h of HUBS) for (const t of tabs(h.key, demo)) expect(D.has(t), t).toBe(true);
  });
  it('the page permission hides the tab (lawrep / zakon / rokovi need „office“)', () => {
    const c = ctx({ role: 'view', owner: false, can: (p) => p !== 'office' });
    expect(tabs('zakoni', c)).toEqual(['zakoni', 'lawAi', 'ujpZakoni']);
    expect(tabs('rokovi', c)).toEqual(['zsRok']);
  });
  it('klient / teren: never', () => {
    for (const role of ['klient', 'teren'] as const) for (const h of HUBS) expect(tabs(h.key, ctx({ role, owner: false })), role).toEqual([]);
  });
  it('book-only / demo lists did not grow (no tab view was added to them)', () => {
    for (const v of ['zakoni', 'lawAi', 'ujpZakoni', 'lawrep', 'zakon', 'rokovi', 'zsRok', 'bankFmt']) expect(BOOK_ONLY_VIEWS, v).not.toContain(v);
    for (const v of ['zakoni', 'lawAi', 'ujpZakoni', 'bankFmt']) expect(demoViews().has(v), v).toBe(false);
  });
});

describe('route guard of the container address /ekran/<hub>', () => {
  it('🔒 book-only: refused when no tab is allowed, allowed when one is', () => {
    expect(bookVerdict('/ekran/zakoni', BOOK)).toBe('/');
    expect(bookVerdict('/ekran/rokovi', BOOK)).toBe('/');
    expect(bookVerdict('/ekran/izvodiCfg', BOOK)).toBeNull();
    expect(bookVerdict('/ekran/nepostoi', BOOK)).toBe('/');
    // the tabs themselves: exactly as before
    expect(bookVerdict('/lawAi', BOOK)).toBe('/');
    expect(bookVerdict('/bankFmt', BOOK)).toBe('/');
    expect(bookVerdict('/banka', BOOK)).toBeNull();
  });
  it('🎭 demo: allowed through its demo tabs only', () => {
    expect(demoVerdict('/ekran/zakoni')).toBeNull();
    expect(demoVerdict('/lawAi')).toBe('/');
    expect(demoVerdict('/ekran/x')).toBe('/');
  });
  it('custom access: one allowed tab opens the container', () => {
    const V = new Set(['zsRok']);
    const v = (p: string) => allowListVerdict(p, { views: V, print: () => false, api: () => false });
    expect(v('/ekran/rokovi')).toBeNull();
    expect(v('/ekran/zakoni')).toBe('/');
  });
  it('klient / teren: never', () => {
    expect(routeVerdict('klient', '/ekran/zakoni', ['dosie', 'arhiva'])).toBe('/klHome');
    expect(routeVerdict('teren', '/ekran/rokovi', [])).toBe('/mojzad');
  });
});
