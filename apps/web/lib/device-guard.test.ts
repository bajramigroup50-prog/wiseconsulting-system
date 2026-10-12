import { describe, expect, it } from 'vitest';
import { deviceMode, devicePage, deviceUserOk, deviceVerdict, normFp, type DeviceRow } from './device-guard';

const FP = 'ab'.repeat(32);
const active: DeviceRow = { id: 'd1', status: 'active', firmId: null, name: 'Канцеларија – уред 1' };
const revoked: DeviceRow = { ...active, status: 'revoked' };

describe('device guard', () => {
  it('mode: only optional / required switch it on', () => {
    expect(deviceMode(undefined)).toBe('off');
    expect(deviceMode('')).toBe('off');
    expect(deviceMode('OPTIONAL')).toBe('optional');
    expect(deviceMode(' required ')).toBe('required');
    expect(deviceMode('yes')).toBe('off');
  });

  it('fingerprint header: Caddy hex, colon form, unresolved placeholder', () => {
    expect(normFp(FP.toUpperCase())).toBe(FP);
    expect(normFp(FP.match(/../g)!.join(':'))).toBe(FP);
    expect(normFp('{http.request.tls.client.fingerprint}')).toBe('');
    expect(normFp(null)).toBe('');
    expect(normFp('abc')).toBe('');
  });

  it('off: nothing is checked', () => {
    expect(deviceVerdict('off', '/', '', null)).toEqual({ ok: true, device: null });
    expect(deviceVerdict('off', '/', FP, revoked).ok).toBe(true);
  });

  it('optional: no certificate passes; revoked / unknown refused; active passes', () => {
    expect(deviceVerdict('optional', '/', '', null).ok).toBe(true);
    expect(deviceVerdict('optional', '/', FP, null)).toEqual({ ok: false, reason: 'unknown' });
    expect(deviceVerdict('optional', '/login', FP, revoked)).toEqual({ ok: false, reason: 'revoked' });
    expect(deviceVerdict('optional', '/', FP, active)).toEqual({ ok: true, device: active });
  });

  it('required: no certificate refused (also the login page); the health check is free', () => {
    expect(deviceVerdict('required', '/login', '', null)).toEqual({ ok: false, reason: 'none' });
    expect(deviceVerdict('required', '/api/health', '', null).ok).toBe(true);
    expect(deviceVerdict('required', '/', FP, revoked)).toEqual({ ok: false, reason: 'revoked' });
    expect(deviceVerdict('required', '/', FP, active).ok).toBe(true);
  });

  it('a device bound to a client firm: that firm\'s client users and office staff only', () => {
    const d = { ...active, firmId: 'F1' };
    expect(deviceUserOk(d, 'klient', ['F1'], 'F1')).toBe(true);
    expect(deviceUserOk(d, 'klient', ['F1', 'F2'], undefined)).toBe(true);
    expect(deviceUserOk(d, 'klient', ['F1', 'F2'], 'F2')).toBe(false);
    expect(deviceUserOk(d, 'klient', ['F2'], 'F2')).toBe(false);
    expect(deviceUserOk(d, 'acc', [], 'F9')).toBe(true);
    expect(deviceUserOk(d, 'admin', [], null)).toBe(true);
    expect(deviceUserOk(active, 'klient', ['F2'], 'F2')).toBe(true); // office device
    expect(deviceUserOk(null, 'klient', [], null)).toBe(true);
  });

  it('the refusal page says why, without a login form', () => {
    const h = devicePage('revoked');
    expect(h).toContain('одземен');
    expect(h).not.toContain('<form');
  });
});
