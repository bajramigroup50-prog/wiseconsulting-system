/**
 * 📊 Продуктивност на вработените: the aggregation of seeded audit rows (PGlite), the screen / print view / Excel for the
 * office owner, and the refusal for every other administrator; ownership transfer (audited); the activity log's
 * filters and paging.
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn, form } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const ProdPage = (await import('@/app/(app)/produktivnost/page')).default;
const PrintPage = (await import('@/app/print/produktivnost/page')).default;
const xlsx = await import('@/app/(app)/produktivnost/xlsx/route');
const { transferOwner } = await import('@/app/(app)/produktivnost/actions');
const { loadProductivity, prodFilter } = await import('@/app/(app)/produktivnost/data');
const AktivnostPage = (await import('@/app/(app)/aktivnost/page')).default;
const { officeOwner } = await import('@/lib/office-owner');

const MSG = 'Само за сопственикот на канцеларијата.';
const S: Record<string, string> = {};
const U: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let f1 = '', f2 = '';
const OD = '2026-09-01', DO = '2026-09-30';
const q = { od: OD, do: DO };
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+02:00`); // Skopje summer time

async function seed(user: string | null, firmId: string | null, d: string, hm: string, action: string, entityType: string | null = null, data: Record<string, unknown> | null = null, entityId: string | null = null) {
  await pg.insert(schema.auditLog).values({ at: at(d, hm), userId: user, firmId, action, entityType, entityId, data });
}

const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

beforeAll(async () => {
  await setupDb();
  const [a, b] = await pg.insert(schema.firms).values([{ name: 'АЛФА ДООЕЛ' }, { name: 'БЕТА ДОО' }]).returning();
  f1 = a!.id; f2 = b!.id;
  for (const [k, role] of [['owner', 'admin'], ['admin2', 'admin'], ['acc', 'acc'], ['kl', 'klient']] as const) {
    U[k] = await signIn(role, { username: k, ...(role === 'klient' ? { firms: [f1] } : {}) });
    S[k] = jar.get('wc_sess')!;
  }
  // the owner is the earliest-created active admin (no setting yet)
  await pg.update(schema.users).set({ createdAt: new Date('2020-01-01T00:00:00Z') }).where(eq(schema.users.id, U.owner!));
  await pg.update(schema.users).set({ createdAt: new Date('2021-01-01T00:00:00Z') }).where(eq(schema.users.id, U.admin2!));

  // acc: a morning burst on f1 and an afternoon one on f2, another day on f1
  await seed(U.acc!, null, '2026-09-07', '08:55', 'login');
  await seed(U.acc!, f1, '2026-09-07', '09:00', 'saveInv', 'invoice', { kind: 'invoice', total: 1180, currency: 'MKD', number: '1' }, 'i1');
  await seed(U.acc!, f1, '2026-09-07', '09:00', 'postInvoice', 'journal', { lines: 3, sourceType: 'invoice' });
  await seed(U.acc!, f1, '2026-09-07', '09:05', 'editInv', 'invoice', { kind: 'invoice', total: 1200.5, currency: 'MKD' }, 'i1');
  await seed(U.acc!, f1, '2026-09-07', '09:10', 'saveJ', 'journal', { lines: 4, sourceType: null });
  await seed(U.acc!, f2, '2026-09-07', '14:00', 'importBank', 'bank_import', { lines: 20 });
  await seed(U.acc!, f2, '2026-09-07', '14:02', 'bankKonto', 'bank_line');
  await seed(U.acc!, f2, '2026-09-07', '14:04', 'bankKonto', 'bank_line');
  await seed(U.acc!, f2, '2026-09-07', '14:10', 'invStyle', 'firm');
  await seed(U.acc!, f1, '2026-09-08', '10:00', 'savePur', 'purchase', { total: '590.10' }, 'p1');
  await seed(U.acc!, f1, '2026-09-08', '10:01', 'delPur', 'purchase', null, 'p1');
  // owner: two movements; a client's own entries are not office work; one row outside the period
  await seed(U.owner!, f2, '2026-09-10', '11:00', 'newFirm', 'firm');
  await seed(U.owner!, f2, '2026-09-10', '11:20', 'saveFirm', 'firm');
  await seed(U.kl!, f1, '2026-09-10', '12:00', 'klSend', 'inbox_item');
  await seed(U.acc!, f1, '2026-10-02', '09:00', 'saveInv', 'invoice', { kind: 'invoice', total: 5 }, 'i9');
  await seed(null, f1, '2026-09-11', '03:00', 'recRun', 'recurring_invoice');
}, 120_000);

describe('productivity — aggregation from the audit log', () => {
  it('counts movements per user by kind of work, without sign-ins, settings, by-products and clients', async () => {
    const D = await loadProductivity(prodFilter(q));
    const acc = D.report.users.find((w) => w.userId === U.acc)!;
    expect(acc.total).toBe(8);
    expect(acc.noise).toBe(2); // login + invStyle
    expect(acc.verbs).toEqual({ c: 4, u: 3, d: 1 });
    expect(acc.byCat.izlez).toEqual({ c: 1, u: 1, d: 0 });
    expect(acc.byCat.izvodi).toEqual({ c: 1, u: 2, d: 0 });
    expect(acc.byCat.vlez).toEqual({ c: 1, u: 0, d: 1 });
    expect(acc.firms.map((x) => [x.firmId, x.total])).toEqual([[f1, 5], [f2, 3]]);
    expect(acc.days).toEqual({ '2026-09-07': 6, '2026-09-08': 2 });
    expect(acc.activeDays).toBe(2);
    expect(acc.activeMin).toBe(11 + 5 + 2); // 09:00–09:10 (+1), 14:00–14:04 (+1), 10:00–10:01 (+1)
    expect(acc.vol).toMatchObject({ jLines: 7, journals: 1, bankImported: 20, bankBooked: 2, inv: 1, invCents: 120050, pur: 1, purCents: 59010 });
    expect(D.report.users.some((w) => w.userId === U.kl)).toBe(false);
    expect(D.report.users.find((w) => w.userId === U.owner)!.total).toBe(2);
    expect(D.report.users.find((w) => w.userId === null)!.total).toBe(1);
  });
  it('filters by user and firm', async () => {
    const D = await loadProductivity(prodFilter({ ...q, u: U.acc!, f: f2 }));
    expect(D.report.users.map((w) => [w.userId, w.total])).toEqual([[U.acc, 3]]);
  });
});

describe('productivity — only the office owner', () => {
  it('the owner sees the report; another admin and an accountant are refused', async () => {
    expect((await officeOwner())?.id).toBe(U.owner);
    as('owner');
    const h = await html(ProdPage({ searchParams: Promise.resolve(q) }));
    expect(h).toContain('Преглед по корисник');
    expect(h).toContain('acc');
    expect(h).toContain('Излезни фактури');
    expect(h).not.toContain(MSG);
    for (const who of ['admin2', 'acc']) {
      as(who);
      const r = await html(ProdPage({ searchParams: Promise.resolve(q) }));
      expect(r, who).toContain(MSG);
      expect(r, who).not.toContain('Преглед по корисник');
    }
  });
  it('the print view (PDF) and the Excel export refuse anybody but the owner', async () => {
    as('admin2');
    expect(await html(PrintPage({ searchParams: Promise.resolve(q) }))).toContain(MSG);
    expect((await xlsx.GET(new Request(`http://localhost/produktivnost/xlsx?od=${OD}&do=${DO}`))).status).toBe(403);
    as('owner');
    expect(await html(PrintPage({ searchParams: Promise.resolve(q) }))).toContain('ПРОДУКТИВНОСТ НА ВРАБОТЕНИТЕ');
    const res = await xlsx.GET(new Request(`http://localhost/produktivnost/xlsx?od=${OD}&do=${DO}`));
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Преглед', 'По вид на работа', 'По фирми', 'По денови', 'Непознати акции']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Преглед']!, { header: 1 });
    const acc = rows.find((r) => r[0] === 'acc')!;
    expect(acc[2]).toBe(8);
  });
  it('the activity log: per-user filter only for the owner, firm / date filters and paging', async () => {
    as('owner');
    const h = await html(AktivnostPage({ searchParams: Promise.resolve({ ...q, u: U.acc!, f: f2 }) }));
    expect(h).toContain('importBank');
    expect(h).not.toContain('Нова фирма');
    expect(h).toContain('Вкупно 4 записи');
    as('admin2');
    // the user filter is ignored for a non-owner admin; the firm / date filters work
    const h2 = await html(AktivnostPage({ searchParams: Promise.resolve({ ...q, u: U.acc!, f: f2 }) }));
    expect(h2).toContain('Нова фирма');
    expect(h2).not.toContain('name="u"');
    // paging: 100 per page
    await pg.insert(schema.auditLog).values(Array.from({ length: 105 }, (_, i) => ({ at: at('2026-08-03', `10:${String(i % 60).padStart(2, '0')}`), userId: U.acc!, firmId: f1, action: 'tSave', entityType: 'office_task' })));
    const p1 = await html(AktivnostPage({ searchParams: Promise.resolve({ od: '2026-08-03', do: '2026-08-03' }) }));
    expect(p1).toContain('страница 1 од 2');
    expect(p1.match(/<tr><td class="num">/g)).toHaveLength(100);
    const p2 = await html(AktivnostPage({ searchParams: Promise.resolve({ od: '2026-08-03', do: '2026-08-03', pg: '2' }) }));
    expect(p2.match(/<tr><td class="num">/g)).toHaveLength(5);
  });
  it('only the owner transfers ownership, to an active admin; audited', async () => {
    as('admin2');
    expect(await transferOwner({}, form({ to: U.admin2!, ok: true }))).toEqual({ error: MSG });
    as('owner');
    expect(await transferOwner({}, form({ to: U.acc!, ok: true }))).toMatchObject({ error: expect.stringContaining('администратор') });
    expect(await transferOwner({}, form({ to: U.admin2! }))).toMatchObject({ error: expect.any(String) });
    expect(await transferOwner({}, form({ to: U.admin2!, ok: true }))).toMatchObject({ ok: expect.any(String) });
    expect((await officeOwner())?.id).toBe(U.admin2);
    const [a] = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'ownerSet'));
    expect(a).toMatchObject({ userId: U.owner, entityId: 'officeOwner' });
    expect(await html(ProdPage({ searchParams: Promise.resolve(q) }))).toContain(MSG);
    expect((await xlsx.GET(new Request('http://localhost/produktivnost/xlsx'))).status).toBe(403);
    as('admin2');
    expect(await html(ProdPage({ searchParams: Promise.resolve(q) }))).toContain('Преглед по корисник');
  });
});
