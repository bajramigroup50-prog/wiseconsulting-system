/**
 * ✍ Договор за сметководствени услуги (owner decision): made BY the office firm (БАЈРАМИ ГРОУП ДООЕЛ Скопје) WITH
 * each client, from one screen, office OWNER only — another administrator, an accountant and a client are refused by
 * the page, every action and the print view; the provider data come from the office firm's record.
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ enqueue: async () => 'job', renderPdf: async () => 'x' }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const Page = (await import('@/app/(app)/kdogovori/page')).default;
const Print = (await import('@/app/(print)/kdogovori/pecati/page')).default;
const A = await import('@/app/(app)/kdogovori/actions');

const MSG = 'Само за сопственикот на канцеларијата.';
const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
let off = '', cli = '', cli2 = '';

beforeAll(async () => {
  await setupDb();
  const [o, c, c2] = await pg.insert(schema.firms).values([
    { name: 'БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ', address: 'ул. Пример 1', city: 'Скопје', edb: '4030000000001', embs: '7000001', settings: { signer: 'Сопственик', signerRole: 'Управител', bankAccount: '300-111' } },
    { name: 'КЛИЕНТ ЕДЕН ДОО', city: 'Битола', edb: '4002000000002', email: 'klient@example.mk' },
    { name: 'КЛИЕНТ ДВА ДООЕЛ', city: 'Охрид' },
  ]).returning();
  off = o!.id; cli = c!.id; cli2 = c2!.id;
  for (const [k, role, firms] of [['owner', 'admin', []], ['admin2', 'admin', []], ['acc', 'acc', []], ['kl', 'klient', [cli]]] as const) {
    const id = await signIn(role, { username: `kd_${k}`, ...(firms.length ? { firms: [...firms] } : {}) });
    if (k === 'owner') await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, id));
    S[k] = jar.get('wc_sess')!;
  }
}, 120_000);

const newContract = () => JSON.stringify({ date: '2026-10-12', place: 'Скопје', fee: 3000, feeMode: 'gross', rep: 'Застапник Клиент', repRole: 'Управител' });

describe('kdogovori — office owner only', () => {
  it('others are refused: page, every action, print', async () => {
    for (const who of ['admin2', 'acc']) {
      as(who);
      useFirm(cli);
      expect(await html(Page({ searchParams: Promise.resolve({ f: cli }) }))).toContain(MSG);
      expect(await A.saveContract(cli, newContract())).toEqual({ error: MSG });
      expect(await A.officeSign(cli, '00000000-0000-0000-0000-000000000000')).toEqual({ error: MSG });
      expect(await A.deleteContract(cli, '00000000-0000-0000-0000-000000000000')).toEqual({ error: MSG });
      expect(await A.endContract(cli, '00000000-0000-0000-0000-000000000000')).toEqual({ error: MSG });
      expect(await A.contractToDossier(cli, '00000000-0000-0000-0000-000000000000')).toEqual({ error: MSG });
      expect(await A.syncRecurring()).toEqual({ error: MSG });
      expect(await A.saveOffice({}, form({ fee: 1 }))).toEqual({ error: MSG });
      expect(await A.setOfficeFirm({}, form({ officeFirmId: cli }))).toEqual({ error: MSG });
      expect(await A.mailContract({}, form({ firmId: cli, id: 'x' }))).toEqual({ error: MSG });
      expect(await A.uploadSignedCopy({}, form({ firmId: cli, id: 'x' }))).toEqual({ error: MSG });
      expect(await A.clientSign({}, form({ firmId: cli, id: 'x' }))).toEqual({ error: MSG });
    }
    as('kl');
    useFirm(cli);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(await A.saveContract(cli, newContract())).toEqual({ error: MSG });
  });

  it('the owner makes contracts with any client from one screen; БАЈРАМИ ГРОУП is the provider', async () => {
    as('owner');
    useFirm(cli2); // the current firm does not matter
    const r = await A.saveContract(cli, newContract());
    expect(r).toHaveProperty('ok');
    const [row] = await pg.select().from(schema.serviceContracts).where(eq(schema.serviceContracts.firmId, cli));
    expect(row).toBeTruthy();
    expect(await A.saveContract(off, newContract())).toHaveProperty('error'); // the office firm is never the client
    const page = await html(Page({ searchParams: Promise.resolve({ f: cli }) }));
    expect(page).toContain('КЛИЕНТ ЕДЕН ДОО');
    expect(page).toContain('давател: БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ');
    expect(page).toContain('автоматски препознаена');
    const pr = await html(Print({ searchParams: Promise.resolve({ id: row!.id, builtin: '1' }) }));
    expect(pr).toContain('БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ');
    expect(pr).toContain('КЛИЕНТ ЕДЕН ДОО');
    expect(pr).toContain('300-111');
    // signing by the owner, then the client firm summary
    expect(await A.officeSign(cli, row!.id)).toHaveProperty('ok');
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.id, cli));
    expect((f!.settings as { kdog?: { st?: string } }).kdog?.st).toBe('чека потпис од клиентот');
    // print refused for others
    as('admin2');
    await expect(Print({ searchParams: Promise.resolve({ id: row!.id }) })).rejects.toThrow();
  });

  it('„Фирма на канцеларијата“ is picked once by the owner and copied into the office profile', async () => {
    as('owner');
    expect(await A.setOfficeFirm({}, form({ officeFirmId: off }))).toHaveProperty('ok');
    const [o] = await pg.select().from(schema.firms).where(eq(schema.firms.id, off));
    expect((o!.settings as { officeFirm?: boolean }).officeFirm).toBe(true);
    const [p] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office'));
    expect(p!.value).toMatchObject({ name: 'БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ', edb: '4030000000001' });
  });
});
