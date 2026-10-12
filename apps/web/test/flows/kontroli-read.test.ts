/**
 * „📑 Контроли и решенија“ — the act attached in „+ Нова контрола / акт“ is read right away: saving the case queues a
 * `kontrola` read per readable file (remembered on the case, enqueued for the worker), the case page lists it until it
 * is applied; a finished read (here the free reader's result) adds the findings once, the „правна поука“ days give the
 * deadline; „↻ Прочитај го прикачениот акт“ reads an attached file again; a job queue that does not answer marks the
 * read failed with a message instead of leaving it waiting.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { kontrolaFromText } from '@wise/core/noai/kontrola';
import { UJP_ZAPISNIK } from '@wise/core/noai/kontrola.fixtures';
import { kontrolaDue, schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
const sent: { name: string; data: { docId?: string } }[] = [];
let queueDown = false;
vi.mock('@/lib/jobs', () => ({
  enqueue: async (name: string, data: { docId?: string }) => { if (queueDown) throw new Error('pg-boss down'); sent.push({ name, data }); return 'job'; },
  renderPdf: async () => 'x',
}));

const { kApplyAi, kReadFile, kSave } = await import('@/app/(app)/kontroli/actions');
const { pendingKontrolaReads } = await import('@/lib/kontrola');

let A = '';
let n = 0;
async function file(name: string, mime: string) {
  const [f] = await pg.insert(schema.files).values({ firmId: A, bucketKey: `firms/${A}/${name}-${++n}`, name, mime, size: 10, sha256: `sha-${n}-${Math.random()}`, status: 'ready' }).returning();
  return f!;
}
const kontrola = async (id: string) => (await pg.select().from(schema.kontroli).where(eq(schema.kontroli.id, id)))[0]!;
const reads = async (kid: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.kind, 'kontrola')))
  .filter((d) => (d.options as { kontrolaId?: string }).kontrolaId === kid);
const findings = (kid: string) => pg.select().from(schema.kontrolaFindings).where(eq(schema.kontrolaFindings.kontrolaId, kid));

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ТЕХНО ТРЕЈД ДООЕЛ', edb: '4030012345678', settings: {} }).returning();
  A = f!.id;
});
beforeEach(async () => { sent.length = 0; queueDown = false; useFirm(A); await signIn('admin'); });

describe('the attached act is read when the case is saved', () => {
  it('new case with a PDF (and an Excel file): one read for the PDF, remembered on the case, enqueued', async () => {
    const pdf = await file('zapisnik-ujp.pdf', 'application/pdf');
    const xls = await file('tabela.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const r = await act(kSave({}, form({ auth: 'ujp', doc: 'zapisnik', fileIds: [pdf.id, xls.id] })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/kontroli\?id=/) });
    const kid = (r as { redirect: string }).redirect.split('=')[1]!;
    const R = await reads(kid);
    expect(R).toHaveLength(1);
    expect(R[0]).toMatchObject({ fileId: pdf.id, status: 'queued', firmId: A });
    expect(sent).toEqual([{ name: 'ai.read-document', data: { docId: R[0]!.id } }]);
    expect((await kontrola(kid)).data).toMatchObject({ reads: [{ id: R[0]!.id, fileId: pdf.id }] });
    // both files are attached to the case
    const L = await pg.select().from(schema.fileLinks).where(eq(schema.fileLinks.entityId, kid));
    expect(L.map((l) => l.fileId).sort()).toEqual([pdf.id, xls.id].sort());

    // the case page shows the read while it is pending
    const k = await kontrola(kid);
    expect((await pendingKontrolaReads(k)).map((d) => [d.status, d.name])).toEqual([['queued', 'zapisnik-ujp.pdf']]);

    // the worker read it without AI (credit exhausted) → applied once, deadline from the „правна поука“
    await pg.update(schema.aiDocuments).set({ status: 'done', model: 'noai', result: kontrolaFromText(UJP_ZAPISNIK.split('\n')) }).where(eq(schema.aiDocuments.id, R[0]!.id));
    const a = await kApplyAi(kid, R[0]!.id);
    expect(a.ok).toMatch(/Прочитани 3 наоди \(прочитано без AI – проверете ги наодите\)/);
    expect((await kApplyAi(kid, R[0]!.id)).ok).toMatch(/веќе додадени/);
    const F = await findings(kid);
    expect(F.map((f) => [f.no, f.area, f.claimed, f.interest, f.fine])).toEqual([
      [1, 'vat', '90000.00', '4250.00', '0.00'], [2, 'vat', '21600.00', '0.00', '0.00'], [3, 'vat', '0.00', '0.00', '30750.00'],
    ]);
    const k2 = await kontrola(kid);
    expect(k2).toMatchObject({ docNo: '13-2451/4', docDate: '2026-03-14', periodFrom: '2025-01-01', periodTo: '2025-12-31' });
    expect(k2.data).toMatchObject({ remedy: { n: 8, unit: 'days' } });
    expect(await pendingKontrolaReads(k2)).toEqual([]);
    expect(kontrolaDue({ ...k2, delivered: '2026-03-16' })).toBe('2026-03-24');
  });

  it('saving without a readable file starts nothing', async () => {
    const r = await act(kSave({}, form({ auth: 'dit', doc: 'reshenie' })));
    const kid = (r as { redirect: string }).redirect.split('=')[1]!;
    expect(await reads(kid)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('„↻ Прочитај го прикачениот акт“ reads an attached file again; a file of the case only', async () => {
    const img = await file('akt.jpg', 'image/jpeg');
    const r = await act(kSave({}, form({ auth: 'dpi', doc: 'zapisnik', fileIds: [img.id] })));
    const kid = (r as { redirect: string }).redirect.split('=')[1]!;
    expect(await kReadFile(kid, img.id)).toMatchObject({ ok: 'Се чита…' });
    expect(await reads(kid)).toHaveLength(2);
    const other = await file('drug.pdf', 'application/pdf');
    expect((await kReadFile(kid, other.id)).error).toMatch(/не е пронајден/);
    // a failed read stays visible on the case with its message
    const [x] = await reads(kid);
    await pg.update(schema.aiDocuments).set({ status: 'error', error: 'Скенирана слика – потребно е AI или рачен внес.', options: { kontrolaId: kid, errCode: 'credit' } }).where(eq(schema.aiDocuments.id, x!.id));
    const P = await pendingKontrolaReads(await kontrola(kid));
    expect(P.find((d) => d.id === x!.id)).toMatchObject({ status: 'error', errCode: 'credit', error: expect.stringMatching(/^Скенирана слика/) });
  });

  it('job queue down: the read is marked failed with a message (not a silent „чека…“)', async () => {
    queueDown = true;
    const pdf = await file('resenie.pdf', 'application/pdf');
    const r = await act(kSave({}, form({ auth: 'ujp', doc: 'reshenie', fileIds: [pdf.id] })));
    const kid = (r as { redirect: string }).redirect.split('=')[1]!;
    const [d] = await reads(kid);
    expect(d).toMatchObject({ status: 'error', error: expect.stringMatching(/не можеше да започне.*↻ Повторно/) });
  });
});
