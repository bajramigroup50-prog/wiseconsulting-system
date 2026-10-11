/**
 * Workflow — reading without AI: Систем › „AI читање“ switch (administrator), failed reads shown with a clear message
 * (never the provider's raw JSON) and „↻ Повторно“, and the „🔄 Конвертор на датотеки“: presets saved office-wide and
 * converted files imported through the real import actions (firms, partners) after an .xlsx round trip.
 */
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AI_ERR_MSG } from '@wise/core/ai/errors';
import { convApply, convAuto, convCheck, convSig, convTarget, type ConvCell } from '@wise/core/convert/index';
import { IMP_T, impAuto, impHeaderRow } from '@wise/core/retail/import';
import { getAiSettings, schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
const sent: { name: string; data: unknown }[] = [];
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: unknown) => { sent.push({ name, data }); return 'job'; } }));

const { setAiEnabledAction } = await import('@/app/(app)/sistem/actions');
const { aiReadStatus, retryAiRead } = await import('@/app/(app)/_ai/actions');
const { saveConvPreset, listConvPresets, deleteConvPreset, readPdfGrid } = await import('@/app/(app)/konvertor/actions');
const { readFirmsFile, importFirms } = await import('@/app/(app)/firmiImp/actions');
const { importAction } = await import('@/app/(app)/_retail/actions');

let firmId = '';
/** The converter's download: grid → .xlsx file (as `xlsxDownload` writes it). */
const xlsxFile = (grid: ConvCell[][], name: string) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Лист');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], name);
};

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'КОНВЕРТОР ДООЕЛ' }).returning();
  firmId = f!.id;
  await signIn('admin');
  useFirm(firmId);
  useYear(2026);
}, 120_000);

describe('AI on / off and failed reads', () => {
  it('only the administrator switches AI reading; off is stored office-wide', async () => {
    expect((await setAiEnabledAction(false)).ok).toMatch(/исклучено/);
    expect((await getAiSettings(pg as never)).enabled).toBe(false);
    expect((await setAiEnabledAction(true)).ok).toMatch(/вклучено/);
    await signIn('knigovoditel', { firms: [firmId] });
    expect((await setAiEnabledAction(false)).error).toBeTruthy();
    await signIn('admin');
    expect((await getAiSettings(pg as never)).enabled).toBe(true);
  });

  it('a raw provider error is shown as the clear message; ↻ Повторно queues the read again with AI', async () => {
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
    const [d] = await pg.insert(schema.aiDocuments).values({ firmId, kind: 'bank', status: 'error', error: raw }).returning();
    const [s] = await aiReadStatus([d!.id]);
    expect(s).toMatchObject({ status: 'error', error: AI_ERR_MSG.credit, errCode: 'credit' });
    expect(await retryAiRead(d!.id)).toEqual({});
    const [x] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, d!.id));
    expect(x).toMatchObject({ status: 'queued', error: null });
    expect(x!.options).toMatchObject({ retry: true });
    expect(sent.at(-1)).toEqual({ name: 'ai.read-document', data: { docId: d!.id } });
  });
});

describe('converter', () => {
  it('presets are saved, replaced by name and deleted', async () => {
    const hdr = ['Datum', 'Iznos', 'Opis'];
    const a = await saveConvPreset({ name: 'Банка X', target: 'bank', sig: convSig(hdr), hi: 0, map: { date: 0, amount: 1, purpose: 2 } });
    expect(a.presets).toHaveLength(1);
    const b = await saveConvPreset({ name: 'банка x', target: 'bank', sig: convSig(hdr), hi: 1, map: { date: 0, amount: 1 } });
    expect(b.presets).toHaveLength(1);
    expect((await listConvPresets())[0]).toMatchObject({ hi: 1, map: { date: 0, amount: 1 } });
    expect((await saveConvPreset({ name: '', target: 'bank' })).error).toBeTruthy();
    expect((await deleteConvPreset(a.id!)).presets).toEqual([]);
  });

  it('a bank statement PDF with text → table → bank import format', async () => {
    const txt = (x: number, y: number, s: string) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${s}) Tj ET`;
    const body = [txt(40, 800, 'Statement 12'), txt(40, 780, 'Date'), txt(120, 780, 'Partner'), txt(300, 780, 'Purpose'), txt(430, 780, 'Debit'), txt(500, 780, 'Credit'),
      txt(40, 766, '02.03.2026'), txt(120, 766, 'ALFA DOOEL'), txt(300, 766, 'Invoice 12'), txt(500, 766, '12.500,00'),
      txt(40, 752, '03.03.2026'), txt(120, 752, 'T-Mobile'), txt(300, 752, 'Phone'), txt(430, 752, '1.234,56')].join('\n');
    const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
    const r = await readPdfGrid(form({ file: new File([pdf], 'izvod.pdf', { type: 'application/pdf' }) }));
    expect(r.error).toBeUndefined();
    const g = r.grid!;
    const hi = g.findIndex((x) => x[0] === 'Date');
    expect(g[hi]).toEqual(['Date', 'Partner', 'Purpose', 'Debit', 'Credit']);
    const t = convTarget('bank')!;
    const res = convApply(t, g.slice(hi + 1), convAuto(t, g[hi]!));
    const c = convCheck(t, res);
    expect(c.diff).toEqual([]);
    expect(c.rows.map((x) => [x.date, x.name, x.amount])).toEqual([['2026-03-02', 'ALFA DOOEL', 12500], ['2026-03-03', 'T-Mobile', -1234.56]]);
  });

  it('firms from another program → converted .xlsx → Фирми › Увоз од Excel', async () => {
    const t = convTarget('firms')!;
    const head = ['Naziv na firma', 'EDB', 'Maticen broj', 'Grad', 'DDV obvrznik', 'Period DDV'];
    const res = convApply(t, [['ОМЕГА ТРЕЈД ДООЕЛ', '4030019000099', '7000099', 'Куманово', 'da', 'mesecno']], convAuto(t, head));
    expect(convCheck(t, res).diff).toEqual([]);
    const P = await readFirmsFile(form({ file: xlsxFile(res.grid, 'Firmi_konv.xlsx') }));
    expect(P.error).toBeUndefined();
    expect((await importFirms(P.rows!.map((x) => x.f), { ddv: false, profiles: false })).ok).toMatch(/Увезени 1 нови/);
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.name, 'ОМЕГА ТРЕЈД ДООЕЛ'));
    expect(f).toMatchObject({ edb: '4030019000099', embs: '7000099', city: 'Куманово', vatRegistered: true, vatPeriod: 'month' });
  });

  it('partners → converted .xlsx → Увоз од Excel (the importer reads it with impAuto)', async () => {
    const t = convTarget('imp:partners')!;
    const res = convApply(t, [['СИГМА ДОО', '4030000000777', 'Битола', 'sigma@x.mk']], convAuto(t, ['Firma', 'Danocen broj', 'Mesto', 'E-mail']));
    // the browser importer: SheetJS → header row → columns by heading → field rows → importAction
    const wb = XLSX.read(new Uint8Array(await xlsxFile(res.grid, 'p.xlsx').arrayBuffer()), { type: 'array' });
    const R = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' });
    const hi = impHeaderRow(R), map = impAuto('partners', R[hi]!);
    // every column of the converted file has its own field (the empty ones too)
    expect(Object.keys(map).sort()).toEqual(IMP_T.partners.f.map(([k]) => k).sort());
    const rows = R.slice(hi + 1).map((r) => Object.fromEntries(IMP_T.partners.f.filter(([k]) => map[k] != null).map(([k]) => [k, String(r[map[k]!] ?? '')])));
    const r = await importAction({}, form({ payload: JSON.stringify({ t: 'partners', date: '2026-01-01', rows }) }));
    expect(r.ok).toMatch(/1 додадени/);
    const [p] = await pg.select().from(schema.partners).where(eq(schema.partners.name, 'СИГМА ДОО'));
    expect(p).toMatchObject({ edb: '4030000000777', city: 'Битола', email: 'sigma@x.mk' });
  });
});
