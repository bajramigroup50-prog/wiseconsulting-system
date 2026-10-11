import { describe, expect, it } from 'vitest';
import {
  empCalc, hrAddMonthsEnd, hrCtDefaults, hrCtWarnings, hrDiLastDay, hrDiWarnings, hrDocCode, hrDocCodeNorm, hrDocLabel, hrExtWarnings, hrNextNo,
  makePayLine, payCopyPrev, payDraft, payEmpFor, payIOHours, payLeaveStats, payNotesOpen, payrollPaymentOrders, psifCodes, removePayLine,
  resolvePayParams, upsertPayLine, PAY_HOLIDAY, PAY_REGULAR, type PayEmp,
} from './index';

const P = resolvePayParams({ hours: 168 }, '2026-04');
const reg = (e: PayEmp) => e.lines!.find((l) => l.type === PAY_REGULAR)!.hours;

describe('payroll line editing (FIX #14)', () => {
  it('always sets a category and attaches PSIF payer/MPIN codes', () => {
    const l = makePayLine({ type: 'Боледување до 30 дена – болест', hours: 16, pct: 70, code: '201' }, psifCodes());
    expect(l).toMatchObject({ cat: 'bol', code: '201', payer: 'Работодавач', mpin: '125' });
    expect(makePayLine({ type: 'Прекувремена работа', hours: 4, pct: 135 }).cat).toBe('dop');
    expect(makePayLine({ type: 'Синдикална членарина', amt: 300, hours: 5, pct: 100 })).toMatchObject({ cat: 'sin', hours: 0, pct: 0 });
    expect(() => makePayLine({ type: 'x' })).toThrow(/часови или износ/);
  });

  it('absences reduce regular hours from the personal fund (part-time hNorm)', () => {
    const e: PayEmp = { empId: '1', name: 'A', netBase: 30000, hNorm: 88, lines: [{ type: PAY_REGULAR, hours: 88, pct: 100, cat: 'reg' }] };
    upsertPayLine(e, makePayLine({ type: 'Годишен одмор', hours: 16 }), null, P);
    expect(reg(e)).toBe(72);
    // legacy payLineRm used params.hours (168) → regular would jump to 168
    removePayLine(e, 1, P);
    expect(reg(e)).toBe(88);
  });

  it('deleting overtime or an amount does not refill regular hours', () => {
    const e: PayEmp = { empId: '1', name: 'A', netBase: 30000, lines: [{ type: PAY_REGULAR, hours: 100, pct: 100, cat: 'reg' }] };
    upsertPayLine(e, makePayLine({ type: 'Прекувремена работа', hours: 10, pct: 135 }), null, P);
    upsertPayLine(e, makePayLine({ type: 'Награда / бонус', amt: 1000 }), null, P);
    expect(reg(e)).toBe(100);
    removePayLine(e, 1, P);
    removePayLine(e, 1, P);
    expect(reg(e)).toBe(100);
    expect(e.lines).toHaveLength(1);
  });

  it('payEmpFor matches the draft for a part-time employee', () => {
    const E = { id: 'e1', no: '1', name: 'Б', netBase: 25000, hNorm: 84, start: '2020-04-15' };
    const d = payDraft('2026-05', [E]);
    const x = payEmpFor('2026-05', E, d.params);
    expect(x.lines!.map((l) => [l.type, l.hours])).toEqual(d.emps[0]!.lines!.map((l) => [l.type, l.hours]));
    expect(x.lines!.every((l) => l.cat === 'reg')).toBe(true);
    expect(x.hNorm).toBe(84);
    expect(x.stazY).toBe(6);
  });

  it('joining mid-month limits regular + holiday hours', () => {
    const e: PayEmp & { inout?: string; ioDate?: string } = { empId: '1', name: 'A', lines: payDraft('2026-05', [{ id: '1', name: 'A' }]).emps[0]!.lines, inout: 'in', ioDate: '2026-05-18' };
    payIOHours('2026-05', e);
    expect(e.lines!.find((l) => l.type === PAY_REGULAR)!.hours).toBe(72); // 18–29 May: 10 weekdays, Monday 25th is the holiday (24 May falls on Sunday)
    expect(e.lines!.find((l) => l.type === PAY_HOLIDAY)!.hours).toBe(8);
  });

  it('leave statistics from payroll lines plus registry days', () => {
    const runs = [{ emps: [{ empId: 'x', lines: [{ type: 'Годишен одмор', hours: 40 }, { type: 'Боледување до 30 дена', hours: 16 }] }] }];
    expect(payLeaveStats('x', runs, 21, { leave: 2 })).toEqual({ right: 21, used: 7, rest: 14, sick: 2 });
    expect(payLeaveStats('y', runs, null)).toEqual({ right: 20, used: 0, rest: 20, sick: 0 });
  });
});

describe('HR helpers', () => {
  it('contract end dates and numbering (FIX #16)', () => {
    expect(hrAddMonthsEnd('2026-01-31', 1)).toBe('2026-02-27');
    expect(hrAddMonthsEnd('2026-03-01', 12)).toBe('2027-02-28');
    expect(hrNextNo([{ no: '03-4/2026', date: '2026-02-01' }, { no: '03-9/2025', date: '2025-12-01' }], '2026-05-01', '03-')).toBe('03-5/2026');
    expect(hrNextNo([], '2027-01-03')).toBe('1/2027');
  });

  it('contract defaults and warnings', () => {
    const c = hrCtDefaults({ name: 'А', netBase: 22567, coef: 0.5, contract: 'определено' }, { city: 'Битола', address: 'Ул. 1' }, P, '2026-04-10');
    expect(c).toMatchObject({ type: 'opr', hours: 20, place: 'Битола', workPlace: 'Ул. 1, Битола', leave: 20, signDate: '2026-04-10' });
    const W = hrCtWarnings({ ...c, end: '', no: '7/2026' }, P, ['7/2026']);
    expect(W.join('|')).toMatch(/датум до кога важи/);
    expect(W.join('|')).toMatch(/Деловодниот број 7\/2026/);
    expect(hrExtWarnings({ start: '2020-01-01', end: '2024-12-31' }, { kind: 'ext', doc: 'annex', date: '2025-01-01', end: '2025-06-30' })[0]).toMatch(/над 5 години/);
  });

  it('document codes are stable and content-sensitive', () => {
    const a = hrDocCode({ t: 'ct', n: 'Ана' });
    expect(a).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(hrDocCode({ t: 'ct', n: 'Ана' })).toBe(a);
    expect(hrDocCode({ t: 'ct', n: 'Ане' })).not.toBe(a);
  });

  it('control code check takes any case / separators, only 12 hex digits (legacy docVerify)', () => {
    expect(hrDocCodeNorm('12af a639 949c')).toBe('12AF-A639-949C');
    expect(hrDocCodeNorm('12AF-A639-949C')).toBe('12AF-A639-949C');
    expect(hrDocCodeNorm('12AF-A639-949')).toBeNull();
    expect(hrDocCodeNorm('')).toBeNull();
  });

  it('labels every registry kind correctly (FIX #15)', () => {
    expect(hrDocLabel({ kind: 'di-otkaz' })).toBe('Отказ од работодавачот');
    expect(hrDocLabel({ kind: 'odluka', transform: true })).toMatch(/трансформација/);
    expect(hrDocLabel({ kind: 'contract', ctype: 'opr' })).toBe('Договор на определено време');
  });

  it('disciplinary checks and last day', () => {
    expect(hrDiWarnings({ kind: 'mera', date: '2026-01-01', mtype: 'kazna', pct: 20, months: 7, facts: 'x', heard: '2026-01-01' })).toHaveLength(2);
    expect(hrDiLastDay({ kind: 'otkaz', date: '2026-01-31', ground: 'vina', notice: 1 })).toBe('2026-03-03');
    expect(hrDiLastDay({ kind: 'otkaz', date: '2026-01-31', ground: 'vina_bez' })).toBe('2026-01-31');
  });

  it('open pay notes block the month', () => {
    const N = [{ done: false, month: '2026-03' }, { done: false, month: '2026-05' }, { done: true, month: '2026-01' }];
    expect(payNotesOpen(N, '2026-04')).toHaveLength(1);
  });
});

describe('payroll payment orders (FIX #19)', () => {
  const run = payDraft('2026-04', [{ id: 'a', no: '1', name: 'Ана Петрова', netBase: 30000 }, { id: 'b', no: '2', name: 'Бојан', netBase: 40000 }]);
  const emps = [{ id: 'a', bankAcc: '300000000000123', bank: 'Комерцијална' }, { id: 'b', bankAcc: '' }];
  it('one ПП30 per employee and one ПП50 per fund, reporting missing data', () => {
    const r = payrollPaymentOrders(run, run.params, emps, { name: 'Ф', bankAccount: '300-0000000001-23' }, { funds: { pio: { uplSm: '840-xxx', prihod: '722111 00' } } }, '2026-05-10');
    expect(r.orders.filter((o) => o.kind === 'pp30')).toHaveLength(2);
    expect(r.orders.filter((o) => o.kind === 'pp50').map((o) => o.ref)).toEqual(['pio', 'zdr', 'dop', 'vrab', 'tax']);
    const nets = run.emps.map((e) => empCalc(e, run.params).T.net);
    expect(r.totals.net).toBe(nets[0]! + nets[1]!);
    expect(r.orders[0]).toMatchObject({ code: '101', nacin: '3', amount: nets[0] });
    expect(r.missing).toContain('Сметка за плата: Бојан');
    expect(r.missing).toContain('Уплатна сметка: Придонес за задолжително здравствено осигурување');
    expect(r.missing.some((m) => m.includes('пензиско'))).toBe(false);
    expect(r.orders.find((o) => o.ref === 'pio')).toMatchObject({ recipAcc: '100000000063095', refDebit: '01042026-30042026' });
  });
});

describe('payCopyPrev (FIX #14)', () => {
  it('keeps additional lines and the part-time fund', () => {
    const prev: PayEmp[] = [
      { empId: 'a', name: 'A', netBase: 30000, lines: [{ type: PAY_REGULAR, hours: 100, cat: 'reg' }, { type: 'Годишен одмор', hours: 68 }, { type: 'Прекувремена работа', hours: 5, pct: 135 }] },
      { empId: 'b', name: 'B', netBase: 20000, hNorm: 84, inout: 'in', ioDate: '2026-04-10', lines: [{ type: 'Синдикална членарина', amt: 200, cat: 'sin' }] },
    ];
    const P2 = resolvePayParams({ hours: 168 }, '2026-05');
    const [a, b] = payCopyPrev('2026-05', prev, P2);
    expect(a!.lines!.map((l) => [l.type, l.hours])).toEqual([[PAY_REGULAR, 152], [PAY_HOLIDAY, 16], ['Прекувремена работа', 5]]);
    expect(b!.lines!.find((l) => l.type === PAY_REGULAR)!.hours).toBe(76);
    expect(b!.inout).toBeUndefined();
  });
  it('payBatch copies only sin lines (legacy pbBuild 15283)', () => {
    const prev: PayEmp[] = [{ empId: 'a', name: 'A', netBase: 30000, lines: [{ type: PAY_REGULAR, hours: 160, cat: 'reg' }, { type: 'Прекувремена работа', hours: 5, pct: 135 }, { type: 'Награда / бонус', amt: 500, cat: 'kor' }, { type: 'Синдикална членарина', amt: 200, cat: 'sin' }] }];
    const [a] = payCopyPrev('2026-05', prev, resolvePayParams({ hours: 168 }, '2026-05'), [], ['sin']);
    expect(a!.lines!.map((l) => l.type)).toEqual([PAY_REGULAR, PAY_HOLIDAY, 'Синдикална членарина']);
  });
});
