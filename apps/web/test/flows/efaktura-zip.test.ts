/**
 * P34 — bulk e-Фактура export (`POST /api/ubl/zip`): period / not yet exported / ticked invoices → ZIP of validated
 * UBL XML + `lista.csv`; invoices that fail the checks stay out with the reason; exported ones get `data.efExport`.
 */
import PizZip from 'pizzip';
import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const Zip = await import('@/app/api/ubl/zip/route');
const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let fa = '', ok1 = '', ok2 = '', bad = '', draft = '';
const Y = 2026;

const post = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return Zip.POST(new Request('http://localhost/api/ubl/zip', { method: 'POST', body: f }));
};
const unzip = async (r: Response) => {
  const z = new PizZip(new Uint8Array(await r.arrayBuffer()));
  return Object.fromEntries(Object.values(z.files).filter((x) => !x.dir).map((x) => [x.name, x.asText()]));
};

beforeAll(async () => {
  await setupDb();
  const [a] = await pg.insert(schema.firms).values({ name: 'ЕФ ПРОДАВАЧ ДООЕЛ', edb: '4030000000777', city: 'Скопје', address: 'ул. 7', vatRegistered: true, settings: { bank: '300000000000777' } }).returning();
  fa = a!.id;
  S.acc = await signIn('acc', { username: 'ef_acc', firms: [fa] }).then(() => jar.get('wc_sess')!);
  S.view = await signIn('view', { username: 'ef_view', firms: [fa] }).then(() => jar.get('wc_sess')!);
  const [good, noEdb] = await pg.insert(schema.partners).values([
    { firmId: fa, name: 'Купувач Добар ДОО', edb: '4030000000888', address: 'ул. 8', city: 'Битола', vatRegistered: true },
    { firmId: fa, name: 'Купувач Без ЕДБ', address: '', city: '' },
  ]).returning();
  const inv = (number: string, date: string, partnerId: string, status: 'posted' | 'draft' = 'posted') => ({ firmId: fa, kind: 'invoice' as const, number, date, partnerId, status, base: '1000', vat: '180', total: '1180' });
  const I = await pg.insert(schema.invoices).values([inv('1/2026', `${Y}-01-10`, good!.id), inv('2/2026', `${Y}-02-10`, good!.id), inv('3/2026', `${Y}-02-11`, noEdb!.id), inv('4/2026', `${Y}-02-12`, good!.id, 'draft')]).returning();
  [ok1, ok2, bad, draft] = I.map((x) => x.id) as [string, string, string, string];
  await pg.insert(schema.invoiceLines).values(I.map((x) => ({ invoiceId: x.id, lineNo: 1, name: 'Услуга', unit: 'ком', qty: '1', price: '1000', rate: 18, account: '7400' })));
  useFirm(fa); useYear(Y);
}, 120_000);

describe('P34 bulk e-Фактура ZIP', () => {
  it('the view role cannot export; a wrong firm is refused', async () => {
    as('view');
    expect((await post({ fid: fa, sel: 'period', from: `${Y}-01-01`, to: `${Y}-12-31` })).status).toBe(403);
    as('acc');
    expect((await post({ fid: '00000000-0000-0000-0000-000000000000', sel: 'period', from: `${Y}-01-01`, to: `${Y}-12-31` })).status).toBe(409);
  });

  it('period: valid invoices in the ZIP, failures listed with the reason, marker on the exported ones', async () => {
    as('acc');
    const r = await post({ fid: fa, sel: 'period', from: `${Y}-01-01`, to: `${Y}-12-31` });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ef-exported')).toBe('2');
    expect(r.headers.get('x-ef-failed')).toBe('2');
    const F = await unzip(r);
    expect(Object.keys(F).sort()).toEqual(['eFaktura_1_2026.xml', 'eFaktura_2_2026.xml', 'lista.csv']);
    expect(F['eFaktura_1_2026.xml']).toContain('<cbc:CompanyID>MK4030000000888</cbc:CompanyID>');
    const csv = F['lista.csv']!;
    expect(csv).toMatch(/3\/2026;[^\n]*НЕ Е ИЗВЕЗЕНА;[^\n]*купувач: нема ЕДБ/);
    expect(csv).toMatch(/4\/2026;[^\n]*НЕ Е ИЗВЕЗЕНА;не е книжена \(нацрт\)/);
    const D = await pg.select({ id: schema.invoices.id, d: schema.invoices.data }).from(schema.invoices).where(inArray(schema.invoices.id, [ok1, ok2, bad, draft]));
    const m = new Map(D.map((x) => [x.id, x.d.efExport]));
    expect(m.get(ok1)).toMatchObject({ n: 1 });
    expect(m.get(ok2)).toMatchObject({ n: 1 });
    expect(m.get(bad)).toBeUndefined();
    expect(m.get(draft)).toBeUndefined();
    const [log] = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'efExport'));
    expect(log?.data).toMatchObject({ exported: 2, failed: 2 });
  });

  it('unsent: only the posted ones not exported yet; ticked: exactly those', async () => {
    as('acc');
    // the remaining unsent posted invoice is the one that fails → listed, nothing in the ZIP
    const u = await post({ fid: fa, sel: 'unsent', from: `${Y}-01-01`, to: `${Y}-12-31` });
    expect(u.headers.get('x-ef-exported')).toBe('0');
    expect(Object.keys(await unzip(u))).toEqual(['lista.csv']);
    const t = await post({ fid: fa, sel: 'ids', id: [ok2] });
    expect(Object.keys(await unzip(t)).sort()).toEqual(['eFaktura_2_2026.xml', 'lista.csv']);
    const [x] = await pg.select({ d: schema.invoices.data }).from(schema.invoices).where(eq(schema.invoices.id, ok2));
    expect(x!.d.efExport?.n).toBe(2);
    expect((await post({ fid: fa, sel: 'ids' })).status).toBe(400);
  });
});
