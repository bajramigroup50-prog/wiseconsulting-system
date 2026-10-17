/**
 * Draft rules of read incoming invoices end to end (synthetic data, PGlite): electricity on 4030 from the chart, the
 * supplier's konto from its last saved purchase, the previous debt of a bill left out, pro-formas never booked, the
 * drafts of unsaved reads rebuilt with the current rules (saved ones untouched), and an explicit re-read that is a new
 * AI read (never a reuse of the earlier read of the same file).
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScanPurchaseDraft } from '@wise/core/sales';
import {
  purchaseInputFromDraft, refreshStaleScanDrafts, savePurchase, saveReadyScanDrafts, scanNeedsReread, schema, seedReference, markDraftSaved, SCAN_RULES_V, type Tx,
} from '@wise/db';
import { setAiClient, type MessagesApi } from './client';
import { setObjectReader } from './storage';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
const T = <R>(f: (tx: Tx) => Promise<R>) => pg.transaction((tx) => f(tx as unknown as Tx));
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const OWN = '4030999000001';
let firmId = '';

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
async function doc(name: string, o: { sha?: string; options?: Record<string, unknown> } = {}) {
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + ++seq, name, mime: 'image/jpeg', size: IMG.length, sha256: o.sha ?? String(seq).padStart(64, '0'), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind: 'purchase', options: o.options ?? {} }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const firm = async () => (await pg.select().from(schema.firms).where(eq(schema.firms.id, firmId)))[0]!;
const dr = (d: { drafts: { draft: Record<string, unknown> }[] }, i = 0) => d.drafts[i]!.draft as unknown as ScanPurchaseDraft;
const read = async (answer: object, name = 'f.jpg', o: { sha?: string; options?: Record<string, unknown> } = {}) => {
  setAiClient(fake([JSON.stringify(answer)]));
  const id = await doc(name, o);
  await runReadDocument(db, id);
  return load(id);
};

const BUYER = { buyerName: 'НАША ФИРМА ДОО', buyerEdb: OWN, art32: false, lines: [] };
const EVN = { ...BUYER, supplierName: 'ЕВН ПРИМЕР ДООЕЛ', supplierEdb: '4030999000777' };
const TEL = { ...BUYER, supplierName: 'ТЕЛЕКОМ ПРИМЕР АД', supplierEdb: '4030999000888' };

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
  const [f] = await pg.insert(schema.firms).values({ name: 'НАША ФИРМА ДОО', edb: OWN }).returning();
  firmId = f!.id;
  // the firm's chart (as in production): both 4020 and 4030 named „Електрична енергија“ — electricity is 4030
  await pg.insert(schema.accounts).values([{ firmId, code: '4020', name: 'Електрична енергија' }, { firmId, code: '4030', name: 'Електрична енергија' }]);
  setObjectReader(async () => IMG);
}, 60_000);
beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('kontos of a read incoming invoice', () => {
  it('electricity → 4030 (chart), other groups → 4000; the previous debt is left out with a note', async () => {
    const d = await read({ ...EVN, number: '7700000001', date: '2026-08-31', docType: 'invoice', groups: [{ rate: 18, base: 2463.13, vat: 443.36, kind: 'energy' }, { rate: 0, base: 382, vat: 0, kind: 'other' }], total: 3711, prevDebt: 422.51 });
    expect(dr(d).groups.map((g) => [g.rate, g.konto])).toEqual([[18, '4030'], [0, '4000']]);
    expect(dr(d).prevDebt).toBe(422.51);
    expect(d.drafts[0]!.status).toBe('ok');
    expect(d.drafts[0]!.msg).toMatch(/претходниот долг 422[,.]51 не се книжи/);
    expect((d.options as { rulesV?: number }).rulesV).toBe(SCAN_RULES_V);
  });

  it("the supplier's konto of its last saved purchase is proposed for its next invoice", async () => {
    const a = await read({ ...TEL, number: 'T-1/2026', date: '2026-08-05', groups: [{ rate: 18, base: 1000, vat: 180, kind: 'service' }], total: 1180 });
    expect(dr(a).groups[0]!.konto).toBe('4000');
    // the user books Телеком on 4120 once
    await T(async (tx) => {
      const x = { ...dr(a), groups: dr(a).groups.map((g) => ({ ...g, konto: '4120' })) };
      const r = await savePurchase(tx, firmId, purchaseInputFromDraft(x, { fileIds: [], shared: false }), { userId: null, role: 'acc' });
      await markDraftSaved(tx, firmId, a.id, 0, r.id);
    });
    const b = await read({ ...TEL, number: 'T-2/2026', date: '2026-09-05', groups: [{ rate: 18, base: 2480.38, vat: 446.47, kind: 'service' }], total: 2999, prevDebt: 72.15 });
    expect(dr(b).groups[0]!.konto).toBe('4120');
    expect(dr(b).groups[0]!.base).toBe(2480.38);
    expect(b.drafts[0]!.msg).toMatch(/претходниот долг 72[,.]15/);
  });
});

describe('pro-forma', () => {
  const lines = Array.from({ length: 16 }, (_, i) => ({ name: 'LAVAZZA КАФЕ ' + (i + 1), qty: 2, price: 419.23, amount: 838.46, rate: 18 }));
  const DEN = { ...BUYER, supplierName: 'ДЕНМАК ПРИМЕР ДООЕЛ', supplierEdb: '4030999000333', lines, groups: [{ rate: 18, base: 13412.03, vat: 2413.97, kind: 'goods' }], total: 15826 };

  it('a read the model calls a pro-forma is never booked (skip, not in the bulk save)', async () => {
    const d = await read({ ...DEN, number: 'PF-7/2026', date: '2026-07-01', docType: 'proforma' });
    expect(d.drafts[0]).toMatchObject({ status: 'skip', msg: 'профактура – не се книжи', skipped: true });
    const R = await saveReadyScanDrafts(db, { firm: { id: firmId }, kind: 'purchase', where: eq(schema.aiDocuments.id, d.id), actor: { userId: null, role: 'acc' } as never, past: null });
    expect(R.saved).toBe(0);
  });

  it('two reads of the same supplier with the same lines and total under other numbers: the later one is held for a check (and offered a new read)', async () => {
    const a = await read({ ...DEN, number: 'F01324', date: '2026-08-31' }, 'den1.jpg');
    expect(a.drafts[0]!.status).not.toBe('skip');
    const b = await read({ ...DEN, number: '01488', date: '2026-09-28' }, 'den2.jpg');
    expect(b.drafts[0]!.status).toBe('check');
    expect(b.drafts[0]!.msg).toMatch(/исти ставки и износ како F01324 од 31\.08\.2026 – едната е можеби профактура/);
    expect(scanNeedsReread(b)).toBe(true);
  });
});

describe('rules applied again to unsaved reads (no AI)', () => {
  it('an older read is rebuilt from its stored result; a saved draft of it is never touched', async () => {
    const d = await read({ invoices: [
      { ...EVN, number: '7700000002', date: '2026-09-30', groups: [{ rate: 18, base: 100, vat: 18, kind: 'energy' }], total: 118, pages: '1' },
      { ...EVN, number: '7700000003', date: '2026-09-30', groups: [{ rate: 18, base: 200, vat: 36, kind: 'energy' }], total: 236, pages: '2' },
    ] }, 'evn2.jpg');
    // simulate the drafts of the old rules (default konto) and the first one already saved
    const old = d.drafts.map((x) => ({ ...x, draft: { ...x.draft, groups: (x.draft as unknown as ScanPurchaseDraft).groups.map((g) => ({ ...g, konto: '4000' })) } }));
    old[0] = { ...old[0]!, savedId: '00000000-0000-0000-0000-000000000001' };
    await pg.update(schema.aiDocuments).set({ drafts: old, options: {} }).where(eq(schema.aiDocuments.id, d.id));
    const r = await refreshStaleScanDrafts(db, await firm(), [await load(d.id)]);
    expect(r.rebuilt).toBe(1);
    const n = await load(d.id);
    expect(n.drafts[0]).toEqual(old[0]);
    expect(dr(n, 1).groups[0]!.konto).toBe('4030');
    expect((n.options as { rulesV?: number }).rulesV).toBe(SCAN_RULES_V);
    // current: nothing to do until forced
    expect((await refreshStaleScanDrafts(db, await firm(), [n])).rebuilt).toBe(0);
    expect((await refreshStaleScanDrafts(db, await firm(), [n], { force: true })).rebuilt).toBe(1);
  });
});

describe('explicit re-read', () => {
  it('reuses the earlier read of the same file normally, but „↻ Прочитај повторно“ (reread) is a new AI read', async () => {
    const sha = 'e'.repeat(64);
    const first = await read({ ...TEL, number: 'T-9/2026', date: '2026-09-09', groups: [{ rate: 18, base: 10, vat: 1.8 }], total: 11.8 }, 'tel9.jpg', { sha });
    expect(first.status).toBe('done');
    const api = fake([JSON.stringify({ ...TEL, number: 'T-9/2026', date: '2026-09-09', groups: [{ rate: 18, base: 10, vat: 1.8 }], total: 11.8 })]);
    setAiClient(api);
    const again = await doc('tel9b.jpg', { sha });
    await runReadDocument(db, again);
    expect(api.calls).toHaveLength(0);
    expect((await load(again)).options).toMatchObject({ cachedFrom: first.id });
    const re = await doc('tel9c.jpg', { sha, options: { retry: true, reread: true } });
    await runReadDocument(db, re);
    expect(api.calls).toHaveLength(1);
    expect((await load(re)).options).not.toHaveProperty('cachedFrom');
    expect(await pg.select().from(schema.aiDocuments).where(and(eq(schema.aiDocuments.id, re), eq(schema.aiDocuments.status, 'done')))).toHaveLength(1);
  });
});
