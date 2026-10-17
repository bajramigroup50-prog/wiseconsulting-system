import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LedgerLine } from '@wise/core';
import { BB_TABS, bbCardKontos, bbFilterOf, bbKontoOk, bbTab, bbView } from './bb-filter';
import { BbTable } from '../app/(app)/bilanc/table';

const l = (account: string, debit: number, credit: number, kind = 'manual'): LedgerLine => ({ account, debit, credit, kind, date: '2026-01-01' });
const lines: LedgerLine[] = [
  l('1000', 500, 0, 'open'), l('2200', 0, 500, 'open'),
  l('1020', 300, 0), l('220010', 0, 200), l('220020', 0, 100), l('2209', 50, 0), l('4000', 0, 0), l('4010', 120, 0), l('7600', 0, 170),
];
const o = { from: '2026-01-01', to: '2026-12-31', f: bbFilterOf({}) };
const keys = (tab: Parameters<typeof bbView>[1]['tab'], f = o.f, q = '') => bbView(lines, { ...o, tab, f, q }).rows.map((r) => r.k);

describe('Бруто биланс – рекапитулар: levels', () => {
  it('tabs Класи | Групи | Синтетики (3/4/5) | Аналитики | Вкупно', () => {
    expect(BB_TABS.map(([, t]) => t)).toEqual(['Класи', 'Групи', 'Синтетики (3)', 'Синтетики (4)', 'Синтетики (5)', 'Аналитики', 'Вкупно']);
    expect(bbTab('v')).toBe('v');
    expect(bbTab('x')).toBe('a');
  });
  it('grouping by the first 1 / 2 / 3 / 4 / 5 digits, analytics = full konto', () => {
    expect(keys('1')).toEqual(['1', '2', '4', '7']);
    expect(keys('2')).toEqual(['10', '22', '40', '76']);
    expect(keys('3')).toEqual(['100', '102', '220', '401', '760']);
    expect(keys('4')).toEqual(['1000', '1020', '2200', '2209', '4010', '7600']);
    expect(keys('5')).toEqual(['1000', '1020', '2200', '22001', '22002', '2209', '4010', '7600']);
    expect(keys('a')).toEqual(['1000', '1020', '2200', '220010', '220020', '2209', '4010', '7600']);
    const g = bbView(lines, { ...o, tab: '3' }).rows.find((r) => r.k === '220')!;
    expect(g).toMatchObject({ op: 500, td: 50, tp: 300, vd: 50, vp: 800, s: -750 });
  });
  it('„Вкупно“: no rows, the class totals and the grand total', () => {
    const V = bbView(lines, { ...o, tab: 'v' });
    expect(V.rows).toEqual([]);
    expect(V.classes.map((c) => [c.c, c.total.s])).toEqual([['1', 800], ['2', -750], ['4', 120], ['7', -170]]);
    expect(V.total).toMatchObject({ vd: 970, vp: 970, s: 0 });
  });
});

describe('Бруто биланс – рекапитулар: parameters', () => {
  it('Префикс, Суфикс, Од конто, До конто on the analytic konto', () => {
    const f = (sp: Record<string, string>) => bbFilterOf(sp);
    expect(bbKontoOk('220010', f({ pre: '22' }))).toBe(true);
    expect(bbKontoOk('1020', f({ pre: '22' }))).toBe(false);
    expect(bbKontoOk('220010', f({ suf: '10' }))).toBe(true);
    expect(bbKontoOk('220020', f({ suf: '10' }))).toBe(false);
    expect(bbKontoOk('2209', f({ kf: '2200', kt: '2209' }))).toBe(true);
    expect(bbKontoOk('220099', f({ kt: '2200' }))).toBe(true);
    expect(bbKontoOk('2210', f({ kt: '2209' }))).toBe(false);
    expect(bbKontoOk('1999', f({ kf: '2000' }))).toBe(false);
    expect(f({ pre: 'x2', kf: ' 12 ' })).toEqual({ pre: '', suf: '', kf: '12', kt: '' });
  });
  it('the parameters filter the kontos before grouping (a class sums only the kontos in range)', () => {
    const f = bbFilterOf({ kf: '2200', kt: '2209' });
    expect(keys('a', f)).toEqual(['2200', '220010', '220020', '2209']);
    expect(bbView(lines, { ...o, tab: '1', f }).rows).toMatchObject([{ k: '2', s: -750 }]);
    expect(keys('a', bbFilterOf({ pre: '22', suf: '20' }))).toEqual(['220020']);
    expect(keys('a', o.f, '22')).toEqual(['2200', '220010', '220020', '2209']);
    expect(bbCardKontos(lines, bbFilterOf({ pre: '22' }))).toEqual(['2200', '220010', '220020', '2209']);
    expect(bbCardKontos(lines, bbFilterOf({}))).not.toContain('4000'); // no turnover
  });
  it('screen table: rows open „Аналитика“ (data-href), „Без колона ‚Само од тековна година‘“ drops two columns', () => {
    const V = bbView(lines, { ...o, tab: 'a', f: bbFilterOf({ pre: '22' }) });
    const h = renderToStaticMarkup(<BbTable V={V} tab="a" from="2026-01-01" to="2026-12-31" noCur={false} />);
    expect(h).toContain('id="bb" class="fit knav"');
    expect(h).toContain('data-href="/akart?k=220010&amp;from=2026-01-01&amp;to=2026-12-31"');
    expect(h).toContain('Должи од тек. година');
    const n = renderToStaticMarkup(<BbTable V={V} tab="a" from="2026-01-01" to="2026-12-31" noCur />);
    expect(n).not.toContain('од тек. година');
    expect((n.match(/<th[ >]/g) ?? []).length).toBe(7);
    const v = renderToStaticMarkup(<BbTable V={bbView(lines, { ...o, tab: 'v' })} tab="v" from="2026-01-01" to="2026-12-31" noCur={false} />);
    expect(v).not.toContain('class="bbrow"');
    expect(v).toContain('data-href="/akart?k=2&amp;');
  });
});
