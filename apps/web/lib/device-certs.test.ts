import { execFileSync } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_CA_CN, buildDeviceInstaller, createCa, deviceCn, fingerprintOf, issueDeviceCert, loadCa, openBundle, readDeviceTrailer,
  sealBundle, slug,
} from './device-certs';

const ca = createCa();
const NAME = 'Рент-а-кар Скопје – уред 1 – каса 1';
const dev = issueDeviceCert(ca, NAME, { password: 'test-pw' });

describe('device CA + certificate', () => {
  it('the CA is self-signed, CA:TRUE, with the WISE CN', () => {
    const x = new X509Certificate(ca.certPem);
    expect(x.ca).toBe(true);
    expect(x.subject).toContain(`CN=${DEVICE_CA_CN}`);
    expect(x.verify(x.publicKey)).toBe(true);
  });

  it('the device certificate is signed by the CA, CN = device name (Cyrillic), clientAuth, 3 years', () => {
    const x = new X509Certificate(dev.certPem);
    const c = new X509Certificate(ca.certPem);
    expect(x.verify(c.publicKey)).toBe(true);
    expect(x.checkIssued(c)).toBe(true);
    expect(x.ca).toBe(false);
    expect(x.subject).toContain(`CN=${NAME}`);
    expect(x.issuer).toContain(`CN=${DEVICE_CA_CN}`);
    expect(x.keyUsage).toContain('1.3.6.1.5.5.7.3.2'); // id-kp-clientAuth
    const years = (new Date(x.validTo).getTime() - Date.now()) / (365.25 * 864e5);
    expect(years).toBeGreaterThan(2.95);
    expect(years).toBeLessThan(3.05);
    expect(dev.notAfter.getTime()).toBe(new Date(x.validTo).getTime());
    expect(dev.serial).toBe(x.serialNumber.toLowerCase());
    expect(dev.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(dev.fingerprint).toBe(fingerprintOf(dev.certPem));
    // another certificate for the same name gets another serial / fingerprint
    const d2 = issueDeviceCert(ca, NAME);
    expect(d2.serial).not.toBe(dev.serial);
    expect(d2.fingerprint).not.toBe(dev.fingerprint);
    expect(d2.password).toMatch(/^[\w-]{20,}$/);
  });

  it('a certificate of another CA does not verify', () => {
    const other = createCa('Someone Else CA');
    expect(new X509Certificate(dev.certPem).verify(new X509Certificate(other.certPem).publicKey)).toBe(false);
  });

  it('the .p12 opens with its password (key + certificate, no CA inside) and not with another', () => {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(dev.p12.toString('binary')), 'test-pw');
    const certs = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]!;
    const keys = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag! })[forge.pki.oids.pkcs8ShroudedKeyBag!]!;
    expect(certs).toHaveLength(1);
    expect(keys).toHaveLength(1);
    expect(forge.pki.certificateToPem(certs[0]!.cert!).replace(/\r/g, '')).toBe(dev.certPem.replace(/\r/g, ''));
    expect(() => forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(dev.p12.toString('binary')), 'wrong')).toThrow();
  });

  it('openssl reads the .p12 too (skipped without openssl)', () => {
    let ok = true;
    try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { ok = false; }
    if (!ok) return;
    const d = mkdtempSync(path.join(tmpdir(), 'wise-p12-'));
    const f = path.join(d, 'd.p12');
    writeFileSync(f, dev.p12);
    const args = ['pkcs12', '-in', f, '-passin', 'pass:test-pw', '-nokeys', '-clcerts'];
    let out = '';
    try { out = execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {
      out = execFileSync('openssl', [...args, '-legacy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); // OpenSSL 3 without the legacy provider loaded
    }
    expect(out).toContain('BEGIN CERTIFICATE');
  });

  it('names longer than 64 characters are cut for the CN', () => {
    expect([...deviceCn('А'.repeat(80))]).toHaveLength(64);
    expect(deviceCn('  АЛФА   ДООЕЛ  ')).toBe('АЛФА ДООЕЛ');
    expect(() => issueDeviceCert(ca, '   ')).toThrow();
  });

  it('loadCa reads an OpenSSL-style CA (PKCS#8 key) from DEVICE_CA_DIR and signs with it', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'wise-ca-'));
    mkdirSync(path.join(d, 'public')); mkdirSync(path.join(d, 'private'));
    writeFileSync(path.join(d, 'public', 'ca.crt'), ca.certPem);
    writeFileSync(path.join(d, 'private', 'ca.key'), createPrivateKey(ca.keyPem).export({ type: 'pkcs8', format: 'pem' }) as string);
    const L = await loadCa(d);
    expect(L).not.toBeNull();
    const x = issueDeviceCert(L!, 'Канцеларија – уред 1');
    expect(new X509Certificate(x.certPem).verify(new X509Certificate(ca.certPem).publicKey)).toBe(true);
    expect(await loadCa(path.join(d, 'nope'))).toBeNull();
  });
});

describe('stored bundle and per-device installer', () => {
  it('seal / open round trip; another CA cannot open it', () => {
    const s = sealBundle(ca, dev);
    expect(s).not.toContain('test-pw');
    const o = openBundle(ca, s);
    expect(o.password).toBe('test-pw');
    expect(o.p12.equals(dev.p12)).toBe(true);
    expect(() => openBundle(createCa('X'), s)).toThrow();
  });

  it('the installer = generic exe + trailer; the trailer gives back the .p12 and the password', () => {
    const base = Buffer.from('MZ fake installer bytes … WISE-Setup');
    const exe = buildDeviceInstaller(base, dev.p12, { name: NAME, password: dev.password });
    expect(exe.subarray(0, base.length).equals(base)).toBe(true);
    expect(exe.subarray(-8).toString('latin1')).toBe('WISEDEV1');
    const t = readDeviceTrailer(exe)!;
    expect(t.p12.equals(dev.p12)).toBe(true);
    expect(t.meta).toEqual({ v: 1, issuer: DEVICE_CA_CN, name: NAME, password: 'test-pw' });
    expect(readDeviceTrailer(base)).toBeNull();
    expect(() => buildDeviceInstaller(exe, dev.p12, { name: NAME, password: 'x' })).toThrow();
  });

  it('slug for the installer file name', () => {
    expect(slug('АЛФА ДООЕЛ Скопје')).toBe('ALFA-DOOEL-Skopje');
    expect(slug('Рент-а-кар „Ѓорѓи“ ДОО')).toBe('Rent-a-kar-Gjorgji-DOO');
    expect(slug('Канцеларија')).toBe('Kancelarija');
    expect(slug('„“')).toBe('ured');
  });
});
