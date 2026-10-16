/**
 * „📑 Контроли и решенија“ — the objection built from the decision: the numbered attachments of a disputed VAT finding
 * (VAT books, the period's incoming invoices with their scans and outgoing invoices), the „📦 Пакет за приговор“ ZIP
 * (Word + PDF + „Прилог NN – …“), „🤖 Подготви приговор со AI“ (owner only, refused while the AI budget is paused) and
 * a client getting neither.
 */
import { eq } from 'drizzle-orm';
import PizZip from 'pizzip';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { versionsOf } from '@wise/core/compliance';
import { kontrolaPkgState, kontrolaPrepState, kontrolaSubmissionHtml, loadKontrolaCase, putAiBudget, schema } from '@wise/db';
import { createHash, randomBytes } from 'node:crypto';
import { act, form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
const sent: { name: string; data: Record<string, unknown> }[] = [];
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: Record<string, unknown>) => { sent.push({ name, data }); return 'job'; }, renderPdf: async () => 'x' }));
const objects = new Map<string, Uint8Array>();
vi.mock('@/lib/storage', async (orig) => ({ ...(await orig<object>()), getObjectBytes: async (key: string) => objects.get(key) ?? new Uint8Array([0]) }));

const A = await import('@/app/(app)/kontroli/actions');
const paket = await import('@/app/(app)/kontroli/paket/route');

let firmId = '', kid = '', ownerId = '', scanId = '';
const kontrola = async () => (await pg.select().from(schema.kontroli).where(eq(schema.kontroli.id, kid)))[0]!;
const getPaket = () => paket.GET(new Request(`http://localhost/kontroli/paket?id=${kid}`));
const file = async (name: string, body: string) => {
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: `t/${name}-${Math.random()}`, name, mime: 'application/pdf', size: body.length, sha256: name, status: 'ready' }).returning();
  objects.set(f!.bucketKey, new TextEncoder().encode(body));
  return f!;
};

beforeAll(async () => {
  await setupDb();
  ownerId = await signIn('admin'); // the first active admin = the office owner
  const [f] = await pg.insert(schema.firms).values({ name: 'ПРИЛОЗИ ТЕСТ ДООЕЛ', edb: '4030011111111', city: 'Скопје' }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Добавувач ДОО' }).returning();
  // the period's documents: an incoming invoice with its scan in the archive, an outgoing invoice, one outside the period
  const [pu] = await pg.insert(schema.purchases).values({ firmId, number: 'В-15', date: '2026-02-15', partnerId: p!.id, status: 'posted', base: '10000', vat: '1800', total: '11800' }).returning();
  scanId = (await file('vlezna-v15.pdf', 'SCAN-V15')).id;
  await pg.insert(schema.fileLinks).values({ fileId: scanId, entityType: 'purchase', entityId: pu!.id, role: 'source' });
  await pg.insert(schema.invoices).values({ firmId, kind: 'invoice', number: '7/2026', date: '2026-02-10', status: 'posted', partnerId: p!.id, base: '1000', vat: '180', total: '1180' });
  await pg.insert(schema.invoices).values({ firmId, kind: 'invoice', number: '99/2026', date: '2026-08-10', status: 'posted', base: '1000', vat: '180', total: '1180' });
});
beforeEach(async () => { sent.length = 0; useFirm(firmId); });

describe('the objection built from the decision', () => {
  it('a disputed VAT finding lists the VAT books and the invoices of the period as numbered attachments', async () => {
    await signIn('acc', { allFirms: true });
    const r = await act(A.kSave({}, form({ auth: 'ujp', doc: 'reshenie', docNo: '13-9', docDate: '2026-10-01', delivered: '2026-10-08', periodFrom: '2026-01-01', periodTo: '2026-03-31' })));
    kid = (r as { redirect: string }).redirect.split('=')[1]!;
    const act0 = await file('reshenie.pdf', 'ACT');
    await pg.insert(schema.fileLinks).values({ fileId: act0.id, entityType: schema.KONTROLA_FILE_ENTITY, entityId: kid });
    expect((await A.kFinding(kid, {}, form({ area: 'vat', text: 'Одбиен претходен ДДВ', article: 'чл. 34 ЗДДВ', claimed: '50000', ours: '8000' }))).ok).toBeTruthy();
    const c = (await loadKontrolaCase(pg as never, firmId, kid))!;
    const L = c.att.map((a) => a.label);
    expect(L[0]).toBe('Копија од актот што се оспорува');
    expect(c.att[0]!.fileIds).toEqual([act0.id]);
    expect(L).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Книга на излезни фактури \(ДДВ\) за 01\.01\.2026–31\.03\.2026/),
      expect.stringMatching(/^Книга на влезни фактури \(ДДВ\) за 01\.01\.2026–31\.03\.2026/),
      'Влезна фактура бр. В-15 од 15.02.2026 – Добавувач ДОО',
      'Излезна фактура бр. 7/2026 од 10.02.2026 – Добавувач ДОО',
    ]));
    expect(L.join('|')).not.toContain('99/2026'); // outside the audited period
    expect(c.att.find((a) => a.kind === 'purchase')!.fileIds).toEqual([scanId]);
    expect(c.att.every((a, i) => a.no === i + 1)).toBe(true);
    // the document lists them and cites them in the reasoning
    const ext = versionsOf((await kontrola()).data).at(-1)!.external;
    expect(ext).toMatch(/ПРИЛОЗИ\nПрилог 1: Копија од актот што се оспорува\nПрилог 2: /);
    expect(ext).toMatch(/Докази: Прилог 2 \(/);
    // the AI never sees the partner names (short labels)
    expect(c.input.attachments!.map((a) => a.short).join('|')).not.toContain('Добавувач');
  });

  it('„📦 Пакет за приговор“: queued for the worker; the ZIP has the document (Word + PDF) and every attachment by number', async () => {
    await signIn('acc', { allFirms: true });
    expect((await getPaket()).status).toBe(404); // not built yet
    expect((await A.kPkgStart(kid)).ok).toMatch(/пакетот/);
    expect(sent).toEqual([{ name: 'kontrola.pkg', data: expect.objectContaining({ kid, firmId, reqId: expect.any(String) }) }]);
    // the worker's result (kontrola.pkg): the submission PDF + the prints
    const c = (await loadKontrolaCase(pg as never, firmId, kid))!;
    const doc = await file('zhalba.pdf', 'PDF-DOC');
    const rendered: Record<string, string[]> = {};
    for (const a of c.att.filter((x) => x.render)) rendered[a.key] = [(await file(`print-${a.no}.pdf`, `PRINT-${a.no}`)).id];
    const p = kontrolaPkgState(await kontrola())!;
    await pg.update(schema.kontroli).set({ data: { ...(await kontrola()).data, pkg: { ...p, status: 'done', doc: doc.id, hash: kontrolaSubmissionHtml(c).hash, type: 'zhalba', rendered } } }).where(eq(schema.kontroli.id, kid));
    const res = await getPaket();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const z = new PizZip(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(z.files);
    expect(names).toEqual(expect.arrayContaining(['00 Zhalba.docx', '00 Zhalba.pdf', 'Прилог 01 – Копија од актот што се оспорува.pdf', '00 Список на прилози.txt']));
    expect(z.file('00 Zhalba.pdf')!.asText()).toBe('PDF-DOC');
    const vb = c.att.find((a) => a.key.startsWith('vatBook:in'))!;
    const vbName = names.find((n) => n.startsWith(`Прилог ${String(vb.no).padStart(2, '0')} – Книга на влезни фактури`))!;
    expect(z.file(vbName)!.asText()).toBe(`PRINT-${vb.no}`);
    const pu = c.att.find((a) => a.kind === 'purchase')!;
    expect(z.file(names.find((n) => n.startsWith(`Прилог ${String(pu.no).padStart(2, '0')} – Влезна фактура бр. В-15`))!)!.asText()).toBe('SCAN-V15');
    expect(names.filter((n) => n.startsWith('Прилог ')).length).toBeGreaterThanOrEqual(c.att.filter((a) => a.fileIds.length || a.render).length);
    const A0 = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, kid));
    expect(A0.map((a) => a.action)).toEqual(expect.arrayContaining(['kontrolaPkgStart', 'kontrolaPkgZip']));
  });

  it('„🤖 Подготви приговор со AI“: office owner only; queued for the worker; refused while the AI budget is paused', async () => {
    await signIn('acc', { allFirms: true });
    expect((await A.kPrepAi(kid, false)).error).toMatch(/сопственикот/);
    expect(sent).toEqual([]);
    await signInAs(ownerId);
    expect((await A.kPrepAi(kid, false)).ok).toMatch(/Се подготвува/);
    expect(sent).toEqual([{ name: 'kontrola.prepare', data: expect.objectContaining({ kid, firmId, deep: false, reqId: expect.any(String) }) }]);
    expect(kontrolaPrepState(await kontrola())).toMatchObject({ status: 'queued' });
    await pg.update(schema.kontroli).set({ data: { ...(await kontrola()).data, ai: undefined, prep: undefined } }).where(eq(schema.kontroli.id, kid));
    await putAiBudget(pg as never, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: 'claude-sonnet-5-5', costUsd: '2.000000' });
    sent.length = 0;
    expect((await A.kPrepAi(kid, false)).error).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('a client (portal) gets 403 for the package and cannot start either step', async () => {
    await pg.update(schema.kontroli).set({ clientVisible: true }).where(eq(schema.kontroli.id, kid));
    await signIn('klient', { firms: [firmId] });
    expect((await getPaket()).status).toBe(403);
    expect((await A.kPkgStart(kid)).error).toBeTruthy();
    expect((await A.kPrepAi(kid, false)).error).toBeTruthy();
  });
});

/** A new session for an existing user (the owner, signed in first in `beforeAll`). */
async function signInAs(userId: string) {
  const token = randomBytes(24).toString('base64url');
  await pg.insert(schema.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId, expiresAt: new Date(Date.now() + 864e5) });
  jar.set('wc_sess', token);
}
