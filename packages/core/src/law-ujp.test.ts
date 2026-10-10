import { describe, expect, it } from 'vitest';
import { lrCheck, lrCtx, type LrInput } from './law/lawrep';
import { UJP_AREAS, ujpAreaChanges, ujpAreaFindings, ujpAreaRules, ujpTotalChecks } from './law/ujp';
import type { InspRow } from './office/inspection';

const area = (k: string) => UJP_AREAS.find((a) => a.k === k)!;

describe('Закони на УЈП (legacy UJP_AREAS / ujpAreaRules)', () => {
  it('12 areas in legacy order, links to ujp.gov.mk', () => {
    expect(UJP_AREAS.map((a) => a.k)).toEqual(['ddv', 'dd', 'pd', 'pri', 'fis', 'zdp', 'don', 'reg', 'kasa', 'loan', 'mgdd', 'drugo']);
    expect(area('zdp').url).toBe('https://www.ujp.gov.mk/mk/regulativa/opis/97');
  });
  it('rules per area: by law and by rule id; inspection checks by id', () => {
    const d = ujpAreaRules(area('ddv'));
    expect(d.R.map((r) => r.id)).toEqual(['v_reg', 'v_mon', 'v_repr', 'v_hot', 'v_car']);
    expect(d.I.map((i) => i.id)).toEqual(expect.arrayContaining(['u_ddv']));
    expect(ujpAreaRules(area('reg')).R.map((r) => r.id)).toEqual(['v_reg', 'v_mon']);
    expect(ujpAreaRules(area('zdp')).R.map((r) => r.id)).toEqual(['v_late']);
    expect(ujpAreaRules(area('mgdd'))).toEqual({ R: [], I: [] });
    expect(ujpTotalChecks()).toBeGreaterThan(20);
  });
  it('latest changes by keyword, at most 3', () => {
    const L = ['ДДВ на горива', 'Минимална плата', 'ДДВ-04 рок', 'Измени ЗДДВ', 'е-Фактура'].map((title, i) => ({ inst: 'UJP', title, at: String(i) }));
    expect(ujpAreaChanges(area('ddv'), L).map((x) => x.title)).toEqual(['ДДВ на горива', 'ДДВ-04 рок', 'Измени ЗДДВ']);
    expect(ujpAreaChanges(area('pri'), L).map((x) => x.title)).toEqual(['Минимална плата']);
    expect(ujpAreaChanges(area('drugo'), L).map((x) => x.title)).toEqual(['е-Фактура']);
  });
  it('firm findings per area (todo inspection checks count as warnings)', () => {
    const input: LrInput = {
      firm: { name: 'x', vat: true, per: 'quarter', nkd: [], kasaMax: 0 }, year: '2026', today: '2026-10-10', lines: [], prevRev74: 30000000,
      accName: {}, partners: {}, purchases: [], assets: [], vatMissing: [], employees: 1, popisLoss: 0, cashWithdrawals: 0, cashAccounts: ['1020'], profit: null,
    };
    const X = lrCheck(lrCtx(input));
    const Y = [{ it: { id: 'u_ddv' }, s: 'todo' }, { it: { id: 'u_z' }, s: 'bad' }] as unknown as InspRow[];
    expect(ujpAreaFindings(area('ddv'), X, Y)).toEqual({ bad: 1, warn: 1 });
    expect(ujpAreaFindings(area('fis'), X, Y)).toEqual({ bad: 1, warn: 0 });
  });
});
