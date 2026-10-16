/**
 * „🤖 Подготви приговор со AI“ and „📦 Пакет за приговор“ in the worker: the AI context carries the stored article
 * texts in the version valid on the date, an article outside the context is tagged, a procedural law without a text is
 * named, the one-click chain (read → marks → AI → draft version with attachments), the budget pause, and the package
 * PDFs (submission + prints of the attachments).
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { versionsOf } from '@wise/core/compliance';
import {
  kontrolaPkgState, kontrolaPrepState, putAiBudget, queueKontrolaAi, queueKontrolaPkg, queueKontrolaPrep, saveKontrola, saveKontrolaFinding, schema, storeLawText, type Tx,
} from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { runKontrolaAi } from './kontrola-ai';
import { runKontrolaPkg } from './kontrola-pkg';
import { runKontrolaPrep } from './kontrola-prep';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', userId = '';

function fake(texts: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: texts.shift() ?? '{}', citations: null }], usage: { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const ANSWER = JSON.stringify({
  findings: [{ no: 1, inspectorRight: 'no', assessment: 'Одбивката е дозволена.', support: [{ ref: 'чл. 34 ЗДДВ', why: 'условите се исполнети' }], against: [], counter: [], procedural: [], recommendation: 'object', chance: 70,
    position: 'Според чл. 34 ст. 1 ЗДДВ одбивката е дозволена; фактурите се во Прилог 2. Исто и чл. 999 ЗДДВ.', internal: [] }],
  basis: [
    { ref: 'чл. 34 ст. 1 ЗДДВ', quote: 'Даночниот обврзник има право да го одбие претходниот данок', why: 'фактурите се уредни' },
    { ref: 'чл. 999 ЗДДВ', quote: 'измислен текст', why: '—' },
  ],
  procedural: ['Жалбата е навремена.'], conclusion: 'Жалбата да се уважи.', summary: 'Добра основа.',
});
const tx = <T>(f: (t: Tx) => Promise<T>) => pg.transaction((t) => f(t as unknown as Tx));
const kase = async (kid: string) => (await pg.select().from(schema.kontroli).where(eq(schema.kontroli.id, kid)))[0]!;
const newCase = async () => {
  const kid = await tx((t) => saveKontrola(t, firmId, { auth: 'ujp', doc: 'reshenie', docNo: '13-5', docDate: '2026-10-01', delivered: '2026-10-08', periodFrom: '2026-01-01', periodTo: '2026-03-31' }, userId));
  return kid;
};

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Тајна Фирма ДООЕЛ', edb: '4030000000777', address: 'Скриена 9', city: 'Скопје' }).returning();
  firmId = f!.id;
  const [u] = await pg.insert(schema.users).values({ username: 'own', name: 'Вработен Тестовски', passwordHash: 'x', role: 'admin' }).returning();
  userId = u!.id;
  // two versions of ЗДДВ: the audited period (Q1 2026) falls under the first one
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ (пречистен 2025)', effectiveFrom: '2025-01-01', source: 'manual',
    text: 'Право на одбивка\nЧлен 34\n(1) Даночниот обврзник има право да го одбие претходниот данок – СТАРА ВЕРЗИЈА А.\n(2) Втор став.\n\nЧлен 35\nДруго.' });
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ (пречистен 2026)', effectiveFrom: '2026-07-01', source: 'manual',
    text: 'Право на одбивка\nЧлен 34\n(1) Даночниот обврзник има право да го одбие претходниот данок – НОВА ВЕРЗИЈА Б.\n\nЧлен 35\nДруго.' });
  // the tax procedure is stored; ЗОУП (the appeal) is not
  await storeLawText(db, { law: 'zdp', title: 'ЗДП', effectiveFrom: '2020-01-01', source: 'manual', text: 'Жалба\nЧлен 111\n(1) Против решението може да се изјави жалба во рок од 15 дена.' });
}, 60_000);
beforeEach(async () => {
  await pg.delete(schema.aiUsage);
  await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'aiBudget'));
});
afterEach(() => setAiClient(null));

describe('kontrola.ai — full law texts in the context', () => {
  it('quotes the stored article in the version valid on the audited period; an article outside the context is tagged; ЗОУП missing is named', async () => {
    const kid = await newCase();
    await tx((t) => saveKontrolaFinding(t, firmId, kid, { area: 'vat', text: 'Одбиен претходен ДДВ', article: 'чл. 34 ст. 1 ЗДДВ', claimed: '50000', recommendation: 'object' }, userId));
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaAi(t, firmId, kid, false, userId));
    const vid = await runKontrolaAi(db, { kid, firmId, reqId, userId });
    expect(vid).toBeTruthy();
    const prompt = JSON.stringify(api.calls[0]!.messages[0]!.content);
    expect(prompt).toContain('СТАРА ВЕРЗИЈА А');
    expect(prompt).not.toContain('НОВА ВЕРЗИЈА Б');
    expect(prompt).toContain('чл. 34 ст. 1 ЗДДВ – Право на одбивка (верзија во сила од 01.01.2025)');
    expect(prompt).toContain('жалба во рок од 15 дена'); // procedural article of the remedy (ЗДП)
    expect(prompt).toMatch(/text of ЗОУП is NOT in the store/);
    // no firm identity, no staff names
    expect(prompt).not.toContain('Тајна Фирма');
    expect(prompt).not.toContain('4030000000777');
    expect(prompt).not.toContain('Скриена 9');
    expect(prompt).not.toContain('Вработен Тестовски');
    const v = versionsOf((await kase(kid)).data).find((x) => x.id === vid)!;
    const b = v.ai!.basis!;
    expect(b[0]).toMatchObject({ ref: 'чл. 34 ст. 1 ЗДДВ', verified: true, quoteOk: true, version: '01.01.2025' });
    expect(b[1]).toMatchObject({ ref: 'чл. 999 ЗДДВ', verified: false });
    expect(v.ai!.unverified).toContain('чл. 999 ЗДДВ');
    expect(v.ai!.procMissing).toEqual(['ЗОУП']);
    expect(v.external).toMatch(/ПРАВЕН ОСНОВ\nчл\. 34 ст\. 1 ЗДДВ \(верзија во сила од 01\.01\.2025\): „Даночниот обврзник/);
    expect(v.external).toContain('чл. 999 ЗДДВ [треба да се провери]');
    expect(v.internal).toMatch(/ЗОУП .*Корпус/);
  });
});

describe('kontrola.prepare — one click', () => {
  it('reads the act, proposes the marks, runs the AI with the law texts and stores a draft version with model and cost', async () => {
    const kid = await newCase();
    const [file] = await pg.insert(schema.files).values({ firmId, bucketKey: `k/${kid}.pdf`, name: 'reshenie.pdf', mime: 'application/pdf', size: 3, sha256: 'x', status: 'ready' }).returning();
    await pg.insert(schema.fileLinks).values({ fileId: file!.id, entityType: schema.KONTROLA_FILE_ENTITY, entityId: kid });
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaPrep(t, firmId, kid, false, userId));
    const read = async (d: Tx, docId: string) => {
      await d.update(schema.aiDocuments).set({ status: 'done', model: 'test', result: { findings: [{ area: 'vat', text: 'Одбиен претходен ДДВ', article: 'чл. 34 ЗДДВ', claimed: '50000' }] } }).where(eq(schema.aiDocuments.id, docId));
    };
    const vid = await runKontrolaPrep(db, { kid, firmId, reqId, userId }, { read });
    expect(vid).toBeTruthy();
    const k = await kase(kid);
    const p = kontrolaPrepState(k)!;
    expect(p).toMatchObject({ status: 'done', versionId: vid, model: expect.any(String) });
    expect(p.costUsd).toBeGreaterThan(0);
    expect(p.marks).toEqual([expect.objectContaining({ no: 1, rec: 'object' })]); // no facts → proposed „оспори“
    const [f] = await pg.select().from(schema.kontrolaFindings).where(eq(schema.kontrolaFindings.kontrolaId, kid));
    expect(f!.recommendation).toBe('object');
    const v = versionsOf(k.data).find((x) => x.id === vid)!;
    expect(v).toMatchObject({ kind: 'ai', state: 'new' }); // a draft: nothing applied
    expect(v.external).toMatch(/ПРИЛОЗИ\nПрилог 1: Копија од актот што се оспорува/);
    expect((k.data as { draft?: string }).draft).toBeUndefined();
    expect(JSON.stringify(api.calls[0]!.messages[0]!.content)).toContain('СТАРА ВЕРЗИЈА А');
  });

  it('the AI budget pause stops the AI step (no call) and the case shows the error', async () => {
    const kid = await newCase();
    await tx((t) => saveKontrolaFinding(t, firmId, kid, { area: 'vat', text: 'Наод', claimed: '1000', recommendation: 'object' }, userId));
    await putAiBudget(db, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: 'claude-sonnet-5-5', costUsd: '2.000000' });
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaPrep(t, firmId, kid, false, userId));
    expect(await runKontrolaPrep(db, { kid, firmId, reqId, userId })).toBeNull();
    expect(api.calls).toHaveLength(0);
    expect(kontrolaPrepState(await kase(kid))).toMatchObject({ status: 'error' });
  });
});

describe('kontrola.pkg — the PDFs of the package', () => {
  it('renders the submission and every print attachment (VAT books, outgoing invoices)', async () => {
    const kid = await newCase();
    await tx((t) => saveKontrolaFinding(t, firmId, kid, { area: 'vat', text: 'Одбиен ДДВ', claimed: '50000', ours: '1000', recommendation: 'object' }, userId));
    await pg.insert(schema.invoices).values({ firmId, kind: 'invoice', number: '7/2026', date: '2026-02-10', status: 'posted', base: '1000', vat: '180', total: '1180' });
    const reqId = await tx((t) => queueKontrolaPkg(t, firmId, kid, userId));
    const html: string[] = [];
    const store = { put: async () => {} };
    expect(await runKontrolaPkg(db, { kid, firmId, reqId, userId }, { render: async (p) => { html.push(p.html); return new Uint8Array([37, 80, 68, 70]); }, store })).toBe(true);
    const p = kontrolaPkgState(await kase(kid))!;
    expect(p).toMatchObject({ status: 'done', doc: expect.any(String), hash: expect.any(String), type: 'zhalba' });
    const keys = Object.keys(p.rendered ?? {});
    expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(/^vatBook:in:/), expect.stringMatching(/^vatBook:out:/), expect.stringMatching(/^invoice:/)]));
    expect(html.some((h) => h.includes('ЖАЛБА'))).toBe(true);
    expect(html.some((h) => h.includes('Книга на излезни фактури (ДДВ)') && h.includes('7/2026'))).toBe(true);
  });
});
