import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { klAllowedViews, KL_SEC } from '@wise/core/office';
import { docxText, htmlDocx } from './docx';
import { lawMemoHtml, type MemoCase } from './law-memo';
import { NAV_LBL, viewAllowed } from './nav';
import { routeVerdict } from './route-guard';

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

describe('⚖ Правен асистент (AI) — access', () => {
  it('office roles see it next to „Законски промени“; client and field roles never', () => {
    expect(NAV_LBL.lawAi).toBe('⚖ Правен асистент (AI)');
    for (const r of ['admin', 'acc', 'view'] as const) expect(viewAllowed(r, 'lawAi')).toBe(true);
    expect(viewAllowed('klient', 'lawAi')).toBe(false);
    expect(viewAllowed('teren', 'lawAi')).toBe(false);
    const all = klAllowedViews({ on: Object.fromEntries(KL_SEC.map((s) => [s[0], true])) });
    expect(all).not.toContain('lawAi');
    for (const p of ['/lawAi', '/lawAi/word', '/lawMemo']) expect(routeVerdict('klient', p, all)).toBe('/klHome');
    expect(routeVerdict('teren', '/lawAi', [])).toBe('/mojzad');
  });
  it('every action checks the office permission (corpus: settings; delete: del), the memo routes the case firm', () => {
    const A = src('app/(app)/lawAi/actions.ts');
    for (const fn of ['lawCaseStart', 'lawCaseAttach', 'lawCaseDelete', 'lawTextsSyncNow', 'lawTextFromUrl', 'lawTextPaste']) expect(A).toMatch(new RegExp(`export async function ${fn}\\(`));
    expect(A).toMatch(/requireCan\('office', firm\?\.id \?\? null\)/);
    expect(A.match(/requireCan\('settings'\)/g)).toHaveLength(3);
    expect(A).toMatch(/caseFor\(id, 'del'\)/);
    expect(A).toMatch(/eq\(kontroli\.firmId, c\.firmId\)/);
    expect(src('lib/law-case.ts')).toMatch(/can\(u\.principal, 'office', r\.c\.firmId\)/);
    expect(src('app/(app)/lawAi/word/route.ts')).toMatch(/lawCaseMemo\(u,/);
    expect(src('app/(print)/lawMemo/page.tsx')).toMatch(/officePage\('lawAi'\)/);
    expect(src('app/(app)/lawAi/page.tsx')).toMatch(/officePage\('lawAi'\)/);
  });
});

describe('internal memo', () => {
  const c: MemoCase = {
    id: '11111111-2222-3333-4444-555555555555', kind: 'ask', question: 'ДДВ на аванс <b>?', periodFrom: '2026-01-01', periodTo: '2026-03-31', byName: 'Ана', model: 'claude-sonnet-5-5',
    costUsd: '0.012300', createdAt: new Date('2026-10-14T10:00:00Z'), params: {},
    result: {
      date: '2026-03-31',
      articles: [{ id: 'a', textId: 't', law: 'zddv', no: '14', heading: 'Настанување', body: '(2) … со наплатата на авансот.', asOf: '2025-12-30', sourceUrl: 'https://ujp.gov.mk/x.pdf', title: 'ЗДДВ' }],
      ai: { lang: 'mk', short: 'Да.', reasoning: [{ text: 'Обврската настанува со наплата.', cites: [{ law: 'zddv', art: '14', para: '2', quote: 'со наплатата на авансот' }] }], exceptions: [], evidence: ['Авансна фактура'], verify: ['треба да се провери: ЗДДВ чл. 88'], table: null, conclusion: 'Треба ДДВ.' },
    },
  };
  it('cites from the store with the version and source; escapes; Word export keeps the text', () => {
    const h = lawMemoHtml(c, { office: 'WISE', firm: 'Аванс ДООЕЛ' });
    expect(h).toContain('ИНТЕРНА БЕЛЕШКА');
    expect(h).toContain('<b>ЗДДВ чл. 14 ст. 2:</b> „со наплатата на авансот“');
    expect(h).toContain('ЗДДВ чл. 14 – Настанување (верзија 30.12.2025)');
    expect(h).toContain('треба да се провери: ЗДДВ чл. 88');
    expect(h).toContain('ДДВ на аванс &lt;b&gt;?');
    expect(h).toContain('Трошок: $0.0123');
    const w = docxText(htmlDocx(lawMemoHtml(c, { office: 'WISE', firm: 'Аванс ДООЕЛ', word: true })));
    expect(w).toContain('Авансна фактура');
    expect(w).toContain('Ова не е правен совет');
  });
});
