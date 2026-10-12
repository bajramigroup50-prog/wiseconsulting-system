/**
 * AI cost control: free reader first (accepted when its checks pass), sha256 reuse, monthly budget (80 % alert,
 * pause at 100 %), reserve-before / settle-after cost log, model tiers, PDF page cap / blank pages, cost report.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { costReport, monthProjection, budgetLevel } from '@wise/core/ai/cost';
import { kontrolaFromText } from '@wise/core/noai/kontrola';
import { UJP_ZAPISNIK } from '@wise/core/noai/kontrola.fixtures';
import { aiDocAgg, aiUsageAgg, curMonth, getAiBudget, putAiBudget, schema, type AiDocKind, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from './client';
import { AiBudgetError, effectiveTier, preparePdf, typicalDocCost } from './budget';
import { acceptFree, WHY } from './free-first';
import { freeRead } from './free-read';
import { readContent } from './read-document';
import { setObjectReader } from './storage';
import { runReadDocument } from '../jobs/ai-read-document';
import { lawRobotUsesAi, runLawRobot } from '../jobs/law';
import { classifyText } from '@wise/core/noai/classify';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', firm2 = '';
const FIX = join(__dirname, '../../../web/test/import/fixtures');
const fix = (n: string) => new Uint8Array(readFileSync(join(FIX, n)));
const BYTES = new Map<string, Uint8Array>();

function fake(answers: string[], fail = false): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      if (fail) throw Object.assign(new Error('overloaded_error'), { status: 529 });
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answers.shift() ?? '{}', citations: null }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}

let seq = 0;
async function doc(kind: AiDocKind, name: string, mime: string, bytes: Uint8Array, o: { sha?: string; options?: Record<string, unknown>; firm?: string } = {}) {
  const key = 'k/' + ++seq;
  BYTES.set(key, bytes);
  const fid = o.firm ?? firmId;
  const [f] = await pg.insert(schema.files).values({ firmId: fid, bucketKey: key, name, mime, size: bytes.length, sha256: o.sha ?? 'x'.repeat(64), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId: fid, fileId: f!.id, kind, options: o.options ?? {} }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const spend = async (firm: string | null, usd: number) => pg.insert(schema.aiUsage).values({ firmId: firm, purpose: 'test', tier: 'default', model: AI_MODELS.default, costUsd: usd.toFixed(6) });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Наша фирма', edb: '4030000000001' }).returning();
  const [g] = await pg.insert(schema.firms).values({ name: 'Друга фирма', edb: '4030000000002' }).returning();
  firmId = f!.id; firm2 = g!.id;
  setObjectReader(async (k) => BYTES.get(k) ?? new TextEncoder().encode('%PDF-1.4 fake'));
}, 60_000);
beforeEach(async () => {
  await pg.delete(schema.aiUsage);
  await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'aiBudget'));
  process.env.ANTHROPIC_API_KEY = 'test';
});
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('free first: acceptance per kind', () => {
  it('bank: a reconciled statement passes, a non-reconciling one goes to AI', async () => {
    const r = await freeRead('bank', { name: 'halk.pdf', mime: 'application/pdf' }, fix('halk.pdf'));
    expect(acceptFree('bank', r)).toEqual({ ok: true, why: '' });
    expect(acceptFree('bank', { ...(r as object), balanced: false })).toEqual({ ok: false, why: WHY.sums });
    expect(acceptFree('bank', { ...(r as object), balanced: null })).toEqual({ ok: false, why: WHY.sums });
    // structured file (CSV / XML): balances given → must reconcile
    const I = [{ amount: 100 }, { amount: -40 }];
    expect(acceptFree('bank', { openingBalance: 10, closingBalance: 70, items: I }).ok).toBe(true);
    expect(acceptFree('bank', { openingBalance: 10, closingBalance: 71, items: I })).toEqual({ ok: false, why: WHY.sums });
    expect(acceptFree('bank', { openingBalance: 0, closingBalance: 0, items: I }).ok).toBe(true);
  });
  it('ob: debit = credit and the printed totals match', () => {
    const rows = [['100', 'Жиро', '', '', 1000, 0], ['220', 'Добавувачи', '', '', 0, 1000]];
    expect(acceptFree('ob', { rows, totals: [] }).ok).toBe(true);
    expect(acceptFree('ob', { rows: [rows[0], ['220', 'Добавувачи', '', '', 0, 900]], totals: [] })).toEqual({ ok: false, why: WHY.sums });
    expect(acceptFree('ob', { rows, totals: [['1', 1000, 5]] })).toEqual({ ok: false, why: WHY.sums });
  });
  it('invoice: base × rate = VAT and groups = total', async () => {
    const r = await freeRead('purchase', { name: 'f.pdf', mime: 'application/pdf' }, fix('inv-recap.pdf'), { ownEdb: '4030999000111' });
    expect(acceptFree('purchase', r).ok).toBe(true);
    const ok = { total: 1180, groups: [{ rate: 18, base: 1000, vat: 180 }], lines: [] };
    expect(acceptFree('sale', ok).ok).toBe(true);
    expect(acceptFree('sale', { ...ok, groups: [{ rate: 18, base: 1000, vat: 150 }] })).toEqual({ ok: false, why: WHY.sums });
    expect(acceptFree('sale', { ...ok, total: 1300 })).toEqual({ ok: false, why: WHY.sums });
  });
  it('kontrola: header and at least one finding', () => {
    const r = kontrolaFromText(UJP_ZAPISNIK.split('\n'));
    expect(acceptFree('kontrola', r).ok).toBe(true);
    expect(acceptFree('kontrola', { ...r, findings: [] })).toEqual({ ok: false, why: WHY.header });
  });
});

describe('free first in the read job (AI available)', () => {
  it('a reconciled bank PDF and a consistent invoice PDF are read without any AI call', async () => {
    const api = fake([]);
    setAiClient(api);
    const b = await doc('bank', 'halk.pdf', 'application/pdf', fix('halk.pdf'));
    const p = await doc('purchase', 'f.pdf', 'application/pdf', fix('inv-recap.pdf'));
    await runReadDocument(db, b);
    await runReadDocument(db, p);
    expect(api.calls).toHaveLength(0);
    expect(await load(b)).toMatchObject({ status: 'done', model: 'noai' });
    const P = await load(p);
    expect(P).toMatchObject({ status: 'done', model: 'noai' });
    expect(P.drafts.length).toBe(1);
  });
  it('a trial balance CSV that balances: no AI; one that does not: AI with the reason', async () => {
    const api = fake(['{"rows":[],"totals":[],"grand":[0,0]}']);
    setAiClient(api);
    const csv = (c: string) => new TextEncoder().encode('Конто;Назив;Должи;Побарува\n100;Жиро сметка;1.000,00;0,00\n220;Добавувачи;0,00;' + c + '\n');
    const a = await doc('ob', 'bb.csv', 'text/csv', csv('1.000,00'));
    await runReadDocument(db, a);
    expect(api.calls).toHaveLength(0);
    expect(await load(a)).toMatchObject({ status: 'done', model: 'noai' });
    const b = await doc('ob', 'bb2.csv', 'text/csv', csv('900,00'));
    await runReadDocument(db, b);
    expect(api.calls).toHaveLength(1);
    expect(await load(b)).toMatchObject({ status: 'done', model: AI_MODELS.default, options: { aiWhy: WHY.sums } });
  });
  it('a scan goes to AI and says why', async () => {
    const api = fake(['{"items":[{"date":"2026-03-02","amount":5}]}']);
    setAiClient(api);
    const id = await doc('bank', 'scan.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]));
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(1);
    expect((await load(id)).options).toMatchObject({ aiWhy: WHY.scan });
  });
});

describe('sha256 cache', () => {
  it('the same file (same content) of the same kind is read with AI once', async () => {
    const api = fake(['{"name":"Ана","embg":"0101990455001"}']);
    setAiClient(api);
    const sha = 'a'.repeat(64);
    const a = await doc('emp', 'ugovor.pdf', 'application/pdf', new Uint8Array([9]), { sha });
    const b = await doc('emp', 'ugovor (1).pdf', 'application/pdf', new Uint8Array([9]), { sha });
    await runReadDocument(db, a);
    await runReadDocument(db, b);
    expect(api.calls).toHaveLength(1);
    expect(await load(b)).toMatchObject({ status: 'done', model: AI_MODELS.default, result: { name: 'Ана' }, options: { cachedFrom: a } });
    // another kind or another firm is read again
    const c = await doc('imp', 'ugovor.pdf', 'application/pdf', new Uint8Array([9]), { sha });
    const d = await doc('emp', 'ugovor.pdf', 'application/pdf', new Uint8Array([9]), { sha, firm: firm2 });
    await runReadDocument(db, c);
    await runReadDocument(db, d);
    expect(api.calls).toHaveLength(3);
  });
});

describe('monthly budget', () => {
  it('80 %: the owner is notified once (aiBudget.alert); the call still runs', async () => {
    await putAiBudget(db, { monthlyUsd: 10 });
    await spend(firmId, 7.999);
    const api = fake(['{"a":1}', '{"a":2}']);
    setAiClient(api);
    await readContent({ db, firmId, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' });
    const B = await getAiBudget(db);
    expect(B.alert).toMatchObject({ month: curMonth(), level: 80, limit: 10 });
    const at = B.alert!.at;
    await readContent({ db, firmId, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' });
    expect((await getAiBudget(db)).alert!.at).toBe(at);
    expect(api.calls).toHaveLength(2);
  });
  it('100 %: AI is paused (no call), the free readers continue, the owner can raise the limit', async () => {
    await putAiBudget(db, { monthlyUsd: 5 });
    await spend(null, 5);
    const api = fake(['{"items":[]}']);
    setAiClient(api);
    await expect(readContent({ db, firmId, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' })).rejects.toBeInstanceOf(AiBudgetError);
    // a scan cannot be read for free → clear message with the code `budget`
    const s = await doc('bank', 'scan.jpg', 'image/jpeg', new Uint8Array([1]));
    await runReadDocument(db, s);
    expect(await load(s)).toMatchObject({ status: 'error', options: { errCode: 'budget' } });
    expect((await load(s)).error).toMatch(/лимит за AI/);
    // a text statement is still read (free reader), whether it reconciles or not
    const t = await doc('bank', 'halk.pdf', 'application/pdf', fix('halk.pdf'));
    await runReadDocument(db, t);
    expect(await load(t)).toMatchObject({ status: 'done', model: 'noai' });
    expect(api.calls).toHaveLength(0);
    await putAiBudget(db, { monthlyUsd: 50 });
    await readContent({ db, firmId, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' });
    expect(api.calls).toHaveLength(1);
  });
  it('a firm limit pauses only that firm', async () => {
    await putAiBudget(db, { monthlyUsd: 100, firms: { [firm2]: 1 } });
    await spend(firm2, 1);
    setAiClient(fake(['{}', '{}']));
    await expect(readContent({ db, firmId: firm2, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' })).rejects.toThrow(/оваа фирма/);
    await expect(readContent({ db, firmId, prompt: 'x', purpose: 'emp' }, { blocks: [], extra: '' })).resolves.toBeTruthy();
  });
  it('cost is reserved before the call and settled after it (0 when the provider failed)', async () => {
    setAiClient(fake([], true));
    await expect(readContent({ db, firmId, prompt: 'x', purpose: 'emp', refId: 'r-fail' }, { blocks: [], extra: '' })).rejects.toThrow();
    const [u] = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, 'r-fail'));
    expect(Number(u!.costUsd)).toBe(0);
    setAiClient(fake(['{}']));
    await readContent({ db, firmId, prompt: 'x', purpose: 'emp', refId: 'r-ok' }, { blocks: [], extra: '' });
    const [v] = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, 'r-ok'));
    expect(v).toMatchObject({ inputTokens: 1000, outputTokens: 200 });
    expect(Number(v!.costUsd)).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 6);
  });
});

describe('model tiers and pages', () => {
  it('Opus only on an explicit detailed read', async () => {
    expect(effectiveTier('complex', false, { opusOnlyDeep: true })).toBe('default');
    expect(effectiveTier('complex', true, { opusOnlyDeep: true })).toBe('complex');
    expect(effectiveTier('complex', false, { opusOnlyDeep: false })).toBe('complex');
    const api = fake(['{"days":[{"date":"2026-03-01","z":"1","gross":{"А":118},"vat":{"А":18},"total":118}]}']);
    setAiClient(api);
    const id = await doc('fisk', 'z.jpg', 'image/jpeg', new Uint8Array([1]), { options: { deep: true } });
    await runReadDocument(db, id);
    expect(api.calls[0]!.model).toBe(AI_MODELS.complex);
  });
  it('blank pages are not sent; a PDF over the page cap is refused with a message', async () => {
    const d = await PDFDocument.create();
    const font = await d.embedFont(StandardFonts.Helvetica);
    d.addPage().drawText('Izvod 1', { x: 50, y: 700, font });
    d.addPage();
    d.addPage().drawText('Izvod 2', { x: 50, y: 700, font });
    const bytes = await d.save();
    const r = await preparePdf(bytes, 30);
    expect(r).toMatchObject({ pages: 2, dropped: 1, over: false });
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(2);
    expect((await preparePdf(bytes, 1)).over).toBe(true);
    await putAiBudget(db, { maxPages: 1 });
    setAiClient(fake(['{}']));
    const blocks: Anthropic.ContentBlockParam[] = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }];
    await expect(readContent({ db, firmId, prompt: 'x', purpose: 'bank' }, { blocks, extra: '' })).rejects.toThrow(/2 страници – над лимитот од 1/);
  });
});

describe('cost report', () => {
  it('aggregates per firm / kind / model with free vs AI and the average per document', async () => {
    const m = curMonth();
    await pg.insert(schema.aiUsage).values([
      { firmId, purpose: 'purchase', tier: 'quick', model: AI_MODELS.quick, inputTokens: 3000, outputTokens: 1000, costUsd: '0.000800', refId: 'd1' },
      { firmId, purpose: 'purchase', tier: 'default', model: AI_MODELS.default, inputTokens: 3000, outputTokens: 1000, costUsd: '0.016000', refId: 'd1' },
      { firmId: firm2, purpose: 'bank', tier: 'default', model: AI_MODELS.default, inputTokens: 10000, outputTokens: 3000, costUsd: '0.050000', refId: 'd2' },
      { firmId: null, purpose: 'law', tier: 'default', model: AI_MODELS.default, inputTokens: 1000, outputTokens: 500, costUsd: '0.007000', refId: 'run' },
    ]);
    const U = await aiUsageAgg(db, m);
    const D = await aiDocAgg(db, m);
    const R = costReport(m, m + '-15', U, D, (id) => (id === firmId ? 'Наша фирма' : id === firm2 ? 'Друга фирма' : '?'));
    expect(R.total.costUsd).toBeCloseTo(0.0738, 6);
    expect(R.total.calls).toBe(4);
    const pur = R.byKind.find((k) => k.key === 'purchase')!;
    expect(pur.costUsd).toBeCloseTo(0.0168, 6);
    expect(R.byKind.find((k) => k.key === 'law')).toMatchObject({ ai: 1, reads: 1 });
    expect(R.byFirm.find((k) => k.key === '-')!.label).toMatch(/без фирма/);
    expect(R.byModel.map((x) => x.key)).toEqual([AI_MODELS.default, AI_MODELS.quick]);
    // the reads of this month from the tests above: free ones are counted, cached ones separately
    const emp = R.byKind.find((k) => k.key === 'emp');
    expect(emp?.cached).toBeGreaterThanOrEqual(1);
    expect(R.byKind.find((k) => k.key === 'bank')!.free).toBeGreaterThanOrEqual(1);
    expect(R.projection).toBeCloseTo(monthProjection(R.total.costUsd, m, m + '-15'), 6);
  });
  it('levels, projection and typical costs', () => {
    expect(budgetLevel(7.9, 10)).toBe(0);
    expect(budgetLevel(8, 10)).toBe(80);
    expect(budgetLevel(10, 10)).toBe(100);
    expect(budgetLevel(1e6, null)).toBe(0);
    expect(monthProjection(10, '2026-10', '2026-10-10')).toBe(31);
    expect(monthProjection(10, '2026-09', '2026-10-10')).toBe(10);
    // a 2-page invoice: Haiku ≈ $0.002, Sonnet ≈ $0.04
    expect(typicalDocCost(AI_MODELS.quick, 2)).toBeLessThan(0.003);
    expect(typicalDocCost(AI_MODELS.default, 2)).toBeLessThan(0.05);
  });
});

describe('owner policy: no automatic AI, free classification', () => {
  it('the law robot uses AI only on an explicit click or with the owner opt-in', async () => {
    expect(await lawRobotUsesAi(db, null)).toBe(false); // daily cron, default
    expect(await lawRobotUsesAi(db, {})).toBe(false); // dashboard first check
    expect(await lawRobotUsesAi(db, { manual: true })).toBe(false); // „▶ Провери сега“
    expect(await lawRobotUsesAi(db, { manual: true, ai: true })).toBe(true); // „🤖 Провери со AI“
    await putAiBudget(db, { autoLawAi: true });
    expect(await lawRobotUsesAi(db, null)).toBe(true);
    expect(await lawRobotUsesAi(db, { manual: true })).toBe(false);
  });
  it('the robot without AI stores the new links „⚠ да се потврди“ and makes no call', async () => {
    const api = fake([]);
    setAiClient(api);
    const SRC = [{ url: 'https://www.ujp.gov.mk/mk', inst: 'UJP', name: 'УЈП', pick: /\/pogledni\/\d+/ }];
    const page = (ids: number[]) => ids.map((i) => `<a href="/mk/pogledni/${i}">Соопштение ${i}</a>`).join('');
    await runLawRobot(db, { sources: SRC, fetcher: async () => page([1]), ai: false });
    const r = await runLawRobot(db, { sources: SRC, fetcher: async () => page([1, 2]), ai: false });
    expect(r.added).toBe(1);
    expect(api.calls).toHaveLength(0);
  });
  it('inbox classification from the text, AI only when the text does not say it', async () => {
    expect(classifyText('ИЗВОД бр. 12 по сметка 300000000012345\nПретходна состојба')).toMatchObject({ kind: 'bank' });
    expect(classifyText('ДЕКЛАРАЦИЈА ЗА ПРИЕМ\nПресметка на плата')).toMatchObject({ kind: 'payroll' });
    expect(classifyText('ДНЕВЕН ФИНАНСИСКИ ИЗВЕШТАЈ\nZ бр 15')).toMatchObject({ kind: 'fiscal' });
    expect(classifyText('ФАКТУРА бр. 1\nЕДБ MK4030999000111\nКупувач ЕДБ 4030000000001', { ownEdb: '4030000000001' })).toMatchObject({ kind: 'purchase' });
    expect(classifyText('ФАКТУРА бр. 1\nЕДБ 4030000000001\nКупувач ЕДБ 4030999000111', { ownEdb: '4030000000001' })).toMatchObject({ kind: 'sale' });
    expect(classifyText('Писмо до клиентот')).toBeNull();
    const api = fake(['{"kind":"other","what":"?"}']);
    setAiClient(api);
    const t = await doc('classify', 'izvod.txt', 'text/plain', new TextEncoder().encode('ИЗВОД бр. 7 на сметка 300000000012345'));
    await runReadDocument(db, t);
    expect(await load(t)).toMatchObject({ status: 'done', model: 'noai', result: { kind: 'bank' } });
    const s = await doc('classify', 'slika.jpg', 'image/jpeg', new Uint8Array([1]));
    await runReadDocument(db, s);
    expect(api.calls).toHaveLength(1);
    expect((await load(s)).options).toMatchObject({ aiWhy: WHY.scan });
  });
});
