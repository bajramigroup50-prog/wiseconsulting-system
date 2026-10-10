import { describe, expect, it } from 'vitest';
import { MS_DISC, mailSigCfg, mailSigText, signMailHtml } from './mailsig';
import { zsRokRows } from './zsrok';
import { opDays, opDue, opGroups, opText, waPhone } from './dunning';
import { mhKind, mhKindGroup } from './mailhist';
import { klStrongPw, klUserName } from './klprofili';
import { fimpFind, fimpParse, fimpToFirm } from './firmimp';
import { dashAgg, dashMonthly, dashRange, kdBuckets, kdRange, payDeadline, pct } from './dash';
import { miCalc, miMonths, miRange } from './mojizv';
import { numberGaps, zatMonthEnd, zatPrio, zatTasks } from './zatvoranje';

describe('zsRok', () => {
  it('deadlines fall in the next year, per entity', () => {
    expect(zsRokRows('co', 2025)[0]![2]).toContain('15 март 2026');
    expect(zsRokRows('tp', 2025)).toHaveLength(4);
    expect(zsRokRows('npo', 2025).every((r) => r[3] === 'zsNPO')).toBe(true);
  });
});

describe('mail signature (legacy msCfg / msSigText / msHtml)', () => {
  it('defaults and plain text', () => {
    const c = mailSigCfg(null, 'Ана Петрова');
    expect(c.greet).toBe('Со почит,');
    expect(c.discText).toBe(MS_DISC);
    expect(mailSigText({ ...c, phone: '070', email: 'a@b.mk' })).toBe('Со почит,\n\nАна Петрова\nтел. 070 · a@b.mk');
  });
  it('signs once and escapes', () => {
    const c = mailSigCfg({ name: '<b>X</b>', disc: false });
    const once = signMailHtml('<p>Hi</p>', c, '01.01.2026 10:00');
    expect(once).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(once).not.toContain('НАПОМЕНА');
    expect(signMailHtml(once, c, 'x')).toBe(once);
    expect(signMailHtml('<p>Hi</p>', null, 'x')).toBe('<p>Hi</p>');
  });
});

describe('dunning (legacy opData / opLvAuto / opText v401)', () => {
  const inv = (id: string, p: string, date: string, total: number, paid = 0, due: string | null = null) => ({ id, number: 'Ф-' + id, date, due, partnerId: p, total, paid });
  it('due date = invoice due or date + pay days', () => {
    expect(opDue({ date: '2026-01-10', due: null }, 15)).toBe('2026-01-25');
    expect(opDue({ date: '2026-01-10', due: '2026-02-01' }, 15)).toBe('2026-02-01');
    expect(opDays('2026-01-25', '2026-02-04')).toBe(10);
  });
  it('groups by customer; level from distinct earlier non-PDF days', () => {
    const I = [inv('1', 'A', '2026-01-01', 100_00), inv('2', 'A', '2026-03-01', 50_00), inv('3', 'B', '2026-01-01', 30_00, 30_00), inv('4', 'B', '2026-01-01', 40)];
    const L = [
      { partnerId: 'A', invoiceIds: ['1'], level: 1, channel: 'е-пошта', date: '2026-02-01', total: 0 },
      { partnerId: 'A', invoiceIds: ['1'], level: 1, channel: 'PDF', date: '2026-02-05', total: 0 },
      { partnerId: 'A', invoiceIds: ['1'], level: 2, channel: 'е-пошта', date: '2026-02-10', total: 0 },
    ];
    const G = opGroups(I, L, 15, '2026-03-05');
    expect(G).toHaveLength(1);
    expect(G[0]!.over).toBe(100_00);
    expect(G[0]!.open).toBe(150_00);
    expect(G[0]!.lvlAuto).toBe(2);
    expect(G[0]!.last!.date).toBe('2026-02-10');
  });
  it('interest and cost', () => {
    const G = opGroups([inv('1', 'A', '2025-01-01', 1000_00, 0, '2025-01-01')], [], 15, '2026-01-01');
    const X = opText(G[0]!, 0, { name: 'Ф', bankAccount: '300' }, 10, 200_00, '2026-01-01');
    expect(X.kam).toBe(100_00);
    expect(X.tot).toBe(1300_00);
    expect(X.body).toContain('жиро сметка 300');
    expect(waPhone('070 123 456')).toBe('38970123456');
  });
});

describe('mail history kinds (legacy mhKind)', () => {
  it('classifies by subject', () => {
    expect(mhKind('2. Опомена – неплатени фактури')).toBe('Опомена');
    expect(mhKind('Фактура 12/2026')).toBe('Фактура');
    expect(mhKind('Пресметка на плата 03/2026')).toBe('Плата');
    expect(mhKind('Здраво')).toBe('Е-пошта');
    expect(mhKindGroup('Опомена (последна)')).toBe('Опомена');
    expect(mhKindGroup('Опомена 2.')).toBe('Опомена');
  });
});

describe('client profiles (legacy klUserName / klStrongPw)', () => {
  let i = 0;
  const rnd = (n: number) => Array.from({ length: n }, () => (i = (i * 7 + 13) % 997));
  it('username from the first meaningful word, latinised, + 4 chars, unique', () => {
    const u = klUserName({ name: 'ДООЕЛ БАЈРАМИ ГРОУП Скопје' }, new Set(), rnd);
    expect(u).toMatch(/^bajrami\.[a-z2-9]{4}$/);
    const used = new Set([u]);
    expect(klUserName({ name: 'ДООЕЛ БАЈРАМИ ГРОУП Скопје' }, used, rnd)).not.toBe(u);
    expect(klUserName({ name: 'ДОО' }, new Set(), rnd)).toMatch(/^klient\./);
  });
  it('password: 3 groups of 4 with upper, lower and digit', () => {
    const p = klStrongPw(rnd);
    expect(p).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)).toBe(true);
  });
});

describe('monthly close (legacy zatTasks / zatPrio)', () => {
  const base = { vat: true, vatPeriod: 'quarter', lockDate: null, statements: 2, invoices: 3, purchases: 1, invoiceNumbers: ['1', '2', '5', 'A-1', 'A-2'],
    cash: { any: true, balance: -10 }, activeEmployees: 2, payrollRun: null, vatClosed: new Set(['2026-Т1']) };
  it('tasks and states', () => {
    expect(zatMonthEnd('2026-02')).toBe('2026-02-28');
    expect(numberGaps(['1', '2', '5', 'A-1', 'A-2'])).toBe(2);
    const T = zatTasks(base, '2026-03');
    const by = Object.fromEntries(T.map((t) => [t.k, t.ok]));
    expect(by).toEqual({ izv: true, vlez: true, izlez: false, blg: false, pay: false, ddv: true, lock: false });
    expect(T.find((t) => t.k === 'pay')!.due).toBe('2026-04-15');
    expect(zatTasks(base, '2026-02').some((t) => t.k === 'ddv')).toBe(false);
  });
  it('priority', () => {
    expect(zatPrio({ vat: true, vatPeriod: 'month', activeEmployees: 0 }, '2026-02')[0]).toBe(1);
    expect(zatPrio({ vat: true, vatPeriod: 'quarter', activeEmployees: 0 }, '2026-03')[0]).toBe(2);
    expect(zatPrio({ vat: false, vatPeriod: 'quarter', activeEmployees: 0 }, '2026-03')[0]).toBe(5);
  });
});

describe('firm import (legacy fimpField / fimpRead / fimpFind)', () => {
  it('finds the header row, maps columns, flags and existing firms', () => {
    const P = fimpParse([['Извоз'], ['Шифра', 'Име на фирма', 'ЕДБ', 'Жиро сметка', 'ДДВ', 'ДДВ период', 'Правна форма'], ['1', 'Алфа ДООЕЛ', 'MK 4030 000000 001', '300 1', 'да', 'месечно', 'ДООЕЛ'], ['', '', '']]);
    if ('error' in P) throw new Error(P.error);
    expect(P.L).toHaveLength(1);
    expect(P.L[0]).toMatchObject({ code: '1', name: 'Алфа ДООЕЛ', edb: 'MK4030000000001', bank: '3001', ddv: true, per: 'month' });
    const F = fimpToFirm(P.L[0]!);
    expect(F.cols).toMatchObject({ edb: '4030000000001', legalForm: 'dooel', vatRegistered: true, vatPeriod: 'month' });
    expect(F.settings.bankAccount).toBe('3001');
    expect(fimpFind(P.L[0]!, [{ id: 'x', name: 'Друга', edb: '4030000000001', embs: null }])?.id).toBe('x');
    expect('error' in fimpParse([['a', 'b']])).toBe(true);
  });
});

describe('dashboard (legacy dashRange / dashAgg / dashMonthly / kdRange)', () => {
  const L = [
    { account: '7400', month: 1, debit: 0, credit: 1000 }, { account: '4100', month: 1, debit: 300, credit: 0 },
    { account: '7000', month: 2, debit: 200, credit: 0 }, { account: '1000', month: 1, debit: 500, credit: 100 }, { account: '1020', month: 3, debit: 50, credit: 0 },
  ];
  it('ranges', () => {
    expect(dashRange(2026, 'q1', '2026-05-10')).toMatchObject({ from: '2026-01-01', to: '2026-03-31', m0: 0, m1: 2 });
    expect(dashRange(2026, 'ytd', '2026-05-10')).toMatchObject({ to: '2026-05-31', m1: 4 });
    expect(dashRange(2025, 'm', '2026-05-10')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('aggregates and monthly cash', () => {
    expect(dashAgg(L, 0, 11)).toEqual({ rev: 1000, exp: 500, res: 500, eg: { '41': 300, '70': 200 } });
    const M = dashMonthly(L, new Set(['1000', '1020']));
    expect(M.CB.slice(0, 3)).toEqual([400, 400, 450]);
    expect(pct(110, 100)).toBe(10);
    expect(pct(1, 0)).toBeNull();
  });
  it('klDash ranges and buckets, payroll deadline', () => {
    expect(kdRange(2026, 'pm', '2026-03-15')).toEqual(['2026-02-01', '2026-02-28', 'Претходен месец']);
    expect(kdRange(2026, '7', '2026-03-15')[0]).toBe('2026-03-09');
    expect(kdBuckets('2026-01-01', '2026-01-03').keys).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(kdBuckets('2026-01-01', '2026-12-31')).toMatchObject({ byMonth: true });
    expect(payDeadline('2026-03-15')).toEqual({ due: '2026-04-10', month: '2026-03' });
    expect(payDeadline('2026-03-05')).toEqual({ due: '2026-03-10', month: '2026-02' });
  });
});

describe('owner report (legacy miRange / miMonths / miCalc)', () => {
  it('fee for the period and den./item', () => {
    expect(miRange('y', '2026-01', '2026', '2026-04')).toMatchObject({ m0: '2026-01', m1: '2026-04' });
    expect(miRange('m', '2026-02', '2026', '2026-04')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(miMonths('2026-03', '2026-04')).toBe(2);
    expect(miMonths('2026-05', '2026-04')).toBe(0);
    const R = miRange('y', '2026-01', '2026', '2026-04');
    const r = miCalc({ inv: 10, pur: 5, ai: 1, stm: 2, bl: 20, sal: 0, jr: 3, emp: 2, payEmp: 2, prih: 0, nab: 0, tro: 0, fee: 3000, feeFrom: '2026-03', aiUsd: 1 }, R, 57);
    expect(r.items).toBe(40);
    expect(r.feeP).toBe(6000);
    expect(r.perItem).toBe(150);
    expect(r.net).toBe(6000 - 57);
  });
});
