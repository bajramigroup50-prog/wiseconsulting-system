/**
 * „📥 Пристигнати документи“ (UX P7 / P32) workflow: uploads land in the inbox (detection queued), a client's 📷 upload
 * appears in the same inbox, a purchase is routed with one click to the scan review, and the access rules: another
 * firm, office-wide rows (owner / admins only), 🔒 book-only colleagues, 🎭 demo users.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
const jobs = vi.hoisted(() => [] as [string, object][]);
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: object) => { jobs.push([name, data]); return 'job'; }, renderPdf: async () => 'x' }));

const { addIncomingAction, routeIncomingAction, skipIncomingAction } = await import('@/app/(app)/prist/actions');
const { sendCapture } = await import('@/app/(app)/klFoto/actions');
const { default: PristPage } = await import('@/app/(app)/prist/page');
const RG = await import('@/lib/route-guard');
const { inboxScope } = await import('@/lib/incoming-scope');

const S: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); };
let A = '', B = '', D = '';
const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PristPage({ searchParams: Promise.resolve({ st: '', ...sp }) }));
const file = async (firmId: string | null, name: string, mime = 'application/pdf') =>
  (await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + randomUUID(), name, mime, size: 10, sha256: randomBytes(32).toString('hex'), status: 'ready' }).returning())[0]!.id;
const incoming = async (id: string) => (await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, id)))[0]!;

beforeAll(async () => {
  await setupDb();
  [A, B] = (await pg.insert(schema.firms).values([{ name: 'ПРИСТИГНАТО А ДООЕЛ', edb: '4030000000011' }, { name: 'ПРИСТИГНАТО Б ДОО' }]).returning()).map((f) => f.id) as [string, string];
  D = (await pg.insert(schema.firms).values({ name: 'ДЕМО ПРИСТИГНАТО', settings: { demo: true } }).returning())[0]!.id;
  const owner = await signIn('admin', { username: 'prist-owner' }); S.owner = jar.get('wc_sess')!;
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: owner } }).onConflictDoNothing();
  await signIn('acc', { firms: [A] }); S.accA = jar.get('wc_sess')!;
  await signIn('acc', { firms: [A, B] }); S.accAB = jar.get('wc_sess')!;
  await signIn('klient', { firms: [A] }); S.klient = jar.get('wc_sess')!;
  await signIn('acc', { demo: true }); S.demo = jar.get('wc_sess')!;
}, 120_000);

describe('📥 Пристигнати документи', () => {
  it('an upload into the firm is registered and its free detection queued', async () => {
    as('accA'); useFirm(A);
    const f = await file(A, 'faktura-alfa.pdf');
    const r = await addIncomingAction([f]);
    expect(r.ok, r.error).toMatch(/Примени 1/);
    expect(jobs.some(([n, d]) => n === 'incoming.detect' && (d as { id: string }).id === r.ids![0])).toBe(true);
    expect(await incoming(r.ids![0]!)).toMatchObject({ firmId: A, status: 'unread', source: 'upload' });
    expect(await page()).toContain('faktura-alfa.pdf');
  });

  it('a purchase is routed with one click to the scan review (an AI read, free first)', async () => {
    as('accA'); useFirm(A);
    const f = await file(A, 'vlezna-15.pdf');
    const [id] = (await addIncomingAction([f])).ids!;
    await pg.update(schema.incomingDocs).set({ kind: 'in', status: 'read' }).where(eq(schema.incomingDocs.id, id!));
    const r = await routeIncomingAction(id!, 'purchase');
    expect(r.error).toBeUndefined();
    expect(r.go).toBe('/skan');
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.fileId, f));
    expect(d).toMatchObject({ firmId: A, kind: 'purchase', options: { incomingId: id } });
    expect(jobs.some(([n, x]) => n === 'ai.read-document' && (x as { docId: string }).docId === d!.id)).toBe(true);
    expect(await incoming(id!)).toMatchObject({ status: 'done', route: 'purchase' });
  });

  it('the client\'s 📷 upload appears in the same inbox', async () => {
    as('klient'); useFirm(A);
    const f = await file(A, 'slika-od-klient.jpg', 'image/jpeg');
    const r = await sendCapture({ cid: randomUUID(), kind: 'in', note: 'фактура', fileIds: [f] });
    expect(r.error).toBeUndefined();
    as('accA'); useFirm(A);
    const h = await page();
    expect(h).toContain('slika-od-klient.jpg');
    expect(h).toContain('Телефон (клиент)');
  });

  it('another firm: not listed and not routable', async () => {
    as('accAB'); useFirm(B);
    const f = await file(B, 'tuga-faktura-b.pdf');
    const [id] = (await addIncomingAction([f])).ids!;
    as('accA'); useFirm(A);
    expect(await page({ firm: 'all' })).not.toContain('tuga-faktura-b.pdf');
    expect((await routeIncomingAction(id!, 'dossier')).error).toBeTruthy();
    expect((await skipIncomingAction(id!)).error).toBeTruthy();
  });

  it('office-wide uploads: the owner only', async () => {
    as('owner'); jar.delete('wc_fid');
    const f = await file(null, 'kancelarija-izvod.xml', 'text/xml');
    const r = await addIncomingAction([f]);
    expect(r.ok, r.error).toBeTruthy();
    expect(await incoming(r.ids![0]!)).toMatchObject({ firmId: null });
    expect(await page({ firm: 'all' })).toContain('kancelarija-izvod.xml');
    as('accAB'); jar.delete('wc_fid');
    expect((await addIncomingAction([await file(null, 'x.pdf')])).error).toMatch(/Изберете фирма/);
    expect(await page({ firm: 'all' })).not.toContain('kancelarija-izvod.xml');
    expect((await skipIncomingAction(r.ids![0]!)).error).toBeTruthy();
  });

  it('🔒 book-only colleagues: the inbox is bookkeeping (allowed), only their firms; /klInbox stays closed', () => {
    const V = RG.restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null })!;
    expect(RG.BOOK_ONLY_VIEWS).toContain('prist');
    expect(RG.bookVerdict('/prist', V)).toBeNull();
    expect(RG.bookVerdict('/klInbox', V)).toBe('/');
    expect(RG.bookActionAllowed('app/(app)/prist/actions.ts', V)).toBe(true);
    expect(inboxScope({ role: 'acc' }, { firmIds: [A], restricted: V, owner: false })).toEqual({ firmIds: [A], office: false, mpin: false });
    expect(inboxScope({ role: 'admin' }, { firmIds: [A], restricted: V, owner: false }).office).toBe(false);
    expect(inboxScope({ role: 'admin' }, { firmIds: [A], restricted: null, owner: false }).office).toBe(true);
  });

  it('🎭 demo: the demo firms\' files only, never office-wide', async () => {
    expect(RG.demoVerdict('/prist')).toBeNull();
    expect(inboxScope({ role: 'admin', demo: true }, { firmIds: [D], restricted: null, owner: false }).office).toBe(false);
    as('demo'); useFirm(D);
    const r = await addIncomingAction([await file(D, 'demo-izvod.xml', 'text/xml')]);
    expect(r.ok, r.error).toBeTruthy();
    const h = await page({ firm: 'all' });
    expect(h).toContain('demo-izvod.xml');
    expect(h).not.toContain('faktura-alfa.pdf');
    expect(h).not.toContain('kancelarija-izvod.xml');
  });
});
