import { describe, expect, it } from 'vitest';
import { feedDue, feedNameOk, newSshKey } from './feeds';

describe('bank feeds', () => {
  it('file name patterns', () => {
    expect(feedNameOk('', 'izvod.xml')).toBe(true);
    expect(feedNameOk('*.xml;*.sta', 'IZVOD_45.XML')).toBe(true);
    expect(feedNameOk('*.xml;*.sta', 'izvod.pdf')).toBe(false);
    expect(feedNameOk('izv??.txt', 'izv01.txt')).toBe(true);
  });
  it('runs once in the hour after the evening time (Skopje)', () => {
    const f = { at: '20:00', active: true, lastRunAt: null };
    expect(feedDue(f, new Date('2026-11-10T19:05:00Z'))).toBe(true); // 20:05 Skopje (CET)
    expect(feedDue(f, new Date('2026-11-10T18:50:00Z'))).toBe(false); // 19:50
    expect(feedDue(f, new Date('2026-11-10T20:30:00Z'))).toBe(false); // 21:30 – past the hour
    expect(feedDue({ ...f, lastRunAt: new Date('2026-11-10T19:01:00Z') }, new Date('2026-11-10T19:20:00Z'))).toBe(false);
    expect(feedDue({ ...f, lastRunAt: new Date('2026-11-09T19:01:00Z') }, new Date('2026-11-10T19:20:00Z'))).toBe(true);
    expect(feedDue({ ...f, active: false }, new Date('2026-11-10T19:05:00Z'))).toBe(false);
  });
  it('makes an OpenSSH ed25519 key', () => {
    const k = newSshKey('t');
    expect(k.pub).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/=]+ t$/);
    expect(k.priv).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+-----END OPENSSH PRIVATE KEY-----\n$/);
  });
});
