import { describe, expect, it } from 'vitest';
import {
  addVersion, aiPatches, chooseSubmission, docHtml, docText, findingRisk, kontrolaAiPrompt, kontrolaClientData, kontrolaInternal, kontrolaLawContext,
  kontrolaSubmission, lawRefsOf, parseKontrolaAi, submissionTypeFor, suggestTasks, VERIFY_TAG, type CaseInput, type Finding,
} from './compliance';
import { LR_RULES } from './law/lawrep';

const F: Finding[] = [
  { no: 1, area: 'vat', text: 'Неосновано одбиен претходен данок', article: 'чл. 34 ЗДДВ', claimed: 50_000_00, interest: 2_000_00, ours: 10_000_00, analysis: 'Фактурите ги исполнуваат условите од чл. 53 ЗДДВ.' },
  { no: 2, area: 'pit', text: 'Неплатен данок на бонус', claimed: 12_000_00, verdict: 'correct' },
  { no: 3, area: 'cash', text: 'Плаќање во готово над лимит', claimed: 0, fine: 500_00, verdict: 'incorrect', officeOk: true, systemError: false },
  { no: 4, area: 'books', text: 'Неевидентирана фактура', claimed: 3_000_00, verdict: 'unclear' },
];
const base: CaseInput = {
  auth: 'ujp', doc: 'reshenie', docNo: '13-123/1', docDate: '2026-10-01', delivered: '2026-10-08', periodFrom: '2026-01-01', periodTo: '2026-03-31',
  firm: { name: 'Фирма ДООЕЛ', edb: '4030000000001', embs: '7000001', address: 'ул. 1 бр. 2', city: 'Скопје', manager: 'Петар Петров' },
  office: { name: 'WISE Консалтинг', city: 'Скопје' },
  items: F.map((f) => ({ f, refs: f.no === 1 ? ['Налог бр. 12 од 31.03.2026', 'Фактура бр. 15/2026'] : [], oursSource: f.no === 1 ? 'ДДВ-04 за 2026-Q1' : null, audit: f.no === 1 ? { n: 3, users: [{ name: 'Ана', n: 3 }], first: '2026-02-01T10:00:00Z', last: '2026-03-30T10:00:00Z' } : null })),
  today: '2026-10-11',
};

describe('document type by act and stage', () => {
  it('picks the document from the act', () => {
    expect(submissionTypeFor('ujp', 'zapisnik')).toBe('zabeleski');
    expect(submissionTypeFor('ujp', 'reshenie')).toBe('zhalba');
    expect(submissionTypeFor('ujp', 'vtor')).toBe('tuzhba');
    expect(submissionTypeFor('dzlp', 'reshenie')).toBe('tuzhba'); // АЗЛП: no appeal
    expect(submissionTypeFor('dpi', 'platen')).toBe('prigovor');
    expect(submissionTypeFor('dit', 'zakl')).toBe('prigovor');
  });
  it('gives the deadline, days left and „за проверка“', () => {
    const z = chooseSubmission({ ...base, doc: 'reshenie' });
    expect(z).toMatchObject({ type: 'zhalba', deadline: '2026-10-26', daysLeft: 15, auto: true, verify: true });
    expect(z.to).toMatch(/Државна комисија/);
    const t = chooseSubmission({ ...base, doc: 'vtor' });
    expect(t.type).toBe('tuzhba');
    expect(t.to).toMatch(/Управен суд/);
    expect(t.deadline).toBe('2026-11-09'); // 30 days from 08.10 → 07.11 (Saturday) → Monday 09.11
    // the deadline from the act's „правна поука“ prevails and is not „за проверка“
    expect(chooseSubmission({ ...base, dueOverride: '2026-10-20' })).toMatchObject({ deadline: '2026-10-20', daysLeft: 9, verify: false });
    // the office picks another type
    expect(chooseSubmission({ ...base, override: 'prigovor' })).toMatchObject({ type: 'prigovor', auto: false, deadline: null, verify: true });
    expect(chooseSubmission({ ...base, delivered: null }).daysLeft).toBeNull();
  });
});

describe('external document', () => {
  const d = kontrolaSubmission(base);
  const txt = docText(d);
  it('has the formal structure', () => {
    expect(d.title).toBe('ЖАЛБА');
    for (const h of ['ПРЕДМЕТ', 'БАРАЊЕ', 'ОБРАЗЛОЖЕНИЕ', 'ПРАВЕН ОСНОВ', 'ЗАКЛУЧОК', 'ПРИЛОЗИ']) expect(txt).toContain(h);
    expect(txt).toMatch(/Подносител: Фирма ДООЕЛ, ЕДБ 4030000000001, ЕМБС 7000001, ул\. 1 бр\. 2, Скопје, застапуван од управителот Петар Петров/);
    expect(txt).toMatch(/Полномошник: WISE Консалтинг/);
    expect(txt).toMatch(/решение \(прв степен\) бр\. 13-123\/1 од 01\.10\.2026/);
    expect(txt).toMatch(/најдоцна до 26\.10\.2026/ /* 23.10 is a holiday */);
    expect(txt).toMatch(/М\.П\./);
    expect(d.verify[0]).toMatch(/ЗА ПРОВЕРКА/);
  });
  it('argues only the disputed findings; accepted are acknowledged', () => {
    expect(txt).toMatch(/Наод под точка 1/);
    expect(txt).toMatch(/Наод под точка 3/);
    expect(txt).not.toMatch(/Наод под точка 2/);
    expect(txt).not.toMatch(/Наод под точка 4/); // „нејасно“ is not argued
    expect(txt).not.toMatch(/Неплатен данок на бонус/);
    expect(txt).toMatch(/Наодите под точка 2 подносителот ги прифаќа/);
  });
  it('shows our amounts, the difference, evidence and the legal basis', () => {
    expect(txt).toMatch(/износот изнесува 10\.000,00 ден\. \(ДДВ-04 за 2026-Q1\), односно 40\.000,00 ден\. помалку/);
    expect(txt).toMatch(/Докази: Налог бр\. 12 од 31\.03\.2026; Фактура бр\. 15\/2026/);
    expect(txt).toMatch(/Оспорен износ: 40\.500,00 ден\. од вкупно утврдени 67\.500,00 ден\./);
    expect(txt).toMatch(/чл\. 34 ЗДДВ \(наведен во актот\)/);
    expect(txt).toMatch(/чл\. 53 ЗДДВ/);
    expect(txt).toMatch(/\d\. Фактура бр\. 15\/2026/); // in the attachments
  });
  it('renders HTML for print / Word', () => {
    const h = docHtml(d);
    expect(h).toContain('<h3 style="text-align:center">ЖАЛБА</h3>');
    expect(h).not.toMatch(/<script/);
  });
  it('remarks on a record ask for a change before the decision', () => {
    expect(docText(kontrolaSubmission({ ...base, doc: 'zapisnik' }))).toMatch(/ЗАБЕЛЕШКИ НА ЗАПИСНИК[\s\S]*пред да се донесе решение/);
  });
});

describe('internal analysis', () => {
  it('per finding: books vs decision, audit trail, risk, recommendation, tasks', () => {
    const t = docText(kontrolaInternal(base));
    expect(t).toMatch(/само за канцеларијата/);
    expect(t).toMatch(/разлика 40\.000,00 ден\./);
    expect(t).toMatch(/3 промени во периодот – Ана \(3\)/);
    expect(t).toMatch(/шанса за успех 60% \(висока\)/); // partial (books lower than the decision): 50 + 10
    expect(t).toMatch(/Во игра: 67\.500,00 ден\./);
    expect(t).toMatch(/ЛИСТА НА ЗАДАЧИ/);
    expect(t).toMatch(/Подготви, потпиши и поднеси: Жалба \(рок 26\.10\.2026\)/);
    expect(t).toMatch(/Плати го утврдениот износ за наод 2 \(12\.000,00 ден\.\)/);
  });
  it('risk estimate and the half fine of a payment order', () => {
    expect(findingRisk(F[1]!)).toMatchObject({ chance: 0, disputed: 0 });
    expect(findingRisk(F[2]!)).toMatchObject({ chance: 55, level: 'средна', disputed: 500_00 });
    expect(findingRisk({ ...F[2]!, officeOk: false }).chance).toBe(30);
    const T = suggestTasks({ ...base, doc: 'platen', items: [{ f: { no: 1, area: 'cash', text: 'x', claimed: 0, fine: 1_000_00, verdict: 'correct' } }] }, chooseSubmission({ ...base, doc: 'platen' }));
    expect(T[0]).toMatchObject({ text: 'Плати половина од глобата за наод 1 (500,00 ден.)', due: '2026-10-16' });
  });
});

describe('versions and the portal', () => {
  it('stores versions, skips an unchanged auto version', () => {
    const v = { id: 'a', at: '2026-10-11T10:00:00Z', kind: 'auto' as const, type: 'zhalba' as const, external: 'A', internal: 'B' };
    const a = addVersion([], v);
    expect(a.added).toBe(true);
    expect(addVersion(a.list, { ...v, id: 'b' }).added).toBe(false);
    const c = addVersion(a.list, { ...v, id: 'c', external: 'A2' });
    expect(c.list.map((x) => x.id)).toEqual(['a', 'c']);
    expect(addVersion(c.list, { ...v, id: 'd', kind: 'edit' }).added).toBe(true); // an edit is always kept
    let L = c.list;
    for (let i = 0; i < 60; i++) L = addVersion(L, { ...v, id: `x${i}`, external: String(i) }).list;
    expect(L.length).toBe(40);
  });
  it('the client never receives drafts, versions, the internal analysis or AI', () => {
    const data = { draft: 'ЖАЛБА …', internalDraft: 'ВНАТРЕШНА', versions: [{ id: 'a' }], ai: { status: 'done' }, reads: [{ id: 'r' }], subType: 'zhalba' };
    expect(kontrolaClientData(data)).toEqual({});
    // only the deadline days of the „правна поука“ stay (the portal shows the deadline)
    expect(kontrolaClientData({ ...data, remedy: { n: 8, unit: 'days' } })).toEqual({ remedy: { n: 8, unit: 'days' } });
    expect(JSON.stringify(kontrolaClientData({ ...data, remedy: { n: 8 } }))).not.toMatch(/ЖАЛБА|ВНАТРЕШНА|versions|ai/);
  });
});

describe('law references and the law store context', () => {
  it('parses citations', () => {
    expect(lawRefsOf('чл. 34 ЗДДВ')).toEqual([{ law: 'ZDDV', art: '34' }]);
    expect(lawRefsOf('Закон за општата управна постапка чл. 106–107')).toEqual([{ law: 'ZOUP', art: '106' }, { law: 'ZOUP', art: '107' }]);
    expect(lawRefsOf('ЗДП чл. 111-а')).toEqual([{ law: 'ZDP', art: '111-а' }]);
    expect(lawRefsOf('член 9 од Законот за данокот на добивка')).toEqual([{ law: 'ZDD', art: '9' }]);
    expect(lawRefsOf('чл. 5')).toEqual([{ law: null, art: '5' }]);
  });
  it('builds the context from the rules, remedies and law changes; reports missing articles', () => {
    const ctx = kontrolaLawContext({ auth: 'ujp', doc: 'reshenie', findings: F, rules: LR_RULES, changes: [
      { id: 'c1', title: 'Измени на Законот за данокот на додадена вредност', what: 'чл. 53 – услови за одбивка', date: '2026-05-01' },
      { id: 'c2', title: 'Оглас за вработување', what: null },
    ] });
    expect(ctx.snippets.some((s) => s.source === 'remedy' && /ЗОУП|општата управна постапка/.test(s.text))).toBe(true);
    expect(ctx.snippets.some((s) => s.source === 'rule' && /чл\. 35/.test(s.text))).toBe(true);
    expect(ctx.snippets.filter((s) => s.source === 'change').map((s) => s.title)).toEqual(['Измени на Законот за данокот на додадена вредност (01.05.2026)']);
    expect(ctx.missing.map((r) => `${r.law}:${r.art}`)).toEqual(['ZDDV:34']); // 53 is in the change, 34 is nowhere
  });
});

describe('AI legal analysis (parse / check)', () => {
  const ctx = kontrolaLawContext({ auth: 'ujp', doc: 'reshenie', findings: F, rules: LR_RULES, changes: [] });
  it('the prompt has the case and the store, no ЕДБ / address', () => {
    const p = kontrolaAiPrompt(base, ctx);
    expect(p).toContain('Неосновано одбиен претходен данок');
    expect(p).toContain('[L1]');
    expect(p).not.toContain('4030000000001');
    expect(p).not.toContain('ул. 1 бр. 2');
    expect(p).not.toContain('Ана');
  });
  it('tags articles that are not in the store and drops unknown findings', () => {
    const raw = 'Ево:\n' + JSON.stringify({
      findings: [
        { no: 1, inspectorRight: 'partly', assessment: 'Според чл. 35 ЗДДВ одбивката е дозволена.', support: [{ ref: 'чл. 35 ЗДДВ', why: 'услови' }], against: [{ ref: 'чл. 999 ЗДДВ', why: 'измислен' }], counter: ['Видете чл. 120 ЗДП.'], procedural: [], recommendation: 'partial', chance: 140, position: 'Фактурите се уредни (чл. 35 ЗДДВ, чл. 77 ЗДДВ).', internal: [] },
        { no: 9, assessment: 'нема таков наод' },
      ],
      procedural: ['Рокот за жалба е 15 дена (ЗОУП чл. 106).'], conclusion: 'Да се уважи.', summary: 'Добри шанси.',
    });
    const a = parseKontrolaAi(raw, ctx, [1, 2, 3, 4]);
    expect(a.findings).toHaveLength(1);
    const f = a.findings[0]!;
    expect(f.chance).toBe(100);
    expect(f.support[0]!.verified).toBe(true);
    expect(f.against[0]!.verified).toBe(false);
    expect(f.position).toBe(`Фактурите се уредни (чл. 35 ЗДДВ, чл. 77 ЗДДВ ${VERIFY_TAG}).`);
    expect(f.assessment).not.toContain(VERIFY_TAG);
    expect(f.counter[0]).toContain(VERIFY_TAG);
    expect(a.procedural[0]).not.toContain(VERIFY_TAG); // ЗОУП чл. 106 is in the remedies
    expect(a.unverified).toEqual(expect.arrayContaining(['чл. 999 ЗДДВ', 'чл. 77 ЗДДВ', 'чл. 120 ЗДП']));
    expect(a.missing).toEqual(['чл. 34 ЗДДВ', 'чл. 53 ЗДДВ']); // no law changes in this store
    // the improved texts flow into both documents
    const P = aiPatches(a);
    const ext = docText(kontrolaSubmission(base, P.external));
    expect(ext).toContain('Наш став: наодот е делумно основан – Фактурите се уредни');
    expect(ext).toMatch(/ПРОЦЕСНИ НАВОДИ\nРокот за жалба/);
    expect(ext).toContain('Да се уважи.');
    const int = docText(kontrolaInternal(base, P.internal));
    expect(int).toContain('AI: Против нас: чл. 999 ЗДДВ [треба да се провери]');
    expect(int).toMatch(/Членови што треба да се проверат/);
  });
  it('rejects an answer without JSON', () => {
    expect(() => parseKontrolaAi('не знам', ctx, [1])).toThrow(/JSON/);
  });
});
