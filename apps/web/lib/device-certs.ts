/**
 * 🔐 Device certificates (mutual TLS): a private CA on the server signs one client certificate per enrolled computer.
 * Caddy asks every visitor for a certificate signed by this CA (`DEVICE_CERTS`, docker/Caddyfile); the app refuses
 * revoked / unknown ones (`lib/device-guard.ts`, `proxy.ts`).
 *
 * - CA: created once on the server with `docker/device-ca.sh` (openssl) → `/opt/wise/ca/private/ca.key` (only the app
 *   container reads it, mounted at `DEVICE_CA_DIR`, default `/run/wise-ca`) and `/opt/wise/ca/public/ca.crt` (Caddy's
 *   trust pool). Never in git.
 * - Device certificate: RSA 2048 (node crypto) signed with node-forge (pure JS — the slim Docker image has no openssl
 *   CLI), CN = device name, 3 years, EKU clientAuth; exported as a password-protected PKCS#12 (3DES / SHA-1 MAC: the
 *   format every Windows 10/11 imports). The CA certificate is NOT put in the .p12 — importing a CA into the user's
 *   Root store makes Windows show a security warning; Caddy only needs the leaf.
 * - Per-device installer: the generic `WISE-Setup.exe` (built once on Windows, `desktop/`) + a trailer with the .p12
 *   and its password (`buildDeviceInstaller`). The NSIS installer reads its own trailer and imports the certificate
 *   silently (`desktop/build/wise-device.ps1`). Built on Linux with no Windows tooling: the trailer is appended.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import forge from 'node-forge';

export const DEVICE_CA_CN = 'WISE CONSULTING Device CA';
export const DEVICE_ORG = 'WISE CONSULTING';
/** X.509 upper bound for a commonName (RFC 5280 ub-common-name). */
export const CN_MAX = 64;

export interface CaMaterial { certPem: string; keyPem: string }

/** Where the CA lives inside the app container (`/opt/wise/ca` on the host). */
export const caDir = () => process.env.DEVICE_CA_DIR || '/run/wise-ca';

/** The CA from `DEVICE_CA_DIR` (`public/ca.crt`, `private/ca.key`), or null when it is not created yet. */
export async function loadCa(dir = caDir()): Promise<CaMaterial | null> {
  try {
    const [certPem, keyPem] = await Promise.all([
      readFile(path.join(dir, 'public', 'ca.crt'), 'utf8'), readFile(path.join(dir, 'private', 'ca.key'), 'utf8'),
    ]);
    return { certPem, keyPem };
  } catch { return null; }
}

/** Lower-case hex SHA-256 of the DER certificate — the value of Caddy's `{http.request.tls.client.fingerprint}`. */
export const fingerprintOf = (certPem: string) => new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();

export { normFp } from './device-guard';

/** Device name → commonName: trimmed, single spaces, at most 64 characters. */
export const deviceCn = (name: string) => [...name.replace(/\s+/g, ' ').trim()].slice(0, CN_MAX).join('');

/** forge (PKCS#1) private key from any PEM node understands (OpenSSL 3 writes PKCS#8). */
const forgeKey = (pem: string) => forge.pki.privateKeyFromPem(createPrivateKey(pem).export({ type: 'pkcs1', format: 'pem' }) as string);

/** A positive 128-bit serial (hex) — random, so a serial is never reused. */
const newSerial = () => { const b = randomBytes(16); b[0] = (b[0]! & 0x7f) | 0x10; return b.toString('hex'); };

const utf8Attr = (name: string, value: string) => ({ name, value, valueTagClass: forge.asn1.Type.UTF8 as unknown as number });

function rsaPair(bits: number) {
  const k = generateKeyPairSync('rsa', { modulusLength: bits });
  return {
    priv: forge.pki.privateKeyFromPem(k.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string),
    pub: forge.pki.publicKeyFromPem(k.publicKey.export({ type: 'spki', format: 'pem' }) as string),
  };
}

/** Whole seconds (X.509 time has no milliseconds), so the stored expiry equals the certificate's. */
const yearsFrom = (d: Date, years: number) => { const x = new Date(d); x.setFullYear(x.getFullYear() + years); x.setMilliseconds(0); return x; };

/** A new CA (tests, and a fallback to `docker/device-ca.sh`): RSA 3072, 10 years, CA:TRUE pathlen 0. */
export function createCa(cn = DEVICE_CA_CN, years = 10): CaMaterial {
  const { priv, pub } = rsaPair(3072);
  const c = forge.pki.createCertificate();
  c.publicKey = pub;
  c.serialNumber = newSerial();
  const now = new Date();
  c.validity.notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000 - 5 * 6e4);
  c.validity.notAfter = yearsFrom(now, years);
  const subj = [utf8Attr('organizationName', DEVICE_ORG), utf8Attr('commonName', cn)];
  c.setSubject(subj); c.setIssuer(subj);
  c.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  c.sign(priv, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(c), keyPem: forge.pki.privateKeyToPem(priv) };
}

export interface IssuedDevice {
  certPem: string;
  /** PKCS#12 (DER) with the device key + certificate, encrypted with `password`. */
  p12: Buffer;
  password: string;
  serial: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
  cn: string;
}

/** A random p12 password (no ambiguous characters; it is never typed — the installer carries it). */
export const newP12Password = () => randomBytes(18).toString('base64url');

/** Issues a client certificate for one device, signed by the CA (default 3 years). */
export function issueDeviceCert(ca: CaMaterial, name: string, opts: { years?: number; password?: string; now?: Date } = {}): IssuedDevice {
  const cn = deviceCn(name);
  if (!cn) throw new Error('Device name is empty');
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const caKey = forgeKey(ca.keyPem);
  const { priv, pub } = rsaPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = pub;
  c.serialNumber = newSerial();
  const now = opts.now ?? new Date();
  c.validity.notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000 - 5 * 6e4);
  c.validity.notAfter = yearsFrom(now, opts.years ?? 3);
  c.setSubject([utf8Attr('organizationName', DEVICE_ORG), utf8Attr('organizationalUnitName', 'Devices'), utf8Attr('commonName', cn)]);
  c.setIssuer(caCert.subject.attributes);
  c.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', clientAuth: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  c.sign(caKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(c);
  const password = opts.password ?? newP12Password();
  const asn = forge.pkcs12.toPkcs12Asn1(priv, [c], password, { algorithm: '3des', friendlyName: 'WISE CONSULTING' });
  const p12 = Buffer.from(forge.asn1.toDer(asn).getBytes(), 'binary');
  return {
    certPem, p12, password, serial: c.serialNumber.toLowerCase(), fingerprint: fingerprintOf(certPem),
    notBefore: c.validity.notBefore, notAfter: c.validity.notAfter, cn,
  };
}

/* ---------- stored bundle (the .p12 + password until the device first connects) ---------- */

const bundleKey = (ca: CaMaterial) => createHash('sha256').update('wise-device-bundle|').update(ca.keyPem).digest();

/** AES-256-GCM with a key derived from the CA key: the database alone does not reveal the .p12 password. */
export function sealBundle(ca: CaMaterial, b: { p12: Buffer; password: string }): string {
  const iv = randomBytes(12);
  const ci = createCipheriv('aes-256-gcm', bundleKey(ca), iv);
  const body = Buffer.concat([ci.update(JSON.stringify({ p12: b.p12.toString('base64'), pw: b.password }), 'utf8'), ci.final()]);
  return ['v1', iv.toString('base64'), ci.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function openBundle(ca: CaMaterial, sealed: string): { p12: Buffer; password: string } {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('bad bundle');
  const de = createDecipheriv('aes-256-gcm', bundleKey(ca), Buffer.from(iv, 'base64'));
  de.setAuthTag(Buffer.from(tag, 'base64'));
  const o = JSON.parse(Buffer.concat([de.update(Buffer.from(body, 'base64')), de.final()]).toString('utf8')) as { p12: string; pw: string };
  return { p12: Buffer.from(o.p12, 'base64'), password: o.pw };
}

/* ---------- per-device installer: generic WISE-Setup.exe + trailer ---------- */

/** Trailer: [p12][meta JSON utf-8][u32le p12 length][u32le meta length]["WISEDEV1"] — read by desktop/build/wise-device.ps1. */
export const TRAILER_MAGIC = 'WISEDEV1';
export interface InstallerMeta { v: 1; name: string; password: string; issuer: string }

/** Where the generic installer is mounted in the app container (`/opt/wise/download` on the host). */
export const installerPath = () => process.env.DEVICE_INSTALLER || '/opt/wise-download/WISE-Setup.exe';

export const hasTrailer = (exe: Buffer) => exe.length >= 16 && exe.subarray(exe.length - 8).toString('latin1') === TRAILER_MAGIC;

/** The bytes appended to the generic installer for one device. */
export function deviceTrailer(p12: Buffer, meta: Omit<InstallerMeta, 'v' | 'issuer'> & { issuer?: string }): Buffer {
  const m = Buffer.from(JSON.stringify({ v: 1, issuer: DEVICE_CA_CN, ...meta } satisfies InstallerMeta), 'utf8');
  const tail = Buffer.alloc(16);
  tail.writeUInt32LE(p12.length, 0); tail.writeUInt32LE(m.length, 4); tail.write(TRAILER_MAGIC, 8, 'latin1');
  return Buffer.concat([p12, m, tail]);
}

export function buildDeviceInstaller(baseExe: Buffer, p12: Buffer, meta: Omit<InstallerMeta, 'v' | 'issuer'> & { issuer?: string }): Buffer {
  if (hasTrailer(baseExe)) throw new Error('The base installer already carries a device certificate');
  return Buffer.concat([baseExe, deviceTrailer(p12, meta)]);
}

/** Reads the trailer back (tests; same algorithm as the PowerShell script). */
export function readDeviceTrailer(exe: Buffer): { p12: Buffer; meta: InstallerMeta } | null {
  if (!hasTrailer(exe)) return null;
  const end = exe.length - 16;
  const pl = exe.readUInt32LE(end), ml = exe.readUInt32LE(end + 4);
  if (pl + ml > end) return null;
  const p12 = exe.subarray(end - ml - pl, end - ml);
  return { p12, meta: JSON.parse(exe.subarray(end - ml, end).toString('utf8')) as InstallerMeta };
}

/** ASCII-safe slug for the installer file name („АЛФА ДООЕЛ Скопје“ → „ALFA-DOOEL-Skopje“). */
const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm',
  н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh',
  ë: 'e', ç: 'c',
};
export function slug(s: string): string {
  const t = [...s].map((ch) => { const lo = ch.toLowerCase(); const r = TR[lo]; return r === undefined ? ch : ch === lo ? r : r.charAt(0).toUpperCase() + r.slice(1); }).join('');
  return t.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ured';
}
