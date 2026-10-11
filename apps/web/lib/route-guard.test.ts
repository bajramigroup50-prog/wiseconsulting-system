import { describe, expect, it } from 'vitest';
import { klAllowedViews } from '@wise/core/office';
import { klFileAllowed, previewVerdict, routeVerdict } from './route-guard';

describe('client file access (klFileAllowed)', () => {
  const base = [...klAllowedViews({}), 'kdogovori'];
  const withPay = [...klAllowedViews({ on: { plati: true } }), 'kdogovori'];
  it('dossier, own uploads, firm images and the contract are allowed', () => {
    expect(klFileAllowed([{ entityType: 'dossier_doc', role: 'attachment' }], base, false)).toBe(true);
    expect(klFileAllowed([], base, true)).toBe(true);
    expect(klFileAllowed([{ entityType: 'firm', role: 'logo' }], base, false)).toBe(true);
    expect(klFileAllowed([{ entityType: 'service_contract', role: 'attachment' }], base, false)).toBe(true);
  });
  it('sections the client does not see are refused', () => {
    expect(klFileAllowed([{ entityType: 'payroll_run', role: 'attachment' }], base, false)).toBe(false);
    expect(klFileAllowed([{ entityType: 'payroll_run', role: 'attachment' }], withPay, false)).toBe(true);
    expect(klFileAllowed([{ entityType: 'purchase', role: 'source' }], base, false)).toBe(false);
    expect(klFileAllowed([{ entityType: 'ai_document', role: 'source' }, { entityType: 'gdpr_record', role: 'attachment' }], withPay, false)).toBe(false);
    expect(klFileAllowed([{ entityType: 'firm', role: 'other' }], base, false)).toBe(false);
    expect(klFileAllowed([], base, false)).toBe(false);
  });
});

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

describe('office preview as client (previewVerdict)', () => {
  it('client sections and the exit yes, books no, API untouched', () => {
    expect(previewVerdict('/klHome', base)).toBeNull();
    expect(previewVerdict('/klExit', base)).toBeNull();
    expect(previewVerdict('/nalozi', base)).toBe('/klHome');
    expect(previewVerdict('/izlez', base)).toBe('/klHome');
    expect(previewVerdict('/izlez', withInv)).toBeNull();
    expect(previewVerdict('/api/anything', base)).toBeNull();
    expect(previewVerdict('/', base)).toBe('/klHome');
  });
  it('the klient guard itself does not know klExit', () => {
    expect(routeVerdict('klient', '/klExit', base)).toBe('/klHome');
  });
});
