/**
 * Client capture + monthly client report (workflow):
 *  1. „📷 Испрати документ“: the client uploads photos (register → presigned PUT → confirm; storage mocked) and sends
 *     them with a kind; the office inbox gets one message, the responsible colleague an e-mail, the worker job to
 *     combine the photos is queued; a retry with the same `cid` does not store it twice; the client sees the status.
 *  2. Routing from the inbox with one click (bank → dossier + /banka, purchase → AI read queued, free-first).
 *  3. Report numbers per firm and month from the books; „💲 AI“ refused while the AI budget is paused, queued otherwise.
 *  4. The client sees only their own firm's published reports and cannot run the office actions.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { putAiBudget, schema, type Tx } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
const jobs = vi.hoisted(() => [] as [string, object][]);
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: object) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));
const sizes = vi.hoisted(() => new Map<string, number>());
vi.mock('@/lib/storage', () => ({
  BUCKET: 'test', objectKey: (firmId: string | null, name: string) => `firms/${firmId}/2026/${Math.random().toString(36).slice(2)}-${name}`,
  presignPut: async (key: string, _m: string, size: number) => { sizes.set(key, size); return `http://s3.test/${key}`; },
  presignGet: async (key: string) => `http://s3.test/${key}`,
  objectSize: async (key: string) => sizes.get(key) ?? null,
  getObjectBytes: async () => new Uint8Array(), putObjectBytes: async () => {}, deleteObject: async () => true,
}));

const filesApi = await import('@/app/api/files/route');
const fileApi = await import('@/app/api/files/[id]/route');
const { sendCapture } = await import('@/app/(app)/klFoto/actions');
const { default: KlFotoPage } = await import('@/app/(app)/klFoto/page');
const { routeInbox } = await import('@/app/(app)/klInbox/actions');
const { prepareReport, reportAi, publishReport } = await import('@/app/(app)/mesIzv/actions');
const { default: KlIzvPage } = await import('@/app/(app)/klIzv/page');

const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let A = '', B = '', officeId = '', klientId = '';

/** The browser upload of `lib/upload.ts`: register (dedupe) → PUT (mocked storage) → confirm. */
async function upload(firmId: string, name: string, mime = 'image/jpeg'): Promise<string> {
  const size = 1000 + Math.floor(Math.random() * 1000);
  const reg = await filesApi.POST(new Request('http://localhost/api/files', { method: 'POST', body: JSON.stringify({ firmId, name, mime, size, sha256: randomBytes(32).toString('hex') }) }));
  const r = await reg.json() as { id: string; uploadUrl: string };
  expect(reg.status).toBe(200);
  expect(r.uploadUrl).toContain('s3.test');
  const done = await fileApi.POST(new Request(`http://localhost/api/files/${r.id}`, { method: 'POST' }), { params: Promise.resolve({ id: r.id }) });
  expect(done.status).toBe(200);
  return r.id;
}

async function journal(firmId: string, date: string, lines: [string, number, number][]) {
  const [j] = await pg.insert(schema.journals).values({ firmId, date, kind: 'manual', number: String(Math.random()).slice(2, 8) }).returning();
  await pg.insert(schema.journalLines).values(lines.map(([account, debit, credit], i) => ({ journalId: j!.id, firmId, lineNo: i + 1, account, debit: String(debit), credit: String(credit) })));
}

beforeAll(async () => {
  await setupDb();
  const [a, b] = await pg.insert(schema.firms).values([
    { name: 'КАМЕРА ДООЕЛ', email: 'klient@kamera.mk', vatRegistered: false, settings: { kl: { lang: 'sq' } } },
    { name: 'ДРУГА ФИРМА ДОО', vatRegistered: true, vatPeriod: 'month' },
  ]).returning();
  A = a!.id; B = b!.id;
  officeId = await signIn('acc', { firms: [A, B] }); S.office = jar.get('wc_sess')!;
  await pg.update(schema.users).set({ email: 'kolega@wise.mk' }).where(eq(schema.users.id, officeId));
  klientId = await signIn('klient', { firms: [A] }); S.klient = jar.get('wc_sess')!;
  useFirm(A);

  // books of A: Aug revenue 100 000; Sep revenue 120 000, expenses 50 000, 70 000 to the bank; Oct (outside) expense
  await journal(A, '2026-08-15', [['1200', 100000, 0], ['7400', 0, 100000]]);
  await journal(A, '2026-09-10', [['1200', 120000, 0], ['7400', 0, 120000]]);
  await journal(A, '2026-09-12', [['4100', 50000, 0], ['2200', 0, 50000]]);
  await journal(A, '2026-09-20', [['1000', 70000, 0], ['1200', 0, 70000]]);
  await journal(A, '2026-10-02', [['4100', 9999, 0], ['2200', 0, 9999]]);
  await journal(B, '2026-09-05', [['1200', 5000, 0], ['7400', 0, 5000]]);
  await pg.insert(schema.invoices).values([
    { firmId: A, kind: 'invoice', number: '1/26', date: '2026-06-01', due: '2026-06-15', total: '30000' },
    { firmId: A, kind: 'invoice', number: '2/26', date: '2026-09-10', due: '2026-09-25', total: '120000' },
    { firmId: A, kind: 'invoice', number: '3/26', date: '2026-10-05', due: '2026-10-20', total: '7777' }, // after the month
  ]);
  await pg.insert(schema.purchases).values({ firmId: A, number: 'Д-9', date: '2026-09-12', due: '2026-09-20', total: '50000' });
}, 120_000);
beforeEach(() => { jobs.length = 0; });

describe('📷 capture upload flow', () => {
  let itemId = '';
  const cid = randomUUID();

  it('the client uploads 3 photos and sends them as an incoming invoice', async () => {
    as('klient'); useFirm(A);
    const ids = [await upload(A, 'p1.jpg'), await upload(A, 'p2.jpg'), await upload(A, 'p3.jpg')];
    const r = await sendCapture({ cid, kind: 'in', note: 'гориво за септември', fileIds: ids, combine: true });
    expect(r.error).toBeUndefined();
    itemId = r.id!;
    const [i] = await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, itemId));
    expect(i).toMatchObject({ firmId: A, docKind: 'in', subject: '📷 Влезна фактура (3 стр.)', note: 'гориво за септември', fromOffice: false, done: false, fromUserId: klientId });
    expect(await pg.select().from(schema.fileLinks).where(and(eq(schema.fileLinks.entityType, 'inbox_item'), eq(schema.fileLinks.entityId, itemId)))).toHaveLength(3);
    // the responsible colleague is told by e-mail, the photos go to the worker to become one PDF
    const M = await pg.select().from(schema.mailLog).where(eq(schema.mailLog.entityId, itemId));
    expect(M).toHaveLength(1);
    expect(JSON.stringify(M[0]!.to)).toContain('kolega@wise.mk');
    expect(jobs.filter(([n]) => n !== 'mail.send')).toEqual([['inbox.combine', { itemId }]]);
    const [au] = await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'klFoto'), eq(schema.auditLog.entityId, itemId)));
    expect(au!.userId).toBe(klientId);
  });

  it('a retry with the same cid (answer lost offline) does not store it twice', async () => {
    as('klient');
    const again = await sendCapture({ cid, kind: 'in', fileIds: [randomUUID()], combine: true });
    expect(again.id).toBe(itemId);
    expect(await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.firmId, A))).toHaveLength(1);
  });

  it('refuses no kind, no files and files of another firm', async () => {
    as('klient');
    expect((await sendCapture({ cid: randomUUID(), kind: 'xx', fileIds: [randomUUID()] })).error).toMatch(/вид/);
    expect((await sendCapture({ cid: randomUUID(), kind: 'bank', fileIds: [] })).error).toMatch(/Фотографирајте/);
    as('office');
    const foreign = await upload(B, 'tuga.pdf', 'application/pdf');
    as('klient');
    expect((await sendCapture({ cid: randomUUID(), kind: 'bank', fileIds: [foreign] })).error).toMatch(/не се пронајдени/);
    expect(await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.firmId, A))).toHaveLength(1);
  });

  it('the client sees what they sent as „примено“', async () => {
    as('klient');
    const h = await html(KlFotoPage());
    expect(h).toContain('Влезна фактура');
    expect(h).toContain('примено');
  });

  it('one click in the office inbox: bank statement → dossier + /banka; the client then sees „обработено“', async () => {
    as('klient');
    const s = await sendCapture({ cid: randomUUID(), kind: 'bank', fileIds: [await upload(A, 'izvod.pdf', 'application/pdf')] });
    as('klient');
    expect((await routeInbox({}, form({ id: s.id!, route: 'bank' }))).error).toBeTruthy(); // the client cannot route
    as('office'); useFirm(A);
    const r = await act(routeInbox({}, form({ id: s.id!, route: 'bank' })));
    expect(r).toEqual({ redirect: '/banka' });
    const [i] = await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, s.id!));
    expect(i).toMatchObject({ done: true, route: 'bank', doneBy: officeId });
    const [d] = await pg.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.fromInboxId, s.id!));
    expect(d!.category).toBe('Банкарски документи');
    expect(jobs.filter(([n]) => n !== 'mail.send')).toHaveLength(0); // archiving never reads anything
    as('klient'); useFirm(A);
    expect(await html(KlFotoPage())).toContain('обработено');
  });

  it('one click: the photographed invoice → purchases scan (the AI read is queued only now, on the office click)', async () => {
    as('office'); useFirm(A);
    expect(await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.firmId, A))).toHaveLength(0);
    const r = await act(routeInbox({}, form({ id: itemId, route: 'purchase' })));
    expect(r).toEqual({ redirect: '/skan' });
    const D = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.firmId, A));
    expect(D).toHaveLength(3);
    expect(D.every((d) => d.kind === 'purchase')).toBe(true);
    expect(jobs.filter(([n]) => n === 'ai.read-document')).toHaveLength(3);
  });
});

describe('📊 monthly client report', () => {
  let repA = '', repB = '';

  it('numbers per firm and month come from the books', async () => {
    as('office'); useFirm(A);
    expect((await prepareReport({}, form({ period: '2026-09' }))).error).toBeUndefined();
    const [r] = await pg.select().from(schema.clientReports).where(and(eq(schema.clientReports.firmId, A), eq(schema.clientReports.period, '2026-09')));
    repA = r!.id;
    expect(r!.lang).toBe('sq'); // the client's language from the portal setting
    expect(r!.data).toMatchObject({
      period: '2026-09', rev: 120000, exp: 50000, res: 70000, cash: 70000,
      prev: { period: '2026-08', rev: 100000, exp: 0, res: 100000, cash: 0 },
      recv: { total: 150000, over60: 30000, n60: 1 }, pay: { total: 50000, overdue: 50000 }, vat: null,
    });
    const ch = (r!.data as { changes: { key: string; pct: number | null }[] }).changes;
    expect(ch.find((c) => c.key === 'rev')!.pct).toBe(20);
    expect(ch.find((c) => c.key === 'res')!.pct).toBe(-30);

    useFirm(B);
    expect((await prepareReport({}, form({ period: '2026-09' }))).error).toBeUndefined();
    const [rb] = await pg.select().from(schema.clientReports).where(and(eq(schema.clientReports.firmId, B), eq(schema.clientReports.period, '2026-09')));
    repB = rb!.id;
    expect(rb!.data).toMatchObject({ rev: 5000, exp: 0, recv: { total: 0 }, vat: { period: '2026-09', due: '2026-10-25', partial: false, closed: false } });
    expect((await prepareReport({}, form({ period: '2099-01' }))).error).toMatch(/иднина/);
    const [au] = await pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'crPrep'), eq(schema.auditLog.entityId, repA)));
    expect(au!.userId).toBe(officeId);
  });

  it('„💲 AI“: refused while the AI budget is paused, queued for the worker otherwise', async () => {
    as('office'); useFirm(A);
    await pg.insert(schema.aiUsage).values({ firmId: A, purpose: 'test', tier: 'quick', model: 'x', costUsd: '5' });
    await putAiBudget(pg as unknown as Tx, { firms: { [A]: 1 } });
    const p = await reportAi(repA);
    expect(p.error).toMatch(/паузиран/);
    expect(jobs).toHaveLength(0);
    await putAiBudget(pg as unknown as Tx, { firms: {} });
    expect((await reportAi(repA)).error).toBeUndefined();
    expect(jobs).toEqual([['client-report.summary', { id: repA }]]);
    const [r] = await pg.select().from(schema.clientReports).where(eq(schema.clientReports.id, repA));
    expect(r!.aiStatus).toBe('queued');
  });

  it('the client sees only their firm\'s published reports and cannot run office actions', async () => {
    as('office');
    await publishReport(repA, true);
    await publishReport(repB, true);
    as('klient'); useFirm(A);
    expect((await publishReport(repB, false)).error).toBeTruthy();
    expect((await reportAi(repA)).error).toBeTruthy();
    expect((await prepareReport({}, form({ period: '2026-09' }))).error).toBeTruthy();
    const own = await html(KlIzvPage({ searchParams: Promise.resolve({}) }));
    expect(own).toContain('Raport mujor'); // Albanian, as set for the client
    expect(own).toContain('120.000');
    // another firm's report id is never shown: the page falls back to the client's own report
    const other = await html(KlIzvPage({ searchParams: Promise.resolve({ id: repB }) }));
    expect(other).not.toContain('5.000 den');
    expect(other).not.toContain('ДРУГА ФИРМА');
    // even with the firm cookie of the other firm, the client stays in their own firm
    useFirm(B);
    const forced = await html(KlIzvPage({ searchParams: Promise.resolve({ id: repB }) }));
    expect(forced).not.toContain('ДРУГА ФИРМА');
    useFirm(A);
  });
});
