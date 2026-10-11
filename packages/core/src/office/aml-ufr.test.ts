import { describe, expect, it } from 'vitest';
import {
  amlAddWorkDays, amlCanPurge, amlCddChecklist, amlCents, amlCountryRisky, amlDeadline, amlDueState, amlRetainUntil, amlRiskFull, amlScan,
  amlSelfLevel, amlTasks, amlThresholdCents, amlWorkDay, type AmlCdd, type AmlMoneyLine,
} from './aml-ufr';

const R = 61.5; // EUR rate → 15.000 € = 922.500,00 ден.
const ln = (key: string, date: string, account: string, debit: number, credit: number, partnerId: string | null = 'p1', o: Partial<AmlMoneyLine> = {}): AmlMoneyLine =>
  ({ key, date, account, debit, credit, partnerId, partnerName: partnerId ? `Партнер ${partnerId}` : '', ...o });

describe('thresholds in integer cents', () => {
  it('15.000 € at the given rate', () => {
    expect(amlThresholdCents(R)).toBe(92250000);
    expect(amlCents('922500.00')).toBe(92250000);
    expect(amlCents(0.1 + 0.2)).toBe(30);
  });
});

describe('monitoring: single cash transaction ≥ 15.000 €', () => {
  it('exactly at the threshold is reported, one cent below is not', () => {
    const A = amlScan([ln('j1:1', '2026-03-01', '102', 922500, 0), ln('j2:1', '2026-03-02', '102', 0, 922499.99, 'p2')], { eurRate: R });
    expect(A.map((a) => [a.rule, a.key, a.dir])).toEqual([['cash', 'cash:j1:1', 'in']]);
  });
  it('foreign-currency cash (105) counts, bank accounts (100) do not', () => {
    const A = amlScan([ln('a', '2026-03-01', '105', 0, 1e6), ln('b', '2026-03-01', '100', 2e6, 0)], { eurRate: R });
    expect(A.map((a) => a.key)).toEqual(['cash:a']);
    expect(A[0]!.dir).toBe('out');
  });
});

describe('monitoring: linked cash transactions (чл. 2 т.14 — one working day) and the split pattern', () => {
  it('same partner and direction on the same / next working day are linked (Fri → Mon included)', () => {
    const A = amlScan([ln('a', '2026-03-02', '102', 500000, 0), ln('b', '2026-03-03', '102', 500000, 0)], { eurRate: R });
    expect(A.map((a) => [a.rule, a.key, a.amount, a.refs])).toEqual([['cashLinked', 'linked:a', 1000000, ['a', 'b']]]);
    const W = amlScan([ln('a', '2026-03-06', '102', 0, 500000), ln('b', '2026-03-09', '102', 0, 500000)], { eurRate: R });
    expect(W.map((a) => [a.rule, a.dir])).toEqual([['cashLinked', 'out']]);
  });
  it('two working days apart is not the statutory link but the split pattern of the office window', () => {
    const A = amlScan([ln('a', '2026-03-02', '102', 500000, 0), ln('b', '2026-03-04', '102', 500000, 0)], { eurRate: R });
    expect(A.map((a) => [a.rule, a.key])).toEqual([['cashSplit', 'split:a']]);
    const L = [ln('a', '2026-01-05', '102', 300000, 0), ln('b', '2026-01-12', '102', 300000, 0), ln('c', '2026-01-20', '102', 322500, 0)];
    expect(amlScan(L, { eurRate: R, linkDays: 30 }).map((a) => [a.rule, a.amount])).toEqual([['cashSplit', 922500]]);
    expect(amlScan(L, { eurRate: R, linkDays: 10 })).toEqual([]);
  });
  it('other partners, other directions, lines without a counter-party and bank transfers are never linked', () => {
    const L = [ln('a', '2026-03-02', '102', 500000, 0), ln('c', '2026-03-02', '102', 0, 500000), ln('d', '2026-03-02', '102', 500000, 0, 'p2'),
      ln('e', '2026-03-02', '102', 500000, 0, null), ln('f', '2026-03-02', '102', 500000, 0, null), ln('g', '2026-03-02', '102', 0, 2e6, null, { transfer: true })];
    expect(amlScan(L, { eurRate: R })).toEqual([]);
  });
  it('alert keys are stable (re-scan in any order gives the same keys)', () => {
    const M = [ln('a', '2026-03-02', '102', 500000, 0), ln('b', '2026-03-02', '102', 500000, 0), ln('c', '2026-03-03', '102', 500000, 0), ln('d', '2026-03-03', '102', 500000, 0)];
    const k1 = amlScan(M, { eurRate: R }).map((a) => a.key);
    expect(k1).toEqual(['linked:a', 'linked:c']);
    expect(amlScan([...M].reverse(), { eurRate: R }).map((a) => a.key)).toEqual(k1);
  });
});

describe('monitoring: high-risk countries', () => {
  it('matches ISO codes and names, never MK', () => {
    expect(amlCountryRisky('IR', ['IR', 'KP'])).toBe(true);
    expect(amlCountryRisky('Иран', ['Иран'])).toBe(true);
    expect(amlCountryRisky('MK', ['MK'])).toBe(false);
    expect(amlCountryRisky('Ирска', ['IR'])).toBe(false);
    const A = amlScan([ln('x', '2026-05-05', '103', 0, 1000, 'p9', { country: 'IR' })], { eurRate: R, hrc: ['IR'] });
    expect(A.map((a) => a.rule)).toEqual(['hrc']);
  });
});

describe('deadlines in working days (Macedonian holidays)', () => {
  it('skips weekends and holidays', () => {
    expect(amlWorkDay('2026-10-10')).toBe(false); // Saturday
    expect(amlWorkDay('2026-10-12')).toBe(false); // 11.10 on Sunday → Monday off
    expect(amlWorkDay('2026-10-13')).toBe(true);
    expect(amlWorkDay('2026-10-23')).toBe(false); // holiday (Friday)
    expect(amlAddWorkDays('2026-10-22', 1)).toBe('2026-10-26');
    expect(amlAddWorkDays('2026-12-31', 1)).toBe('2027-01-04'); // 01.01 + weekend
  });
  it('STR 24 hours, CTR 3 working days, internal decision / ЦРСМ discrepancy next working day', () => {
    expect(amlDeadline('str', '2026-10-09')).toBe('2026-10-10'); // 24 hours, calendar
    expect(amlDeadline('int', '2026-10-09')).toBe('2026-10-13'); // next working day (Mon 12.10 is off)
    expect(amlDeadline('bo', '2026-10-21')).toBe('2026-10-22');
    expect(amlDeadline('ctr', '2026-10-21')).toBe('2026-10-27'); // Wed + 3 wd, 23.10 is a holiday
    expect(amlDueState('2026-10-01', '2026-10-02', false)).toBe('late');
    expect(amlDueState('2026-10-01', '2026-10-02', true)).toBe('done');
    expect(amlDueState('2026-10-03', '2026-10-02', false)).toBe('soon');
  });
});

describe('retention lock (10 years)', () => {
  it('nothing can be deleted while the relationship lasts or before 10 years have passed', () => {
    expect(amlRetainUntil('2016-05-31')).toBe('2026-05-31');
    expect(amlCanPurge(null, '2040-01-01')).toBe(false);
    expect(amlCanPurge('2016-10-11', '2026-10-11')).toBe(false);
    expect(amlCanPurge('2016-10-10', '2026-10-11')).toBe(true);
    expect(amlCanPurge('2020-01-01', '2026-10-11')).toBe(false);
  });
});

describe('extended risk & CDD checklist', () => {
  const base: AmlCdd = { bo: [{ name: 'А', ver: '2026-01-01' }], rep: { name: 'Б', idNo: '1', ver: true }, crDate: '2026-09-01', purpose: 'книговодство', source: 'промет', pepAsked: true,
    crsm: { date: '2026-09-01', result: 'match' }, sanc: { date: '2026-09-01', result: 'none' }, lastReview: '2026-09-01' };
  it('a complete low-risk file has no open checks', () => {
    const r = amlRiskFull(base, null, { eurRate: R, today: '2026-10-11' });
    expect(r.level).toBe('low');
    expect(amlCddChecklist(base, null, r.level, '2026-10-11').filter(([, , ok]) => !ok)).toEqual([]);
  });
  it('a sanctions hit or a refused CDD forces high risk and EDD checks', () => {
    const r = amlRiskFull({ ...base, sanc: { date: '2026-09-01', result: 'hit' } }, null, { eurRate: R, today: '2026-10-11' });
    expect(r.level).toBe('high');
    expect(r.enhanced).toBe(true);
    const miss = amlCddChecklist({ ...base, sanc: { date: '2026-09-01', result: 'hit' } }, null, r.level, '2026-10-11').filter(([, , ok]) => !ok).map(([k]) => k);
    expect(miss).toEqual(['sancHit', 'wealth', 'mgr']);
    expect(amlRiskFull({ ...base, refused: { date: '2026-10-01' } }, null, { eurRate: R, today: '2026-10-11' }).level).toBe('high');
  });
  it('a ЦРСМ mismatch must be reported; sanctions screening older than 12 months is stale', () => {
    const A: AmlCdd = { ...base, crsm: { date: '2026-09-01', result: 'mismatch' }, sanc: { date: '2025-09-01', result: 'none' } };
    const miss = amlCddChecklist(A, null, 'mid', '2026-10-11').filter(([, , ok]) => !ok).map(([k]) => k);
    expect(miss).toEqual(['crsmDisc', 'sanc']);
  });
  it('a PEP needs management approval', () => {
    const A: AmlCdd = { ...base, pep: true, wealth: 'плата', mgrOk: '2026-10-01' };
    const r = amlRiskFull(A, null, { eurRate: R, today: '2026-10-11' });
    expect(r.level).toBe('high');
    expect(amlCddChecklist(A, null, r.level, '2026-10-11').every(([, , ok]) => ok)).toBe(true);
  });
});

describe('office self-assessment and the task list', () => {
  it('self-assessment level', () => {
    expect(amlSelfLevel({ scores: {} }).level).toBe('high');
    expect(amlSelfLevel({ scores: { cl: 1, clCash: 1, geo: 1, svc: 1, ch: 1, int: 1 } }).level).toBe('low');
    expect(amlSelfLevel({ scores: { cl: 2, clCash: 2, geo: 1, svc: 2, ch: 2, int: 2 } }).level).toBe('mid');
    expect(amlSelfLevel({ scores: { cl: 3, clCash: 2, geo: 1, svc: 2, ch: 2, int: 2 } }).level).toBe('high');
  });
  it('lists office gaps, clients without CDD, overdue reviews and open reports (STR first)', () => {
    const T = amlTasks({
      today: '2026-10-11',
      office: { officer: 'X', ufrNotified: '2026-01-10', prog: '2026-01-10', self: { date: '2026-01-10', scores: {} }, tr: [{ date: '2026-02-01', topic: 'a' }, { date: '2026-06-01', topic: 'b' }], ctl: '2026-03-01' },
      clients: [{ id: 'f1', name: 'Алфа', rec: null }, { id: 'f2', name: 'Бета', rec: { data: { relEnd: '2026-01-01' }, level: 'high', nextReview: '2026-01-01' } }],
      reports: [
        { id: 'r1', firmId: 'f1', firmName: 'Алфа', status: 'нова', data: { kind: 'str', due: '2026-10-12' }, createdAt: '2026-10-11' },
        { id: 'r2', firmId: 'f1', firmName: 'Алфа', status: 'нова', data: { kind: 'alert', due: '2026-10-14' }, createdAt: '2026-10-11' },
        { id: 'r3', firmId: 'f1', firmName: 'Алфа', status: 'затворено', data: { kind: 'alert' }, createdAt: '2026-10-11' },
        { id: 'r4', firmId: 'f1', firmName: 'Алфа', status: 'пријавено во УФР', data: { kind: 'str', submitted: '2026-10-11' }, createdAt: '2026-10-11' },
      ],
    });
    expect(T.map((t) => [t.firm, t.tab, t.sev])).toEqual([['Алфа', 'rep', 'bad'], ['Алфа', 'cl', 'bad'], ['Алфа', 'mon', 'warn']]);
  });
});
