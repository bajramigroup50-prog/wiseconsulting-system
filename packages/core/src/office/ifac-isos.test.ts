import { describe, expect, it } from 'vitest';
import {
  insMin, insNormalize, insStatus, insValidate, isosCtlNext, isosDeadlines, isosFindings, isosListHtml, isosListDue, isosQDue, isosSection, isosTitle, ISOS_DL, KPU_TRANSITION_END,
  type IsosState,
} from './ifac-isos';
import { ifacReadiness, isosKpu, staffNormalize, type ReadyInput } from './ifac-sqm';

const pol = (validFrom: string, validTo: string, amountEur = 20000, policyNo = 'П-1') => insNormalize({ insurer: 'Сава', policyNo, amountEur, validFrom, validTo });
const empty = (o: Partial<IsosState> = {}): IsosState => ({ ins: [], insFiles: 0, list: {}, q: {}, ctl: null, kpu: null, ...o });

describe('professional liability insurance (ЗВСР чл. 32)', () => {
  it('minimum per legal form, normalising and validating', () => {
    expect([insMin('co'), insMin('ovl'), insMin('smet'), insMin('x')]).toEqual([20000, 10000, 2000, 20000]);
    expect(insNormalize({ amountEur: '20.000', form: 'ovl', validFrom: '2026-01-01', validTo: 'x' })).toMatchObject({ amountEur: 20000, form: 'ovl', validTo: '' });
    expect(insValidate(insNormalize({ insurer: 'Сава', policyNo: '1', amountEur: 1, validFrom: '2026-02-01', validTo: '2026-01-01' }))).toMatch(/до/);
    expect(insValidate(pol('2026-01-01', '2026-12-31'))).toBeNull();
  });
  it('in force, expiring in 30 days, renewed, expired, under the minimum', () => {
    expect(insStatus([], '2026-10-20').state).toBe('none');
    expect(insStatus([pol('2026-01-01', '2026-12-31')], '2026-10-20')).toMatchObject({ state: 'ok', amountOk: true, days: 72 });
    expect(insStatus([pol('2026-01-01', '2026-12-31')], '2026-12-10').state).toBe('soon');
    const r = insStatus([pol('2026-01-01', '2026-12-31'), pol('2027-01-01', '2027-12-31', 20000, 'П-2')], '2026-12-10');
    expect(r).toMatchObject({ state: 'ok' }); expect(r.next?.policyNo).toBe('П-2');
    expect(insStatus([pol('2025-01-01', '2025-12-31')], '2026-10-20').state).toBe('expired');
    expect(insStatus([pol('2026-01-01', '2026-12-31', 10000)], '2026-10-20', 'co').amountOk).toBe(false);
    expect(insStatus([pol('2026-01-01', '2026-12-31', 10000)], '2026-10-20', 'ovl').amountOk).toBe(true);
  });
});

describe('the deadlines towards ИСОС', () => {
  it('31.01 list, 31.03 questionnaire, policy expiry, the КПУ transitional rule to 31.12.2026', () => {
    expect([isosListDue(2027), isosQDue(2026)]).toEqual(['2027-01-31', '2027-03-31']);
    const s = empty({ ins: [pol('2026-01-01', '2026-12-31')], list: { 2026: '2026-01-20' }, q: { 2025: '2026-03-01' }, kpu: [{ name: 'Ана', three: 100, need: 120 }] });
    const D = isosDeadlines(s, '2026-10-20');
    expect(D.map((d) => [d.title, d.due, d.done])).toEqual([
      [ISOS_DL.list(2026), '2026-01-31', true], [ISOS_DL.list(2027), '2027-01-31', false],
      [ISOS_DL.q(2025), '2026-03-31', true], [ISOS_DL.q(2026), '2027-03-31', false],
      [ISOS_DL.ins({ policyNo: 'П-1' }), '2026-12-31', false],
      [ISOS_DL.kpu, KPU_TRANSITION_END, false],
    ]);
    expect(isosDeadlines(s, '2027-01-05').some((d) => d.title === ISOS_DL.kpu)).toBe(false);
    // a renewal closes the old policy's deadline
    expect(isosDeadlines(empty({ ins: [pol('2026-01-01', '2026-12-31'), pol('2027-01-01', '2027-12-31', 20000, 'П-2')] }), '2026-10-20').find((d) => d.title === ISOS_DL.ins({ policyNo: 'П-1' }))?.done).toBe(true);
  });
  it('autopilot findings with stable keys', () => {
    const F = isosFindings(empty({ kpu: [{ name: 'Ана', three: 100, need: 120 }] }), '2026-10-20');
    expect(F.map((f) => [f.lvl, f.key])).toEqual([['bad', 'isos|ins'], ['bad', 'isos|list2026'], ['bad', 'isos|q2025'], ['warn', 'isos|kpu2026']]);
    expect(F.every((f) => f.cat === 'ИСОС' && f.go === 'ifac')).toBe(true);
    const G = isosFindings(empty({ ins: [pol('2027-01-01', '2027-12-31')], list: {}, q: { 2026: '2027-02-01' } }), '2027-01-10');
    expect(G.map((f) => [f.lvl, f.key])).toEqual([['warn', 'isos|list2027']]);
    expect(isosFindings(empty({ ins: [pol('2027-01-01', '2027-12-31')], q: {} }), '2027-04-01').map((f) => f.key)).toEqual(['isos|list2027', 'isos|q2026']);
  });
});

describe('readiness and the list', () => {
  it('the ИСОС section in the IFAC readiness, КПУ from the staff records', () => {
    const staff: ReadyInput['staff'] = [{ id: 'a', name: 'Ана', role: 'admin', d: staffNormalize({ isos: 'ovl', cpd: [{ date: '2026-03-01', topic: 'МСС', provider: 'ИСОС', hours: 40 }] }), prev: { y1: 40, y2: 30 }, ethicsAt: null, files: 0 }];
    expect(isosKpu(staff)).toEqual([{ name: 'Ана', three: 110, need: 120 }]);
    const V = ifacReadiness({ year: 2026, today: '2026-10-20', sqm: {}, staff, firms: [], isos: { ins: [pol('2026-01-01', '2026-12-31')], insFiles: 1, list: { 2026: '2026-01-20' }, q: {}, ctl: null } });
    const S = V.sections.find((s) => s.k === 'isos')!;
    expect(S.items.map((i) => i.ok)).toEqual([true, true, true, false, true, false]);
    expect(isosSection(empty(), 2027, '2027-02-01').items).toHaveLength(5);
    expect(ifacReadiness({ year: 2026, today: '2026-10-20', sqm: {}, staff: [], firms: [] }).sections.some((s) => s.k === 'isos')).toBe(false);
  });
  it('titles, the control every 5 years, the print', () => {
    expect([isosTitle('ovl', 'x'), isosTitle('smet', 'x'), isosTitle('', 'Сметководител (вработен)')]).toEqual(['Овластен сметководител', 'Сметководител', 'Сметководител (вработен)']);
    expect(isosCtlNext('2024-05-10')).toBe('2029-05-10');
    const h = isosListHtml({ office: 'WISE <д>', year: 2027, date: '2027-01-20', rows: [{ name: 'Ана', title: 'Овластен сметководител', reg: '123' }], ins: insStatus([pol('2027-01-01', '2027-12-31')], '2027-01-20') });
    expect(h).toContain('член 32 став 9'); expect(h).toContain('WISE &lt;д&gt;'); expect(h).toContain('€20.000'); expect(h).toContain('123');
  });
});
