import { describe, expect, it } from 'vitest';
import { ZS_DEF } from './yearend/aop';
import { aopXml, gsXml, prClean, prParse, prTemplate, skrRows, spRows } from './yearend/tools';

describe('year-end tools (legacy zs_aop / zs_pr / zs_skr)', () => {
  it('rule template round-trips through the importer', () => {
    const T = prTemplate(ZS_DEF.slice(0, 5));
    const R = prParse(T);
    if ('error' in R) throw new Error(R.error);
    expect(R.map((x) => [x.r, x.aop, x.n, x.k, x.s, x.f])).toEqual(ZS_DEF.slice(0, 5).map((x) => [x.r, x.aop, x.n, x.k, +x.s === -1 ? -1 : 1, x.f]));
  });
  it('importer needs АОП and Назив; report inferred from the AOP', () => {
    expect(prParse([['x', 'y']])).toEqual({ error: 'Excel мора да има колони „АОП“ и „Назив“.' });
    expect(prParse([['АОП', 'Назив', 'Знак'], ['201', 'Приходи', '−']])).toEqual([{ r: 'bu', aop: '201', n: 'Приходи', k: '', s: -1, f: '' }]);
    expect(prClean([{ aop: '', n: '' }, { r: 'bs', aop: '001', n: 'A', s: 1 }])).toEqual([{ r: 'bs', aop: '001', n: 'A', k: '', s: 1, f: '' }]);
  });
  it('AOP XML and short income statement', () => {
    const x = aopXml(2026, { name: 'A&B', edb: '1', embs: '2' }, [{ r: 'bs', aop: '063', n: 'Актива', k: '', s: 1, f: '' }], { bs063: 10.4 }, {});
    expect(x).toContain('naziv="A&amp;B"');
    expect(x).toContain('<AOP broj="063" naziv="Актива" tekovna="10" prethodna="0"/>');
    expect(skrRows({ bu201: 100, bu204: 60, bu250: 40, bu252: 4, bu255: 36 }).map((r) => r[1])).toEqual([100, 60, 40, 4, 36]);
  });
  it('old annual-account XML (legacy gsXml)', () => {
    const x = gsXml(2026, { name: 'Ф', edb: '1', embs: '2' }, { BS: [{ c: 'A', n: 'АКТИВА', head: true }, { c: 'A1', n: 'Пари', v: 10 }], IS: [{ c: 'U1', n: 'Приходи', v: 5 }], assets: 10, liab: 10, profit: 5, tax: 0, net: 5, closed: false },
      { 1000: { d: 10, p: 0 } }, { 1000: 'Жиро' });
    expect(x).toContain('sostojba="preliminarna"');
    expect(x).toContain('<Pozicija kod="A1" aop="" naziv="Пари">10.00</Pozicija>');
    expect(x).toContain('<Konto broj="1000" naziv="Жиро" dolzi="10.00" pobaruva="0.00"/>');
  });
  it('form 35 base rows by revenue account (legacy spData)', () => {
    const D = spRows({ 7400: { s: -100 }, 7600: { s: -50 }, 4000: { s: 30 }, 7700: { s: 0 } }, { 7400: 'Приходи од продажба' }, { 7600: '68.20' }, '46.90');
    expect(D.rows.map((x) => [x.k, x.v, x.a])).toEqual([['7400', 100, '46.90'], ['7600', 50, '68.20']]);
    expect(D.tot).toBe(150);
    expect(D.byA).toEqual({ '46.90': 100, '68.20': 50 });
  });
});
