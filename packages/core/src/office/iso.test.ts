import { describe, expect, it } from 'vitest';
import { bcpStatus, breach72, dsrDue, isoAutoDue, isoKind, isoKindsOf, isoReview, isoStarterBcp, isoStarterDocs, isoStarterProcessing, type IsoRow } from './iso';

const row = (p: Partial<IsoRow> & Pick<IsoRow, 'id' | 'kind'>): IsoRow => ({ no: 1, year: 2026, title: p.id, status: 'open', due: null, created: '2026-01-10T08:00:00Z', closed: null, data: {}, ...p });

describe('ISO 27701 / ЗЗЛП', () => {
  it('72 hours from discovery, only for personal data the agency must hear of', () => {
    expect(breach72({ personal: 'не', found: '2026-10-01T10:00' }, '2026-10-20T00:00').state).toBe('na');
    expect(breach72({ personal: 'да', notified: 'не е потребно', found: '2026-10-01T10:00' }, '2026-10-20T00:00').state).toBe('na');
    expect(breach72({ personal: 'да', found: '2026-10-18T10:00' }, '2026-10-20T08:00')).toEqual({ state: 'open', deadline: '2026-10-21T10:00', hoursLeft: 26 });
    expect(breach72({ personal: 'да', found: '2026-10-18T10:00' }, '2026-10-21T11:00').state).toBe('overdue');
    expect(breach72({ personal: 'да', found: '2026-10-18T10:00', notifiedOn: '2026-10-21T09:59' }, '2026-10-30T00:00').state).toBe('ok');
    expect(breach72({ personal: 'да', found: '2026-10-18T10:00', notifiedOn: '2026-10-21T10:01' }, '2026-10-30T00:00').state).toBe('late');
    // no time of discovery → the day it happened, 00:00
    expect(breach72({ personal: 'да', when: '2026-10-18' }, '2026-10-18T12:00').deadline).toBe('2026-10-21T00:00');
  });
  it('a data-subject request is due one month after receipt; the registers set the deadline themselves', () => {
    expect(dsrDue('2026-01-31')).toBe('2026-02-28');
    expect(dsrDue('2026-10-20')).toBe('2026-11-20');
    expect(isoAutoDue('dsr', { received: '2026-03-15' }, '2026-03-20')).toBe('2026-04-15');
    expect(isoAutoDue('dsr', {}, '2026-03-20')).toBe('2026-04-20');
    expect(isoAutoDue('incident', { personal: 'да', found: '2026-10-18T10:00' }, '2026-10-18')).toBe('2026-10-21');
    expect(isoAutoDue('incident', { personal: 'не' }, '2026-10-18')).toBeNull();
    expect(isoAutoDue('complaint', {}, '2026-10-18')).toBeNull();
  });
});

describe('ISO 22301', () => {
  const plan = row({ id: 'p1', kind: 'bcp', title: 'Серверот не работи', data: { rto: 4, rpo: 24, lastTest: '2026-01-15', every: 6 } });
  const plan2 = row({ id: 'p2', kind: 'bcp', title: 'Отсуство', data: { rto: 24 } });
  it('last test from the plan or its tests, next after `every` months, RTO / RPO met', () => {
    const T = [row({ id: 't1', kind: 'bctest', data: { plan: 'p1', date: '2026-04-10', took: 3, lost: 12, result: 'успешно' } })];
    const [a, b] = bcpStatus([plan, plan2, ...T], '2026-10-20');
    expect(a).toMatchObject({ lastTest: '2026-04-10', next: '2026-10-10', rtoMet: true, rpoMet: true, state: 'due' });
    expect(b).toMatchObject({ lastTest: null, state: 'never' });
    const F = [row({ id: 't2', kind: 'bctest', data: { plan: 'p1', date: '2026-10-01', took: 6, lost: 2, result: 'успешно' } })];
    expect(bcpStatus([plan, ...F], '2026-10-20')[0]).toMatchObject({ rtoMet: false, state: 'failed' });
  });
  it('the review carries privacy and continuity', () => {
    const R = [
      plan,
      row({ id: 'd1', kind: 'dsr', due: '2026-02-10', status: 'done', data: { type: 'пристап до податоците', answeredOn: '2026-02-01' } }),
      row({ id: 'd2', kind: 'dsr', due: '2026-03-01', data: { type: 'бришење' } }),
      row({ id: 'i1', kind: 'incident', data: { personal: 'да', found: '2026-05-01T09:00', notifiedOn: '2026-05-02T09:00' } }),
      row({ id: 'i2', kind: 'incident', data: { personal: 'не' } }),
      row({ id: 'o1', kind: 'processing', data: { role: 'контролор' } }),
    ];
    const V = isoReview(R, 2026, '2026-10-20');
    expect(V.privacy.dsr).toMatchObject({ n: 2, answered: 1, inTime: 1, late: 1 });
    expect(V.privacy.breaches).toMatchObject({ n: 1, ok: 1, late: 0 });
    expect(V.privacy.processing.length).toBe(1);
    expect(V.continuity.plans[0]!.state).toBe('due');
  });
  it('starting texts: scenarios with RTO / RPO, processing activities with a basis, the new policies', () => {
    const S = isoStarterBcp();
    expect(S.map((s) => s.title)).toEqual(expect.arrayContaining(['Серверот / програмата не работи', 'Отсуство на вработен (болест, напуштање)']));
    expect(S.every((s) => typeof s.data.rto === 'number' && typeof s.data.rpo === 'number' && s.data.steps)).toBe(true);
    expect(isoStarterProcessing().every((p) => p.data.basis && p.data.role)).toBe(true);
    expect(isoStarterDocs('WISE').map((d) => d.title)).toEqual(expect.arrayContaining(['Постапка при повреда на безбедноста на личните податоци (72 часа)', 'План за континуитет на работењето (ISO 22301)']));
    // every starter field belongs to its register (saveIsoRecord keeps only those)
    for (const [k, L] of [['processing', isoStarterProcessing()], ['bcp', S]] as const) {
      const keys = new Set(isoKind(k)!.fields.map((f) => f.k));
      for (const s of L) expect(Object.keys(s.data).filter((x) => !keys.has(x))).toEqual([]);
    }
    expect(isoKindsOf('pims').map((d) => d.k)).toEqual(['processing', 'dsr', 'dpia']);
    expect(isoKindsOf('bcms').map((d) => d.k)).toEqual(['bcp', 'bctest']);
  });
});
