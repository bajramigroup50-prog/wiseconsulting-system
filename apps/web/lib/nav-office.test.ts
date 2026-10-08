import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

describe('office menu items (legacy runtime NAV patches)', () => {
  it('adds autopilot first in Канцеларија and the compliance screens after formation', () => {
    const k = navFlat(NAV.find(([g]) => g === 'Канцеларија')![1]).map(([id]) => id);
    expect(k).toEqual(['autop', 'kanc', 'mojzad', 'baranja', 'osnovanje', 'tpl', 'aml', 'zzlp']);
    const f = navFlat(NAV.find(([g]) => g === 'Фирми')![1]).map(([id]) => id);
    expect(f.indexOf('insp')).toBe(f.indexOf('zatvoranje') + 1);
    expect(NAV_LBL.autop).toBe('🤖 Автопилот');
  });
  it('client portal views: allowed for klient, office screens not', () => {
    for (const v of ['klHome', 'klSend', 'dosie']) expect(viewAllowed('klient', v)).toBe(true);
    for (const v of ['klInbox', 'klPortal', 'autop', 'aml', 'kanc']) expect(viewAllowed('klient', v)).toBe(false);
    expect(viewAllowed('teren', 'kanc')).toBe(false);
    expect(viewAllowed('acc', 'klInbox')).toBe(true);
  });
});
