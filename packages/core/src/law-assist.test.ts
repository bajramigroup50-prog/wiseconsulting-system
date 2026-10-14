import { describe, expect, it } from 'vitest';
import {
  articleParas, articleRefs, diffChanged, diffTable, gazetteRefs, guardCitations, lawAnswerShape, lawAssistPrompt, lawDiff, lawLang, lawsInText, lawTerms,
  lawOfficialUrl, lawTextDate, lawTextHash, lawTsQuery, normArtNo, parseJsonLoose, segmentArticles, treatmentTable, versionAt, type CtxArticle,
} from './law';

const TEXT = `ЗАКОН ЗА ДАНОКОТ НА ДОДАДЕНА ВРЕДНОСТ
(„Службен весник на Република Македонија“ бр. 44/1999, 86/1999 и 267/2025)

I. ОПШТИ ОДРЕДБИ
Предмет на оданочување
Член 1
Со овој закон се воведува данок на додадена вредност.

Настанување на даночна обврска
Член 14
(1) Даночната обврска настанува во моментот кога е извршен прометот.
(2) Ако надоместокот е платен пред извршување на прометот (аванс), даночната обврска настанува со наплатата на авансот.

Член 14-а
Посебни одредби за аванси.
Член 14 а
дупликат што се игнорира`;

describe('segmentation', () => {
  it('articles with headings, letters normalised, preamble dropped, duplicates ignored', () => {
    const A = segmentArticles(TEXT);
    expect(A.map((a) => [a.no, a.heading])).toEqual([['1', 'Предмет на оданочување'], ['14', 'Настанување на даночна обврска'], ['14-а', null]]);
    expect(A[1]!.body).toContain('со наплатата на авансот');
    expect(A[1]!.body).not.toContain('Член');
    expect(articleParas(A[1]!.body).map((p) => p.no)).toEqual(['1', '2']);
  });
  it('Albanian „Neni“, numbers and dates', () => {
    expect(segmentArticles('Ligji\nNeni 3\nTeksti i nenit.').map((a) => a.no)).toEqual(['3']);
    expect(normArtNo('12 - a')).toBe('12-а');
    expect(gazetteRefs(TEXT)).toEqual(['44/1999', '86/1999', '267/2025']);
    expect(lawTextDate('https://ujp.gov.mk/files/x____267____30.12.2025.pdf')).toBe('2025-12-30');
    expect(lawTextHash('a  b')).toBe(lawTextHash('a b'));
  });
});

describe('question analysis', () => {
  it('terms, tsquery, article refs and laws', () => {
    const t = lawTerms('Дали оваа фирма требаше да пресмета ДДВ на авансот?');
    expect(t).toContain('аванс');
    expect(t).toContain('пресме');
    expect(lawTsQuery(t)).toContain('аванс:*');
    expect(articleRefs('Што вели чл. 14 ст. 2 ЗДДВ, а член 12-а?')).toEqual([{ law: 'zddv', art: '14', para: '2' }, { law: null, art: '12-а', para: null }]);
    expect(lawsInText('ЗДП наспроти Закон за инспекциски надзор за роковите')).toEqual(expect.arrayContaining(['zdp', 'zin']));
    expect(lawLang('A duhet firma të llogarisë TVSH në avans?')).toBe('sq');
    expect(lawLang('Дали треба ДДВ?')).toBe('mk');
  });
});

describe('official sources', () => {
  it('only state / gazette hosts', () => {
    expect(lawOfficialUrl('https://www.ujp.gov.mk/files/a.pdf')).toBe(true);
    expect(lawOfficialUrl('https://www.slvesnik.com.mk/Issues/x.pdf')).toBe(true);
    expect(lawOfficialUrl('https://finance.gov.mk/zakon')).toBe(true);
    expect(lawOfficialUrl('https://evil.com/gov.mk')).toBe(false);
    expect(lawOfficialUrl('https://gov.mk.evil.com/')).toBe(false);
    expect(lawOfficialUrl('https://ujp.gov.mk@evil.com/')).toBe(false);
    expect(lawOfficialUrl('file:///etc/passwd')).toBe(false);
    expect(lawOfficialUrl('http://localhost:5432')).toBe(false);
  });
});

describe('versions', () => {
  it('word diff and the version applicable on a date', () => {
    const D = lawDiff('Стапката е 5 проценти.', 'Стапката е 10 проценти.');
    expect(diffChanged(D)).toBe(true);
    expect(D.filter((d) => d.t !== 'eq').map((d) => [d.t, d.s])).toEqual([['del', '5'], ['add', '10']]);
    expect(diffTable(D).rows).toEqual([['5', '10']]);
    expect(diffChanged(lawDiff('a  b', 'a b'))).toBe(false);
    const V = [{ id: 'a', asOf: '2024-01-01', effectiveFrom: null }, { id: 'b', asOf: '2025-12-30', effectiveFrom: '2026-01-01' }];
    expect(versionAt(V, '2025-06-30')!.id).toBe('a');
    expect(versionAt(V, '2026-03-01')!.id).toBe('b');
    expect(versionAt(V, '2020-01-01')).toBeNull();
  });
});

const ART: CtxArticle = { id: 'x', law: 'zddv', no: '14', heading: 'Настанување', body: segmentArticles(TEXT)[1]!.body, asOf: '2025-12-30', sourceUrl: 'https://ujp.gov.mk/x.pdf' };
const known = (law: string, art: string) => ((law === 'zddv' || law === '*') && art === '14' ? ART : null);

describe('no-invented-article guard', () => {
  it('drops unknown articles, fixes quotes, flags stray article numbers', () => {
    const raw = parseJsonLoose('```json\n' + JSON.stringify({
      short: 'Да, според чл. 14 и чл. 99.', reasoning: [
        { text: 'Обврската настанува со наплатата на авансот.', cites: [{ law: 'zddv', art: '14', para: '2', quote: 'даночната обврска настанува со наплатата на авансот' }] },
        { text: 'Измислено.', cites: [{ law: 'zddv', art: '77', quote: 'нешто' }, { law: 'zddv', art: '14', para: '1', quote: 'текст што не постои во членот' }] },
      ], exceptions: [], evidence: ['Авансна фактура'], verify: [], table: null, conclusion: 'Треба ДДВ.',
    }) + '\n```');
    const g = guardCitations(lawAnswerShape(raw, '', 'mk'), known);
    expect(g.removed).toEqual(['ЗДДВ чл. 77']);
    expect(g.fixed).toEqual(['ЗДДВ чл. 14 ст. 1']);
    expect(g.stray).toEqual(['99']);
    const c = g.answer.reasoning.flatMap((r) => r.cites);
    expect(c.map((x) => [x.art, x.para])).toEqual([['14', '2'], ['14', '1']]);
    expect(c[1]!.quote).toBe('Даночната обврска настанува во моментот кога е извршен прометот.');
    expect(g.answer.verify.join('\n')).toMatch(/треба да се провери: ЗДДВ чл\. 77/);
    expect(g.answer.verify.join('\n')).toMatch(/чл\. 99/);
  });
  it('a non-JSON reply becomes the short answer; the prompt lists only stored articles', () => {
    expect(lawAnswerShape(parseJsonLoose('само текст'), 'само текст', 'mk').short).toBe('само текст');
    const p = lawAssistPrompt({ kind: 'ask', question: 'ДДВ на аванс?', today: '2026-10-14', articles: [ART] });
    expect(p).toContain('[zddv|14] ЗДДВ чл. 14');
    expect(p).toContain('верзија 2025-12-30');
    expect(p).toContain('НИКОГАШ не измислувај');
  });
  it('free treatment table', () => {
    const T = treatmentTable({ firm: { name: 'Ф', vat: true }, period: { from: '2026-01-01', to: '2026-03-31' }, sales: { count: 2, base: 100, vat: 0, byRate: { 18: 100, 7: 5 }, advances: { count: 1, base: 50, vat: 0 } }, review: [{ law: 'zddv', art: 'чл. 51', t: 'Регистрација', s: 'bad', txt: 'промет над прагот' }] });
    expect(T.rows.map((r) => r[3])).toEqual(['⛔ отстапување', '⛔ непозната стапка 7%', '⚠ аванс без ДДВ']);
  });
});
