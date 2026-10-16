/**
 * One file with several incoming invoices → several purchases (the rule of the bank import: every document is
 * registered separately). An AI read returning `invoices[]` gives one draft per invoice; saving gives one purchase with
 * its own journal per invoice, each linked to the source file with its pages; reading the same invoices again marks
 * them as duplicates (supplier ЕДБ + number + date); photos uploaded together are read as pages and each invoice keeps
 * only its photos. Synthetic data only (`@wise/core/noai/purchase-multi.fixtures`).
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScanPurchaseDraft, ScanSaleDraft } from '@wise/core/sales';
import { MULTI_INVOICES, MULTI_OWN_EDB, multiInvoiceItems } from '@wise/core/noai/purchase-multi.fixtures';
import { invoicesFromPdf } from '@wise/core/noai/purchase';
import { pdfLines } from '@wise/core/noai/pdf-lines';
import { acceptFree, WHY } from './free-first';
import { draftSourceFiles, ensurePartner, markDraftSaved, purchaseInputFromDraft, saveInvoice, savePurchase, schema, seedReference, skipDraft, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from './client';
import { setObjectReader } from './storage';
import { INV_MULTI_ADD } from './prompts';
import { numberRange } from './drafts';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
const T = <R>(f: (tx: Tx) => Promise<R>) => pg.transaction((tx) => f(tx as unknown as Tx));
let firmId = '';
const BYTES = new Map<string, Uint8Array>();
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const NAMES = ['ПРИМЕР ТРЕЈД ДООЕЛ', 'ТЕСТ ДИСТРИБУЦИЈА ДОО', 'ПРОБА УСЛУГИ ДООЕЛ'];

/** The model's answer: the three invoices of the file, each its own object. */
const answer = (o: { total2?: number } = {}) => JSON.stringify({
  invoices: MULTI_INVOICES.map((x, k) => ({
    supplierName: NAMES[k], supplierEdb: x.supplierEdb, buyerName: 'НАША ФИРМА ДОО', buyerEdb: MULTI_OWN_EDB, number: x.number, date: x.date, art32: false,
    groups: x.groups.map((g) => ({ ...g, kind: 'other' })), lines: [], total: k === 1 && o.total2 ? o.total2 : x.total, pages: x.pages,
  })),
});

function fake(answers: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answers.shift() ?? '{}', citations: null }],
        usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}

let seq = 0;
async function file(name: string, sha = String(++seq).padStart(64, '0')) {
  const key = 'k/' + ++seq;
  BYTES.set(key, IMG);
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: key, name, mime: 'image/jpeg', size: IMG.length, sha256: sha, status: 'ready' }).returning();
  return f!.id;
}
async function doc(fileId: string, options: Record<string, unknown> = {}) {
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId, kind: 'purchase', options }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
  const [f] = await pg.insert(schema.firms).values({ name: 'НАША ФИРМА ДОО', edb: MULTI_OWN_EDB }).returning();
  firmId = f!.id;
  setObjectReader(async (k) => BYTES.get(k) ?? IMG);
}, 60_000);
beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('one file, three invoices', () => {
  let docId = '', fileId = '';

  it('the AI read returns invoices[] → 3 drafts, each with its own supplier, number, date, VAT and total', async () => {
    const api = fake([answer()]);
    setAiClient(api);
    fileId = await file('fakturi.jpg');
    docId = await doc(fileId);
    await runReadDocument(db, docId);
    const d = await load(docId);
    expect(d.status).toBe('done');
    // the prompt asks for one object per invoice (appended note, the legacy prompt stays verbatim)
    const text = (api.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[]).find((b) => b.type === 'text') as Anthropic.TextBlockParam;
    expect(text.text.endsWith(INV_MULTI_ADD)).toBe(true);
    expect(d.drafts).toHaveLength(3);
    const D = d.drafts.map((x) => x.draft as unknown as ScanPurchaseDraft);
    expect(D.map((x) => [x.number, x.docDate, x.supplierEdb, x.pages])).toEqual(MULTI_INVOICES.map((x) => [x.number, x.date, x.supplierEdb, x.pages]));
    expect(D.map((x) => x.groups.map((g) => [g.rate, g.base, g.vat]))).toEqual(MULTI_INVOICES.map((x) => x.groups.map((g) => [g.rate, g.base, g.vat])));
    expect(d.drafts.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('saving: 3 purchases, each with its own journal, the source file linked to each with its pages', async () => {
    const d = await load(docId);
    const ids: string[] = [];
    for (const [i, x] of d.drafts.entries()) {
      const src = draftSourceFiles(d, i);
      expect(src).toMatchObject({ fileIds: [fileId], shared: true });
      ids.push(await T(async (tx) => {
        const r = await savePurchase(tx, firmId, purchaseInputFromDraft(x.draft as unknown as ScanPurchaseDraft, src), { userId: null, role: 'acc' });
        await markDraftSaved(tx, firmId, docId, i, r.id);
        return r.id;
      }));
    }
    const P = await pg.select().from(schema.purchases).where(inArray(schema.purchases.id, ids)).orderBy(asc(schema.purchases.docDate));
    expect(P.map((p) => [p.number, p.docDate, Number(p.total), p.supplierEdb, p.data.srcPages])).toEqual(
      MULTI_INVOICES.map((x) => [x.number, x.date, x.total, x.supplierEdb, x.pages]));
    // three separate journals (one per invoice), each balanced, each with its own supplier amount
    const J = await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'purchase'), inArray(schema.journals.sourceId, ids)));
    expect(J).toHaveLength(3);
    expect(new Set(J.map((j) => j.sourceId)).size).toBe(3);
    for (const j of J) {
      const L = await pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id));
      const dr = L.reduce((a, l) => a + Number(l.debit), 0), cr = L.reduce((a, l) => a + Number(l.credit), 0);
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
      const p = P.find((x) => x.id === j.sourceId)!;
      // the supplier is credited with THIS invoice's total (never the sum of the file)
      expect(L.filter((l) => Math.round(Number(l.credit) * 100) === Math.round(Number(p.total) * 100)).length).toBeGreaterThan(0);
      expect(L.some((l) => Math.round(Number(l.credit) * 100) === 488000)).toBe(false);
    }
    // the source file is attached to every one of them
    const links = await pg.select().from(schema.fileLinks).where(and(eq(schema.fileLinks.fileId, fileId), eq(schema.fileLinks.entityType, 'purchase')));
    expect(links.map((l) => l.entityId).sort()).toEqual([...ids].sort());
    expect((await load(docId)).status).toBe('saved');
  });

  it('the same invoices read again: each is a duplicate (also with another amount: supplier ЕДБ + number + date)', async () => {
    setAiClient(fake([answer({ total2: 3371 })]));
    const again = await doc(await file('fakturi-pak.jpg'));
    await runReadDocument(db, again);
    const d = await load(again);
    expect(d.drafts.map((x) => x.status)).toEqual(['dup', 'dup', 'dup']);
    expect(d.drafts[1]!.msg).toMatch(/веќе е заведена: F-2026-0042 од 06\.10\.2026/);
  });

  it('the same invoice twice in one file (original + copy): the second is a duplicate within the read', async () => {
    const one = JSON.parse(answer()) as { invoices: Record<string, unknown>[] };
    const copy = { ...one.invoices[0]!, number: '900/2026', supplierEdb: '4030999000999', supplierName: 'НОВ ДОБАВУВАЧ ДОО' };
    setAiClient(fake([JSON.stringify({ invoices: [copy, { ...copy, pages: '2' }] })]));
    const id = await doc(await file('kopija.jpg'));
    await runReadDocument(db, id);
    const d = await load(id);
    expect(d.drafts.map((x) => x.status)).toEqual(['ok', 'dup']);
    expect(d.drafts[1]!.msg).toMatch(/погоре во овој документ/);
    // „Прескокни“ leaves the copy out; the document is not done until the first one is saved
    await T((tx) => skipDraft(tx, firmId, id, 1));
    expect((await load(id))).toMatchObject({ status: 'done' });
    expect((await load(id)).drafts[1]!.skipped).toBe(true);
  });

  it('several invoices read as ONE with a range number („101-103“) are never ready to save', async () => {
    expect(numberRange('101-103')).toBe(true);
    expect(numberRange('F-2026-0042')).toBe(false);
    expect(numberRange('12-2026')).toBe(false);
    const one = JSON.parse(answer()) as { invoices: Record<string, unknown>[] };
    setAiClient(fake([JSON.stringify({ ...one.invoices[0]!, number: '101-103', supplierEdb: '4030999000888', supplierName: 'ОПСЕГ ДОО' })]));
    const id = await doc(await file('opseg.jpg'));
    await runReadDocument(db, id);
    expect((await load(id)).drafts[0]).toMatchObject({ status: 'check', msg: expect.stringMatching(/опсег/) });
  });
});

describe('OUTGOING: one file with three issued invoices', () => {
  const B = [['КУПУВАЧ ЕДЕН ДООЕЛ', '4030999000101'], ['КУПУВАЧ ДВА ДОО', '4030999000202'], ['КУПУВАЧ ТРИ ДООЕЛ', '4030999000303']] as const;
  const sale = () => JSON.stringify({
    invoices: [['0501/2026', '2026-10-01', 1000, 18], ['0502/2026', '2026-10-02', 400, 5], ['0503/2026', '2026-10-03', 300, 10]].map(([no, date, base, rate], k) => ({
      number: no, date, dueDate: date, buyerName: B[k]![0], buyerEdb: B[k]![1], art32: false,
      groups: [{ rate, base, vat: (base as number) * (rate as number) / 100 }],
      lines: [{ name: 'Услуга ' + (k + 1), qty: 1, price: base, amount: base, rate }], total: (base as number) * (1 + (rate as number) / 100), pages: String(k + 1),
    })),
  });
  it('3 drafts → 3 invoices with their own journals; read again → duplicates', async () => {
    setAiClient(fake([sale()]));
    const fid = await file('izlezni.jpg');
    const [d0] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: fid, kind: 'sale', options: {} }).returning();
    await runReadDocument(db, d0!.id);
    const d = await load(d0!.id);
    expect(d.drafts.map((x) => [(x.draft as unknown as ScanSaleDraft).number, (x.draft as unknown as ScanSaleDraft).date, (x.draft as unknown as ScanSaleDraft).buyer.edb, x.status]))
      .toEqual([['0501/2026', '2026-10-01', B[0][1], 'ok'], ['0502/2026', '2026-10-02', B[1][1], 'ok'], ['0503/2026', '2026-10-03', B[2][1], 'ok']].map((x) => x));
    const ids: string[] = [];
    for (const [i, x] of d.drafts.entries()) {
      const s = x.draft as unknown as ScanSaleDraft;
      ids.push(await T(async (tx) => {
        const p = await ensurePartner(tx, firmId, { name: s.buyer.name, edb: s.buyer.edb, type: 'customer' });
        const r = await saveInvoice(tx, firmId, { kind: 'invoice', number: s.number, date: s.date, due: s.due || null, partnerId: p.id, lines: s.items.map((l) => ({ name: l.name, qty: l.qty, price: l.price, rate: l.rate, account: l.konto })) }, { userId: null, role: 'acc' });
        await markDraftSaved(tx, firmId, d.id, i, r.id);
        return r.id;
      }));
    }
    const I = await pg.select().from(schema.invoices).where(inArray(schema.invoices.id, ids)).orderBy(asc(schema.invoices.number));
    expect(I.map((x) => [x.number, x.date, Number(x.total)])).toEqual([['0501/2026', '2026-10-01', 1180], ['0502/2026', '2026-10-02', 420], ['0503/2026', '2026-10-03', 330]]);
    const J = await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), inArray(schema.journals.sourceId, ids)));
    expect(J).toHaveLength(3);
    setAiClient(fake([sale()]));
    const again = await doc(await file('izlezni-pak.jpg'));
    await pg.update(schema.aiDocuments).set({ kind: 'sale' }).where(eq(schema.aiDocuments.id, again));
    await runReadDocument(db, again);
    expect((await load(again)).drafts.map((x) => x.status)).toEqual(['dup', 'dup', 'dup']);
  });
});

describe('free reader (text PDF) with several invoices', () => {
  it('accepted without AI only when EVERY invoice checks; a mismatch in one sends the file to AI', () => {
    const I = invoicesFromPdf(pdfLines(multiInvoiceItems()), { ownEdb: MULTI_OWN_EDB });
    expect(acceptFree('purchase', { invoices: I }).ok).toBe(true);
    const bad = multiInvoiceItems().map((x) => (x.page === 4 && x.s === '30,00' ? { ...x, s: '33,00' } : x));
    expect(acceptFree('purchase', { invoices: invoicesFromPdf(pdfLines(bad), { ownEdb: MULTI_OWN_EDB }) })).toEqual({ ok: false, why: WHY.sums });
  });
});

describe('photos uploaded together = pages of several invoices', () => {
  it('read in one call; each invoice keeps only the photos of its pages', async () => {
    const api = fake([answer()]);
    setAiClient(api);
    const F = [await file('s1.jpg'), await file('s2.jpg'), await file('s3.jpg'), await file('s4.jpg')];
    const id = await doc(F[0]!, { extraFileIds: F.slice(1) });
    await runReadDocument(db, id);
    const blocks = api.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(4);
    expect((blocks.find((b) => b.type === 'text') as Anthropic.TextBlockParam).text).toMatch(/4 images above are the PAGES/);
    const d = await load(id);
    expect(d.drafts).toHaveLength(3);
    expect([0, 1, 2].map((i) => draftSourceFiles(d, i).fileIds)).toEqual([[F[0]], [F[1], F[2]], [F[3]]]);
  });
});
