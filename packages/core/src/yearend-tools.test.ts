import { describe, expect, it } from 'vitest';
import { ZS_DEF } from './yearend/aop';
import { aopXml, prClean, prParse, prTemplate, skrRows } from './yearend/tools';

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
});
