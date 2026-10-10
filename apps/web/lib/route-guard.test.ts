import { describe, expect, it } from 'vitest';
import { klAllowedViews } from '@wise/core/office';
import { routeVerdict } from './route-guard';

const base = [...klAllowedViews({}), 'kdogovori'];
const withInv = [...klAllowedViews({ on: { izlez: true } }), 'kdogovori'];

describe('route guard (klient / teren allow-list)', () => {
  it('client: portal pages yes, books no', () => {
    expect(routeVerdict('klient', '/klHome', base)).toBeNull();
    expect(routeVerdict('klient', '/klSend', base)).toBeNull();
    expect(routeVerdict('klient', '/dosie', base)).toBeNull();
    expect(routeVerdict('klient', '/dosie/zip', base)).toBeNull();
    expect(routeVerdict('klient', '/lozinka', base)).toBeNull();
    expect(routeVerdict('klient', '/kdogovori', base)).toBeNull();
    expect(routeVerdict('klient', '/', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/nalozi', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/izlez', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/firmi/izvoz', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/korisnici', base)).toBe('/klHome');
  });
  it('client: sections switched on by the office open', () => {
    expect(routeVerdict('klient', '/izlez', withInv)).toBeNull();
    expect(routeVerdict('klient', '/print/doc/123', withInv)).toBeNull();
    expect(routeVerdict('klient', '/print/doc/123', base)).toBe('/klHome');
  });
  it('client: print and API', () => {
    expect(routeVerdict('klient', '/print/bilanc', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/pecati/db', base)).toBe('/klHome');
    expect(routeVerdict('klient', '/api/files/abc', base)).toBeNull();
    expect(routeVerdict('klient', '/api/pdf', base)).toBeNull();
    expect(routeVerdict('klient', '/api/firms', base)).toBe('403');
    expect(routeVerdict('klient', '/api/office/pkg/1', base)).toBe('403');
    expect(routeVerdict('klient', '/api/ubl/1', base)).toBe('403');
    expect(routeVerdict('klient', '/api/ubl/1.xml', base)).toBe('403');
    expect(routeVerdict('klient', '/nalozi/x.pdf', base)).toBe('/klHome');
  });
  it('field worker: tasks and travel orders only', () => {
    expect(routeVerdict('teren', '/mojzad', [])).toBeNull();
    expect(routeVerdict('teren', '/mojpn', [])).toBeNull();
    expect(routeVerdict('teren', '/', [])).toBe('/mojzad');
    expect(routeVerdict('teren', '/klHome', [])).toBe('/mojzad');
    expect(routeVerdict('teren', '/partneri', [])).toBe('/mojzad');
  });
  it('public paths stay open', () => {
    for (const p of ['/login', '/_next/static/x.js', '/manifest.webmanifest', '/icons/icon-192.png', '/api/health', '/favicon.ico'])
      expect(routeVerdict('klient', p, base)).toBeNull();
  });
});
