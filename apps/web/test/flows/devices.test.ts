/**
 * 🔐 Уреди (компјутери): only the office owner creates / revokes devices and downloads their installer (PGlite);
 * the device name and number are generated from the chosen firm; the installer carries the device's .p12; revocation
 * makes the proxy refuse the device; in `required` mode a request without a certificate is refused; a device bound to
 * a client firm refuses that firm's neighbours' client users.
 */
import { X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import forge from 'node-forge';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn } from '../harness';
import { createCa, readDeviceTrailer } from '@/lib/device-certs';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const ca = createCa();
const dir = mkdtempSync(path.join(tmpdir(), 'wise-dev-'));
mkdirSync(path.join(dir, 'ca', 'public'), { recursive: true }); mkdirSync(path.join(dir, 'ca', 'private'));
writeFileSync(path.join(dir, 'ca', 'public', 'ca.crt'), ca.certPem);
writeFileSync(path.join(dir, 'ca', 'private', 'ca.key'), ca.keyPem);
const BASE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(70_000, 7)]);
writeFileSync(path.join(dir, 'WISE-Setup.exe'), BASE);
process.env.DEVICE_CA_DIR = path.join(dir, 'ca');
process.env.DEVICE_INSTALLER = path.join(dir, 'WISE-Setup.exe');

const UrediPage = (await import('@/app/(app)/uredi/page')).default;
const { createDevice, revokeDevice } = await import('@/app/(app)/uredi/actions');
const installer = await import('@/app/(app)/uredi/installer/[id]/route');
const { proxy } = await import('@/proxy');
const { forgetDevice } = await import('@/lib/device-lookup');

const MSG = 'Само за сопственикот на канцеларијата.';
const S: Record<string, string> = {};
const U: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let f1 = '', f2 = '';
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const dev = async (id: string) => (await pg.select().from(schema.devices).where(eq(schema.devices.id, id)))[0]!;
const newDevice = async (firm: string, suffix?: string) => {
  const r = await act(createDevice({}, form({ firm, suffix })));
  expect(r).toHaveProperty('redirect');
  return (r as { redirect: string }).redirect.split('nov=')[1]!;
};
const download = (id: string) => installer.GET(new Request(`https://x.test/uredi/installer/${id}`), { params: Promise.resolve({ id }) });
const req = (p: string, fp?: string, cookies: Record<string, string> = {}) => new NextRequest(`https://wise.test${p}`, {
  headers: {
    ...(fp ? { 'x-wise-client-fp': fp } : {}), 'x-forwarded-for': '203.0.113.7',
    cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '),
  },
});

beforeAll(async () => {
  await setupDb();
  const [a, b] = await pg.insert(schema.firms).values([{ name: 'АЛФА ДООЕЛ Скопје' }, { name: 'БЕТА ДОО' }]).returning();
  f1 = a!.id; f2 = b!.id;
  for (const [k, role, firms] of [['owner', 'admin', []], ['admin2', 'admin', []], ['acc', 'acc', []], ['kl1', 'klient', [a!.id]], ['kl2', 'klient', [b!.id]]] as const) {
    U[k] = await signIn(role, { username: k, ...(firms.length ? { firms: [...firms] } : {}) });
    S[k] = jar.get('wc_sess')!;
  }
  await pg.update(schema.users).set({ createdAt: new Date('2020-01-01T00:00:00Z') }).where(eq(schema.users.id, U.owner!));
}, 120_000);

afterEach(() => { delete process.env.DEVICE_CERTS; forgetDevice(); });

describe('🔐 Уреди — owner only', () => {
  it('another administrator sees the refusal and cannot create, revoke or download', async () => {
    as('admin2');
    expect(await html(UrediPage({ searchParams: Promise.resolve({}) }))).toContain(MSG);
    expect(await createDevice({}, form({ firm: 'office' }))).toEqual({ error: MSG });
    expect(await revokeDevice('00000000-0000-0000-0000-000000000000')).toEqual({ error: MSG });
    expect((await download('00000000-0000-0000-0000-000000000000')).status).toBe(403);
    as('acc');
    expect(await createDevice({}, form({ firm: 'office' }))).toEqual({ error: MSG });
  });

  it('the owner picks a firm; name „<firm> – уред N [– suffix]“, numbered per firm; audited', async () => {
    as('owner');
    const a = await newDevice(f1);
    const b = await newDevice(f1, '  каса   1 ');
    const o = await newDevice('office');
    const A = await dev(a), B = await dev(b), O = await dev(o);
    expect([A.name, A.no, A.firmId]).toEqual(['АЛФА ДООЕЛ Скопје – уред 1', 1, f1]);
    expect([B.name, B.no]).toEqual(['АЛФА ДООЕЛ Скопје – уред 2 – каса 1', 2]);
    expect([O.name, O.no, O.firmId]).toEqual(['Канцеларија – уред 1', 1, null]);
    expect(A.status).toBe('active');
    expect(A.bundle).toMatch(/^v1\./);
    expect(A.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await createDevice({}, form({ firm: 'nope' }))).toHaveProperty('error');
    const log = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'deviceNew'));
    expect(log.length).toBe(3);
    const page = await html(UrediPage({ searchParams: Promise.resolve({ nov: a }) }));
    expect(page).toContain('⬇ Преземи инсталација за овој уред');
    expect(page).toContain('АЛФА ДООЕЛ Скопје – уред 2 – каса 1');
    expect(page).toContain('Канцеларија (нашата)');
    expect(page.indexOf('Канцеларија (нашата) <span')).toBeLessThan(page.indexOf('АЛФА ДООЕЛ Скопје <span')); // office group first
  });

  it('the installer = generic setup + this device\'s .p12 (CN = name, signed by the CA), named after the firm', async () => {
    as('owner');
    const id = await newDevice(f2);
    const r = await download(id);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('WISE-Setup-BETA-DOO-ured-1.exe');
    const exe = Buffer.from(await r.arrayBuffer());
    expect(Number(r.headers.get('content-length'))).toBe(exe.length);
    expect(exe.subarray(0, BASE.length).equals(BASE)).toBe(true);
    const t = readDeviceTrailer(exe)!;
    expect(t.meta.name).toBe('БЕТА ДОО – уред 1');
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(t.p12.toString('binary')), t.meta.password);
    const cert = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]![0]!.cert!;
    const x = new X509Certificate(forge.pki.certificateToPem(cert));
    expect(x.subject).toContain('CN=БЕТА ДОО – уред 1');
    expect(x.verify(new X509Certificate(ca.certPem).publicKey)).toBe(true);
    expect(x.fingerprint256.replace(/:/g, '').toLowerCase()).toBe((await dev(id)).fingerprint);
    expect((await dev(id)).downloads).toBe(1);
  });

  it('revoke: audited, bundle dropped, the proxy refuses the device; optional lets a computer without a certificate in', async () => {
    as('owner');
    const id = await newDevice('office', 'PC2');
    const fp = (await dev(id)).fingerprint;
    process.env.DEVICE_CERTS = 'optional';
    expect((await proxy(req('/', fp))).status).not.toBe(403);
    expect((await proxy(req('/'))).status).not.toBe(403);
    expect((await proxy(req('/', 'cd'.repeat(32)))).status).toBe(403); // signed by us, but unknown
    expect(await revokeDevice(id, 'украден')).toEqual({ ok: 'Пристапот за „Канцеларија – уред 2 – PC2“ е одземен.' });
    const d = await dev(id);
    expect([d.status, d.bundle, d.revokedBy, d.revokeReason]).toEqual(['revoked', null, U.owner, 'украден']);
    const r = await proxy(req('/login', fp));
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('одземен');
    expect((await download(id)).status).toBe(404);
    expect(await revokeDevice(id)).toHaveProperty('error');
    expect((await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'deviceRevoke'))).length).toBe(1);
    process.env.DEVICE_CERTS = 'off';
    expect((await proxy(req('/', fp))).status).not.toBe(403);
  });

  it('required: no certificate → 403 (health check free); active device passes and is marked seen (bundle cleared)', async () => {
    as('owner');
    const id = await newDevice('office');
    const fp = (await dev(id)).fingerprint;
    process.env.DEVICE_CERTS = 'required';
    expect((await proxy(req('/login'))).status).toBe(403);
    expect((await proxy(req('/api/health'))).status).not.toBe(403);
    expect((await proxy(req('/login', fp))).status).not.toBe(403);
    await vi.waitFor(async () => { expect((await dev(id)).lastSeenAt).not.toBeNull(); });
    const d = await dev(id);
    expect(d.lastSeenIp).toBe('203.0.113.7');
    expect(d.bundle).toBeNull();
    expect((await download(id)).status).toBe(410);
  });

  it('a device of a client firm: its own client users and office staff only', async () => {
    as('owner');
    const id = await newDevice(f1, 'каса');
    const fp = (await dev(id)).fingerprint;
    process.env.DEVICE_CERTS = 'optional';
    expect((await proxy(req('/klHome', fp, { wc_sess: S.kl1!, wc_fid: f1 }))).status).not.toBe(403);
    const no = await proxy(req('/klHome', fp, { wc_sess: S.kl2!, wc_fid: f2 }));
    expect(no.status).toBe(403);
    expect(await no.text()).toContain('друга фирма');
    expect((await proxy(req('/', fp, { wc_sess: S.acc! }))).status).not.toBe(403);
  });
});
