/**
 * „📑 Контроли и решенија“ — disagreement with a decision: as soon as a finding is marked disputed the program keeps
 * the external document (here a „Жалба“ against a УЈП decision) and the internal analysis as versions of the case;
 * „🧾 Подготви“, the document type, the Word export of both documents and of a version, the task list → corrective
 * actions, „💲 AI правна анализа“ queued for the worker (refused while the AI budget is paused); a client gets neither
 * document.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { versionsOf } from '@wise/core/compliance';
import { kontrolaAiState, putAiBudget, schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
const sent: { name: string; data: Record<string, unknown> }[] = [];
vi.mock('@/lib/jobs', () => ({ enqueue: async (name: string, data: Record<string, unknown>) => { sent.push({ name, data }); return 'job'; }, renderPdf: async () => 'x' }));

const A = await import('@/app/(app)/kontroli/actions');
const word = await import('@/app/(app)/kontroli/word/route');
const { docxText } = await import('@/lib/docx');

let firmId = '';
let kid = '';
const kontrola = async () => (await pg.select().from(schema.kontroli).where(eq(schema.kontroli.id, kid)))[0]!;
const findings = async () => pg.select().from(schema.kontrolaFindings).where(eq(schema.kontrolaFindings.kontrolaId, kid));
const getWord = (q: string) => word.GET(new Request(`http://localhost/kontroli/word?id=${kid}&${q}`));

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ЖАЛБА ТЕСТ ДООЕЛ', edb: '4030099999999', embs: '7123456', address: 'Ул. Тест 1', city: 'Битола', settings: { manager: 'Марко Марков' } }).returning();
  firmId = f!.id;
});
beforeEach(async () => { sent.length = 0; useFirm(firmId); await signIn('acc', { allFirms: true }); });

describe('disputed decision → жалба + internal analysis', () => {
  it('marking a finding disputed stores the documents as a version; only disputed findings are argued', async () => {
    const r = await act(A.kSave({}, form({ auth: 'ujp', doc: 'reshenie', docNo: '13-77/1', docDate: '2026-10-01', delivered: '2026-10-08', periodFrom: '2026-01-01', periodTo: '2026-03-31' })));
    kid = (r as { redirect: string }).redirect.split('=')[1]!;
    expect((await A.kFinding(kid, {}, form({ area: 'vat', text: 'Одбиен претходен ДДВ за набавки', article: 'чл. 34 ЗДДВ', claimed: '50000', interest: '1200', ours: '8000' }))).ok).toBeTruthy();
    expect((await A.kFinding(kid, {}, form({ area: 'pit', text: 'Неплатен данок на бонус', claimed: '3000' }))).ok).toBeTruthy();
    const F = await findings();
    const vat = F.find((f) => f.area === 'vat')!, pit = F.find((f) => f.area === 'pit')!;
    // the books' amount is lower than the decision → automatically „делумно“ → a version exists
    let V = versionsOf((await kontrola()).data);
    expect(V.length).toBeGreaterThan(0);
    expect(V.at(-1)).toMatchObject({ kind: 'auto', type: 'zhalba' });
    const n0 = V.length;
    // the office marks the bonus finding as accepted and the VAT one as fully disputed
    await A.kMark(kid, pit.id, 'accept');
    await A.kMark(kid, vat.id, 'object');
    V = versionsOf((await kontrola()).data);
    expect(V.length).toBe(n0 + 2); // each change of the text → one more version
    const ext = V.at(-1)!.external;
    expect(ext).toMatch(/^До: Државна комисија/);
    expect(ext).toMatch(/Подносител: ЖАЛБА ТЕСТ ДООЕЛ, ЕДБ 4030099999999, ЕМБС 7123456, Ул\. Тест 1, Битола, застапуван од управителот Марко Марков/);
    expect(ext).toMatch(/Наод под точка 1/);
    expect(ext).not.toMatch(/Наод под точка 2/);
    expect(ext).toMatch(/Наодите под точка 2 подносителот ги прифаќа/);
    expect(ext).toMatch(/42\.000,00 ден\. помалку/);
    expect(ext).toMatch(/Оспорен износ: 51\.200,00 ден\. од вкупно утврдени 54\.200,00 ден\./);
    expect(V.at(-1)!.internal).toMatch(/ВНАТРЕШНА АНАЛИЗА/);
    expect((await A.kPrepare(kid)).ok).toMatch(/веќе подготвени/);
  });

  it('the document type can be changed; Word of both documents and of a version', async () => {
    let res = await getWord('doc=draft');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/Zhalba_13-77_1\.docx/);
    let t = docxText(new Uint8Array(await res.arrayBuffer()));
    expect(t).toContain('ЖАЛБА');
    expect(t).toContain('Одбиен претходен ДДВ за набавки');
    t = docxText(new Uint8Array(await (await getWord('doc=analiza')).arrayBuffer()));
    expect(t).toContain('ВНАТРЕШНА АНАЛИЗА');
    expect(t).toMatch(/шанса за успех \d+%/);
    await A.kSubType(kid, {}, form({ subType: 'tuzhba' }));
    res = await getWord('doc=draft');
    expect(res.headers.get('content-disposition')).toMatch(/Tuzhba_/);
    const V = versionsOf((await kontrola()).data);
    expect(V.at(-1)!.type).toBe('tuzhba');
    t = docxText(new Uint8Array(await (await getWord(`doc=draft&v=${V[0]!.id}`)).arrayBuffer()));
    expect(t).toContain('ЖАЛБА');
    await A.kSubType(kid, {}, form({ subType: '' }));
    // edited text wins in the export
    await A.kDraft(kid, {}, form({ which: 'external', draft: 'ЖАЛБА\nУреден текст на канцеларијата' }));
    t = docxText(new Uint8Array(await (await getWord('doc=draft')).arrayBuffer()));
    expect(t).toContain('Уреден текст на канцеларијата');
  });

  it('the internal task list becomes corrective actions once', async () => {
    expect((await A.kAddTasks(kid)).ok).toMatch(/Додадени \d+ задачи/);
    expect((await A.kAddTasks(kid)).ok).toMatch(/веќе додадени/);
    const T = await pg.select().from(schema.kontrolaActions).where(eq(schema.kontrolaActions.kontrolaId, kid));
    expect(T.map((t) => t.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Подготви, потпиши и поднеси: Жалба/), expect.stringMatching(/^Плати го утврдениот износ за наод 2/)]));
  });

  it('„💲 AI правна анализа“ is queued for the worker; refused while the AI budget is paused', async () => {
    expect((await A.kAiStart(kid, false)).ok).toMatch(/се изработува/);
    expect(sent).toEqual([{ name: 'kontrola.ai', data: expect.objectContaining({ kid, firmId, deep: false, reqId: expect.any(String) }) }]);
    expect(kontrolaAiState(await kontrola())).toMatchObject({ status: 'queued', deep: false });
    expect((await A.kAiStart(kid, true)).error).toMatch(/веќе се изработува/);
    await pg.update(schema.kontroli).set({ data: { ...(await kontrola()).data, ai: undefined } }).where(eq(schema.kontroli.id, kid));
    await putAiBudget(pg as never, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: 'claude-sonnet-5-5', costUsd: '2.000000' });
    sent.length = 0;
    expect((await A.kAiStart(kid, false)).error).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('a client (portal) gets neither document and cannot change them', async () => {
    await pg.update(schema.kontroli).set({ clientVisible: true }).where(eq(schema.kontroli.id, kid));
    await signIn('klient', { firms: [firmId] });
    expect((await getWord('doc=draft')).status).toBe(403);
    expect((await getWord('doc=analiza')).status).toBe(403);
    expect((await A.kDraft(kid, {}, form({ which: 'external', draft: 'x' }))).error).toBeTruthy();
    expect((await A.kAiStart(kid, false)).error).toBeTruthy();
    expect((await A.kPrepare(kid)).error).toBeTruthy();
  });
});
