import { describe, expect, it } from 'vitest';
import { can, firmAllowed, type Principal } from './rbac';
import { demoFirmName, demoJobAllowed, demoLinkState, demoPassword, demoSettingsClean, isDemoFirm, isDemoToken } from './demo';
import { classifyAction, KNOWN_ACTIONS } from './office/productivity';

const demo: Principal = { id: 'u', role: 'admin', firms: ['D1'], demo: true };

describe('demo rules', () => {
  it('a demo firm needs BOTH the flag and the „ДЕМО“ prefix', () => {
    expect(isDemoFirm({ name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } })).toBe(true);
    expect(isDemoFirm({ name: 'РЕАЛНА ДОО', settings: { demo: true } })).toBe(false);
    expect(isDemoFirm({ name: 'ДЕМО ДОО', settings: {} })).toBe(false);
    expect(isDemoFirm({ name: 'ДЕМО ДОО', settings: { demo: 'true' } })).toBe(false);
    expect(isDemoFirm({ name: 'демо доо', settings: { demo: true } })).toBe(false);
    expect(isDemoFirm(null)).toBe(false);
  });
  it('a demo principal reaches only its demo firms, even as admin with all firms', () => {
    expect(firmAllowed(demo, 'D1')).toBe(true);
    expect(firmAllowed(demo, 'R1')).toBe(false);
    expect(firmAllowed(demo, 'R1', 'u')).toBe(false); // owned firm shortcut does not apply
    expect(firmAllowed({ ...demo, firms: ['*'] }, 'R1')).toBe(false);
    expect(can(demo, 'write', 'R1')).toBe(false);
    expect(can(demo, 'write', 'D1')).toBe(true);
  });
  it('office-wide checks are refused for a demo principal; only demo firm creation / editing', () => {
    for (const p of ['office', 'settings', 'firms', 'close']) expect(can(demo, p, null), p).toBe(false);
    expect(can(demo, 'office', 'D1')).toBe(true);
    expect(can(demo, 'write')).toBe(true);
    expect(can(demo, 'users')).toBe(true);
    for (const a of ['pickNew', 'ncCreateFirm']) { expect(can(demo, a, 'D1'), a).toBe(false); expect(can(demo, a), a).toBe(false); }
    // 🎭 a demo user creates firms (always demo, `@wise/db` createDemoFirm) and edits / deletes only its demo firms
    expect(can(demo, 'newFirm')).toBe(true);
    expect(can(demo, 'saveFirm', 'D1')).toBe(true);
    expect(can(demo, 'saveFirm', 'R1')).toBe(false);
    expect(can(demo, 'saveFirm')).toBe(false);
    expect(can(demo, 'delFirm', 'D1')).toBe(true);
    expect(can(demo, 'delFirm', 'R1')).toBe(false);
    const acc: Principal = { ...demo, role: 'acc' };
    expect(can(acc, 'newFirm')).toBe(true);
    expect(can(acc, 'delFirm', 'D1')).toBe(false);
    for (const r of ['view', 'teren', 'klient'] as const) expect(can({ ...demo, role: r }, 'newFirm'), r).toBe(false);
    // real admins are unchanged
    expect(can({ id: 'a', role: 'admin', firms: ['*'] }, 'office', null)).toBe(true);
  });
  it('jobs: pdf always; AI only when allowed; mail / УЈП / NBRM / imports never', () => {
    expect(demoJobAllowed('pdf.render', false)).toBe(true);
    expect(demoJobAllowed('ai.read-document', false)).toBe(false);
    expect(demoJobAllowed('ai.read-document', true)).toBe(false); // never AI in the demo, even if a setting says so
    expect(demoSettingsClean({ ai: true }).ai).toBe(false);
    for (const j of ['mail.send', 'invoice.mail', 'pdf.mail', 'fee.deliver', 'law.texts', 'legacy.import', 'mpin.read', 'demo.reset']) expect(demoJobAllowed(j, true), j).toBe(false);
  });
  it('the name of a firm a demo user creates always starts with „ДЕМО“', () => {
    expect(demoFirmName('Мојот Клиент ДООЕЛ')).toBe('ДЕМО – Мојот Клиент ДООЕЛ');
    expect(demoFirmName('  ДЕМО ПЕКАРА ')).toBe('ДЕМО ПЕКАРА');
    expect(demoFirmName('демо доо')).toBe('ДЕМО – демо доо');
    expect(isDemoFirm({ name: demoFirmName('X'), settings: { demo: true } })).toBe(true);
  });
  it('settings, tokens, links, passwords', () => {
    expect(demoSettingsClean(undefined)).toEqual({ ai: false, aiLimitUsd: 5, nightly: false });
    expect(demoSettingsClean({ ai: true, aiLimitUsd: 1e6 }).aiLimitUsd).toBe(5);
    expect(isDemoToken('a'.repeat(43))).toBe(true);
    expect(isDemoToken('short')).toBe(false);
    expect(isDemoToken('a'.repeat(42) + '/')).toBe(false);
    const now = Date.now();
    expect(demoLinkState({ expiresAt: new Date(now + 1000), revokedAt: null }, now)).toBe('ok');
    expect(demoLinkState({ expiresAt: new Date(now - 1), revokedAt: null }, now)).toBe('expired');
    expect(demoLinkState({ expiresAt: new Date(now + 1000), revokedAt: new Date() }, now)).toBe('revoked');
    let i = 0;
    const pw = demoPassword((n) => Uint8Array.from({ length: n }, () => (i++ * 37) % 256));
    expect(pw).toMatch(/^[A-Za-z2-9]{20}$/);
  });
  it('demo audit actions are noise in the productivity report', () => {
    for (const a of ['demoUserSet', 'demoSeed', 'demoReset', 'demoLinkNew', 'demoLinkRevoke', 'demoLinkOpen', 'demoAiSet', 'demoRefused']) {
      expect(KNOWN_ACTIONS.has(a), a).toBe(true);
      expect(classifyAction(a, null), a).toBeNull();
    }
  });
});
