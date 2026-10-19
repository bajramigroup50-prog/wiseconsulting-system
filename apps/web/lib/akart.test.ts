import { describe, expect, it } from 'vitest';
import {
  curRunning, filterKontos, groupByStatement, isPartnerKonto, jumpIndex, kontoRows, neighbours, overdue, partnerRows, partnerTotals, sortCard, type AkLine,
} from './akart';

const chart = [
  { code: '1020', name: 'Жиро сметка' }, { code: '1200', name: 'Купувачи во земјата' }, { code: '220', name: 'Добавувачи' },
  { code: '2200', name: 'Добавувачи во земјата' }, { code: '2209', name: 'Добавувачи – други' }, { code: '4000', name: 'Материјали' },
];
const agg = [
  { account: '1020', debit: 500, credit: 200 }, { account: '2200', debit: 100, credit: 900 }, { account: '220010', debit: 0, credit: 50 },
  { account: '4000', debit: 0, credit: 0, kind: 'close' },
];

describe('konto list (Избор на конто за аналитика)', () => {
  it('turnover per chart konto from its sub-kontos, analytic kontos outside the chart, „Само конта со книжење“', () => {
    const all = kontoRows(agg, chart, { sum: true });
    expect(all.map((r) => r.c)).toEqual(['1020', '1200', '220', '2200', '220010', '2209', '4000']);
    expect(all.find((r) => r.c === '220')).toMatchObject({ d: 100, p: 950 });
    expect(all.find((r) => r.c === '220010')!.n).toBe('(аналитика)');
    expect(kontoRows(agg, chart, { post: true, sum: true }).map((r) => r.c)).toEqual(['1020', '220', '2200', '220010']);
    // without „Збирни конта“: the sum-only level 220 is hidden
    expect(kontoRows(agg, chart, { post: true }).map((r) => r.c)).toEqual(['1020', '2200', '220010']);
  });
  it('search: digits filter by the code prefix and jump to the exact konto; words search the name', () => {
    const all = kontoRows(agg, chart, { sum: true });
    expect(filterKontos(all, '2200').map((r) => r.c)).toEqual(['2200', '220010']);
    expect(filterKontos(all, '22').map((r) => r.c)).toEqual(['220', '2200', '220010', '2209']);
    expect(all[jumpIndex(all, '2200')]!.c).toBe('2200');
    expect(all[jumpIndex(all, '220')]!.c).toBe('220');
    expect(all[jumpIndex(all, '22')]!.c).toBe('220');
    expect(filterKontos(all, 'жиро').map((r) => r.c)).toEqual(['1020']);
    expect(jumpIndex(all, '99')).toBe(-1);
  });
  it('partner kontos: 120–128 / 220–228 / 1620 / 2620 always, others only with partner lines', () => {
    expect(isPartnerKonto('2200')).toBe(true);
    expect(isPartnerKonto('1200')).toBe(true);
    expect(isPartnerKonto('2620')).toBe(true);
    expect(isPartnerKonto('1620')).toBe(true);
    expect(isPartnerKonto('1020')).toBe(false);
    expect(isPartnerKonto('4000', [{ account: '4000', partnerId: null }])).toBe(false);
    expect(isPartnerKonto('2400', [{ account: '240010', partnerId: 'p' }])).toBe(true);
  });
});

const L = (o: Partial<AkLine> & Pick<AkLine, 'account' | 'date'>): AkLine => ({ debit: 0, credit: 0, partnerId: 'A', ...o });
const P = new Map([
  ['A', { id: 'A', code: '001', name: 'Алфа ДОО', edb: '4030000000001', city: 'Скопје', bankAccount: '300000000000111' }],
  ['B', { id: 'B', code: '002', name: 'Бета ДООЕЛ', embs: '7000001', city: 'Битола' }],
  ['C', { id: 'C', code: '003', name: 'Цента АД', city: 'Охрид' }],
]);

describe('partner list of a konto', () => {
  const lines: AkLine[] = [
    // supplier A: opening 1000 credit, invoice 500 (due 2026-02-10), paid 1200 → open 300 of the invoice, overdue
    L({ account: '2200', date: '2026-01-01', credit: 1000, kind: 'open' }),
    L({ account: '2200', date: '2026-02-01', credit: 500, due: '2026-02-10' }),
    L({ account: '2200', date: '2026-03-01', debit: 1200 }),
    // B: invoice not yet due on the as-of date
    L({ account: '2200', date: '2026-03-05', credit: 400, due: '2026-04-30', partnerId: 'B' }),
    // C: closed
    L({ account: '2200', date: '2026-01-15', credit: 100, partnerId: 'C' }),
    L({ account: '2200', date: '2026-01-20', debit: 100, partnerId: 'C' }),
    // other konto, no partner, after `to`
    L({ account: '1200', date: '2026-01-10', debit: 999 }),
    L({ account: '2200', date: '2026-01-10', credit: 7, partnerId: null }),
    L({ account: '2200', date: '2026-12-01', credit: 50 }),
  ];
  const o = { k: '2200', from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' };

  it('Должи / Побарува / Салдо, Салдо ПС, доспеан износ and days late; Активни by default, sorted by name', () => {
    const R = partnerRows(lines, P, o);
    expect(R.map((r) => r.code)).toEqual(['001', '002']);
    expect(R[0]).toMatchObject({ name: 'Алфа ДОО', d: 1200, p: 1500, s: -300, ps: -1000, over: 300, late: 49, bank: '300000000000111', ids: '4030000000001', city: 'Скопје' });
    expect(R[1]).toMatchObject({ s: -400, over: 0, late: 0, ps: 0, ids: '7000001' });
    expect(partnerTotals(R)).toEqual({ d: 1200, p: 1900, s: -700, over: 300, ps: -1000 });
  });
  it('Пасивни = zero balance, Сите = every partner with lines; search by name / code / ЕДБ', () => {
    expect(partnerRows(lines, P, { ...o, flt: 'p' }).map((r) => r.code)).toEqual(['003']);
    expect(partnerRows(lines, P, { ...o, flt: 's' }).map((r) => r.code)).toEqual(['001', '002', '003']);
    expect(partnerRows(lines, P, { ...o, flt: 's', q: 'бета' }).map((r) => r.code)).toEqual(['002']);
    expect(partnerRows(lines, P, { ...o, flt: 's', q: '403000' }).map((r) => r.code)).toEqual(['001']);
    expect(partnerRows(lines, P, { ...o, flt: 's', q: '00' }).map((r) => r.code)).toEqual(['001', '002', '003']);
  });
  it('overdue FIFO: receivables on the debit side, the oldest paid first, the due date else the booking date', () => {
    const R = [
      L({ account: '1200', date: '2026-01-05', debit: 100 }), L({ account: '1200', date: '2026-01-20', debit: 200, due: '2026-03-20' }),
      L({ account: '1200', date: '2026-02-01', credit: 150 }),
    ];
    expect(overdue(R, '1200', '2026-03-01')).toEqual({ open: 150, over: 0, late: 0 });
    expect(overdue(R, '1200', '2026-03-25')).toEqual({ open: 150, over: 150, late: 5 });
    // a later payment that closes everything
    expect(overdue([...R, L({ account: '1200', date: '2026-03-02', credit: 150 })], '1200', '2026-03-25')).toEqual({ open: 0, over: 0, late: 0 });
  });
  it('next / previous partner of the list (F5 / F4), none past the ends', () => {
    const R = partnerRows(lines, P, { ...o, flt: 's' });
    expect(neighbours(R, 'B')).toMatchObject({ i: 1, prev: { id: 'A' }, next: { id: 'C' } });
    expect(neighbours(R, 'A')).toMatchObject({ i: 0, prev: null, next: { id: 'B' } });
    expect(neighbours(R, 'C')).toMatchObject({ i: 2, next: null });
    expect(neighbours(R, 'X')).toMatchObject({ i: -1, prev: null, next: { id: 'A' } });
  });
});

describe('the card', () => {
  type Ln = { date: string; number: string; debit: number; credit: number; journalId: string; kind?: string; sourceType?: string };
  const rows: { line: Ln; balance: number }[] = [
    { line: { date: '2026-01-05', number: '10', debit: 100, credit: 0, journalId: 'j1', kind: 'manual' }, balance: 100 },
    { line: { date: '2026-01-06', number: '2', debit: 0, credit: 30, journalId: 'b1', sourceType: 'bank_statement' }, balance: 70 },
    { line: { date: '2026-01-06', number: '2', debit: 0, credit: 20, journalId: 'b1', sourceType: 'bank_statement' }, balance: 50 },
    { line: { date: '2026-01-07', number: '3', debit: 5, credit: 0, journalId: 'b2', sourceType: 'bank_statement' }, balance: 55 },
  ];
  it('sorted by nalog with the running balance recomputed', () => {
    const S = sortCard(rows, 0, 'nal');
    expect(S.map((r) => r.line.number)).toEqual(['2', '2', '3', '10']);
    expect(S.map((r) => r.balance)).toEqual([-30, -50, -45, 55]);
    expect(sortCard(rows, 0, 'date')).toEqual(rows);
  });
  it('„Групно по изводи“: the lines of one statement become one row', () => {
    const G = groupByStatement(rows);
    expect(G.map((r) => [r.line.number, r.line.debit, r.line.credit, r.balance, r.n])).toEqual([['10', 100, 0, 100, 0], ['2', 0, 50, 50, 2], ['3', 5, 0, 55, 1]]);
  });
  it('foreign currency: amount signed like the denar side, running saldo per currency', () => {
    expect(curRunning([
      { debit: 0, credit: 6150, currency: 'eur', amountCur: 100 }, { debit: 3075, credit: 0, currency: 'EUR', amountCur: 50 },
      { debit: 10, credit: 0 }, { debit: 0, credit: 590, currency: 'USD', amountCur: '10' },
    ])).toEqual([{ cur: 'EUR', amt: -100, s: -100 }, { cur: 'EUR', amt: 50, s: -50 }, { cur: '', amt: null, s: null }, { cur: 'USD', amt: -10, s: -10 }]);
  });
});
