import { describe, expect, it } from 'vitest';
import {
  aggregatePrior, analyticsRows, applyCustomScheme, balanceConfirmation, compareCards, customSchemeBalanced, daysLate, einvoiceBuyerProblems,
  filterAnalytics, iosStatement, linesWithoutPartner, loanFlows, loanKontoDir, loanMovesFromLedger, loanState, nextLoanNo, ourRecRows,
  parseCardTable, partnerKontoCards, partnerSums, pddCalc, pddEntries, pddTotal, pddTypes, penaltyInterest, recMatch, recSums,
  resultsByLocation, syntheticCard, type CardLine,
} from './finance';

const L = (date: string, account: string, debit: number, credit: number, partnerId: string | null = 'p1', o: Partial<CardLine> = {}): CardLine =>
  ({ date, account, debit, credit, partnerId, ...o });

describe('partner cards (legacy kcCard / kcPartners / kcSynHTML)', () => {
  const lines = [
    L('2026-01-05', '1200', 1000, 0, 'p1', { number: '1/1-3' }),
    L('2026-02-10', '1200', 0, 400, 'p1', { number: '1021' }),
    L('2026-03-01', '1200', 500, 0, 'p1', { number: '1/1-3' }),
    L('2026-03-02', '2200', 0, 300, 'p1'),
    L('2026-03-03', '1200', 200, 0, 'p2'),
    L('2026-12-31', '1200', 50, 0, 'p2'),
  ];
  it('splits per konto with opening, running balance and totals', () => {
    const C = partnerKontoCards(lines, 'p1', { from: '2026-02-01', to: '2026-12-31' });
    expect(C.map((c) => c.k)).toEqual(['1200', '2200']);
    expect(C[0]).toMatchObject({ o: 1000, td: 500, tp: 400, end: 1100 });
    expect(C[0]!.rows.map((r) => r.s)).toEqual([600, 1100]);
  });
  it('sorts by nalog number numerically, then date', () => {
    const C = partnerKontoCards(lines, 'p1', { from: '2026-01-01', to: '2026-12-31', sort: 'nal' });
    expect(C[0]!.rows.map((r) => r.line.number)).toEqual(['1/1-3', '1/1-3', '1021']);
  });
  it('partner sums up to the date, only open', () => {
    expect(partnerSums(lines, { to: '2026-06-30' })).toEqual([
      { id: 'p1', d: 1500, p: 700, s: 800, n: 4 }, { id: 'p2', d: 200, p: 0, s: 200, n: 1 },
    ]);
    expect(partnerSums([...lines, L('2026-04-01', '1200', 0, 200, 'p2')], { to: '2026-06-30', open: true }).map((x) => x.id)).toEqual(['p1']);
  });
  it('synthetic card over all lines', () => {
    const S = syntheticCard(lines.filter((l) => l.account === '1200'), { from: '2026-03-01', to: '2026-12-31' });
    expect(S).toMatchObject({ o: 600, td: 750, tp: 0, end: 1350 });
  });
  it('lines without partner on 120–128 / 220–228', () => {
    const X = linesWithoutPartner([L('2026-01-01', '1200', 5, 0, null), L('2026-01-01', '1290', 5, 0, null), L('2026-01-01', '2200', 5, 0, 'p1')], ['12']);
    expect(X.map((l) => l.account)).toEqual(['1200']);
  });
});

describe('analytics, IOS, balance confirmation', () => {
  const lines = [L('2026-01-01', '1200', 100, 0), L('2026-01-02', '1200', 0, 100), L('2026-01-03', '2200', 0, 50), L('2026-01-04', '4000', 50, 0)];
  it('rows per partner × konto on 12/22 and filters', () => {
    const R = analyticsRows(lines);
    expect(R).toEqual([{ p: 'p1', k: '1200', d: 100, c: 100 }, { p: 'p1', k: '2200', d: 0, c: 50 }]);
    expect(filterAnalytics(R, { bal: true }).map((r) => r.k)).toEqual(['2200']);
    expect(filterAnalytics(R, { k: '12' }).map((r) => r.k)).toEqual(['1200']);
  });
  it('IOS saldo', () => expect(iosStatement(lines, 'p1').saldo).toBe(-50));
  it('confirmation rows with sign', () => {
    expect(balanceConfirmation([...lines, L('2026-01-05', '1620', 300, 0)], 'p1', '2026-12-31').map((r) => r.v)).toEqual([0, 300, 50, 0]);
  });
});

describe('result per location (legacy poobjekti)', () => {
  it('revenue, cost of sales, other costs, common bucket', () => {
    const R = resultsByLocation([
      { account: '7410', debit: 0, credit: 1000, locationId: 'w1' }, { account: '7010', debit: 600, credit: 0, locationId: 'w1' },
      { account: '4400', debit: 100, credit: 0, locationId: 'w1' }, { account: '4200', debit: 50, credit: 0 },
    ], ['w1', 'w2']);
    expect(R).toEqual([{ w: 'w1', rev: 1000, cogs: 600, exp: 100, res: 300 }, { w: '', rev: 0, cogs: 0, exp: 50, res: -50 }]);
  });
});

describe('penalty interest (legacy kamati)', () => {
  it('days and amount', () => {
    expect(daysLate('2026-01-31', '2026-03-02')).toBe(30);
    expect(daysLate(null, '2026-03-02')).toBe(0);
    expect(penaltyInterest(10000, 13.25, 30)).toBe(108.9);
    expect(penaltyInterest(10000, 10, -5)).toBe(0);
  });
});

describe('ПДД (legacy pddCalc / pddEntries)', () => {
  const T = pddTypes(null);
  it('rent: net 9.100 → gross 10.000 (10% deductions, 10% tax)', () => {
    expect(pddCalc({ mode: 'n', amt: 9100 }, T[0]!)).toEqual({ G: 10000, ded: 1000, tax: 900, net: 9100 });
    expect(pddCalc({ mode: 'g', amt: 10000 }, T[0]!)).toEqual({ G: 10000, ded: 1000, tax: 900, net: 9100 });
  });
  it('services: net → gross with 10% tax', () => expect(pddCalc({ mode: 'n', amt: 9000 }, T[1]!)).toEqual({ G: 10000, ded: 0, tax: 1000, net: 9000 }));
  it('entries balance and merge', () => {
    const rows = [{ tid: 's6_1', mode: 'n' as const, amt: 9100, name: 'Петар' }, { tid: 's6_1', mode: 'n' as const, amt: 9100, name: 'Петар' }];
    const E = pddEntries(rows, T);
    expect(E.map((e) => [e.account, e.debit, e.credit])).toEqual([['4143', 20000, 0], ['22052', 0, 18200], ['23502', 0, 1800]]);
    expect(pddTotal(rows, T)).toEqual({ G: 20000, ded: 2000, tax: 1800, net: 18200 });
  });
  it('firm types override defaults', () => {
    expect(pddTypes([{ id: 's6_1', tax: 15 }])[0]).toMatchObject({ id: 's6_1', tax: 15, kExp: '4143' });
  });
});

describe('loans (legacy lnKontoDir / lnBankRows / lnState)', () => {
  it('konto direction', () => {
    expect(loanKontoDir('1620')).toBe('given');
    expect(loanKontoDir('2620')).toBe('received');
    expect(loanKontoDir('1999', 'Дадени заеми')).toBe('given');
    expect(loanKontoDir('1621', 'Камата на заеми')).toBeNull();
    expect(loanKontoDir('1200')).toBeNull();
  });
  it('flows, FIFO repayments, interest, unlinked', () => {
    const moves = loanMovesFromLedger([
      { ...L('2026-01-01', '1620', 1000, 0), id: 'a' },
      { ...L('2026-02-01', '1620', 500, 0), id: 'b' },
      { ...L('2026-03-01', '1620', 0, 1200), id: 'c' },
    ]);
    const F = loanFlows(moves);
    expect(F.map((f) => [f.id, f.dir, f.kind, f.amt])).toEqual([['a', 'given', 'out', 1000], ['b', 'given', 'out', 500], ['c', 'given', 'back', 1200]]);
    const loans = [
      { id: 'l1', dir: 'given' as const, partnerId: 'p1', date: '2026-01-01', amount: 1000, rate: 0, termDate: '2026-02-01', signed: true, moveIds: ['a'] },
      { id: 'l2', dir: 'given' as const, partnerId: 'p1', date: '2026-02-01', amount: 500, rate: 10, moveIds: [] },
    ];
    const st = loanState(loans, F, '2026-12-31');
    expect(st.rows.map((r) => [r.rep, r.bal, r.over, r.noSig])).toEqual([[1000, 0, false, false], [200, 300, false, true]]);
    expect(st.rows[1]!.int).toBe(r(300 * 0.1 * 333 / 365));
    expect(st.unlinked.map((u) => u.id)).toEqual(['b']);
  });
  it('excess repayment becomes a received loan', () => {
    const F = loanFlows(loanMovesFromLedger([{ ...L('2026-01-01', '1620', 100, 0), id: 'a' }, { ...L('2026-01-05', '1620', 0, 300), id: 'b' }]));
    expect(F.map((f) => [f.id, f.dir, f.kind, f.amt])).toEqual([['a', 'given', 'out', 100], ['b', 'given', 'back', 100], ['b:x', 'received', 'out', 200]]);
  });
  it('next number', () => expect(nextLoanNo([{ no: '3/2026', date: '2026-01-01' }, { no: '9/2025', date: '2025-01-01' }], '2026')).toBe('4/2026'));
});
const r = (n: number) => Math.round(n * 100) / 100;

describe('card reconciliation (legacy recMatch / rfRun)', () => {
  const ours = ourRecRows([
    L('2026-01-10', '1200', 1180, 0, 'p1', { doc: '15/2026' }),
    L('2026-02-01', '1200', 0, 1180, 'p1', { description: 'Извод 5' }),
    L('2026-03-01', '1200', 500, 0, 'p1', { doc: '22/2026' }),
    L('2026-03-05', '1200', 70, 0, 'p1', { doc: '30/2026' }),
  ]);
  const theirs = [
    { date: '2026-01-12', doc: 'Ф-ра 15/26', desc: '', debit: 0, credit: 1180 },
    { date: '2026-02-03', doc: '', desc: 'плаќање', debit: 1180, credit: 0 },
    { date: '2026-03-02', doc: '22/2026', desc: '', debit: 0, credit: 450 },
    { date: '2026-04-01', doc: '99', desc: '', debit: 0, credit: 10 },
  ];
  it('matches by number, by amount + date, same number different amount, and the rest', () => {
    const M = recMatch(ours, theirs);
    expect(M.pairs.map((p) => p.how)).toEqual(['број + износ', 'износ + датум']);
    expect(M.adiff.map((d) => d.diff)).toEqual([50]);
    expect(M.onlyO.map((o) => o.doc)).toEqual(['30/2026']);
    expect(M.onlyT.map((t) => t.doc)).toEqual(['99']);
    expect(recSums(ours, theirs, 0, M)).toMatchObject({ sO: 570, sT: 460, dif: 110, ok: false });
  });
  it('their rows before our period become one carried balance', () => {
    const X = aggregatePrior([{ date: '2025-05-01', doc: '', desc: '', debit: 0, credit: 300 }, { date: '2026-01-02', doc: '', desc: '', debit: 0, credit: 5 }], '2026-01-01', true);
    expect(X[0]).toMatchObject({ prior: true, credit: 300 });
    const M = recMatch(ourRecRows([L('2026-01-01', '1200', 300, 0, 'p1', { kind: 'open' })]), X);
    expect(M.pairs[0]!.how).toBe('пренесено салдо');
  });
  it('parses an Excel/CSV card', () => {
    const P = parseCardTable([['Картица'], ['Датум', 'Документ', 'Опис', 'Должи', 'Побарува'], ['05.01.2026', '15/2026', 'фактура', '1.180,00', ''], ['Вкупно', '', '', '1.180,00', '']]);
    expect(P!.rows).toEqual([{ date: '2026-01-05', doc: '15/2026', desc: 'фактура', debit: 1180, credit: 0 }]);
    expect(parseCardTable([['a', 'b']])).toBeNull();
  });
  it('compares two cards on the common period, auto direction', () => {
    const a = [{ date: '2026-01-01', doc: '', desc: 'Почетно салдо', debit: 100, credit: 0 }, { date: '2026-01-10', doc: '1/26', desc: '', debit: 500, credit: 0 }, { date: '2026-05-01', doc: '7/26', desc: '', debit: 1, credit: 0 }];
    const b = [{ date: '2026-01-11', doc: '1/26', desc: '', debit: 0, credit: 500 }, { date: '2026-02-01', doc: '', desc: '', debit: 0, credit: 3 }];
    const X = compareCards(a, b)!;
    expect(X).toMatchObject({ from: '2026-01-11', to: '2026-02-01', mirror: true, preA: 600 });
    const Y = compareCards([...a, { date: '2026-02-01', doc: '', desc: '', debit: 3, credit: 0 }], b)!;
    expect(Y).toMatchObject({ from: '2026-01-11', to: '2026-02-01', mirror: true, preA: 600 });
    expect(Y.M.pairs.length).toBe(1);
  });
});

describe('custom schemes, e-invoice check', () => {
  it('balanced and applied', () => {
    const c = { rows: [{ k: '4400', s: 'd' as const, v: 100 }, { k: '1000', s: 'p' as const, v: 100 }] };
    expect(customSchemeBalanced(c)).toBe(true);
    expect(customSchemeBalanced({ rows: [{ k: '4400', s: 'd', v: 100 }] })).toBe(false);
    expect(applyCustomScheme(c, 123.45)).toEqual([{ account: '4400', debit: 123.45, credit: 0, note: '' }, { account: '1000', debit: 0, credit: 123.45, note: '' }]);
  });
  it('buyer problems', () => {
    expect(einvoiceBuyerProblems({ edb: '4030', address: '', city: 'Скопје' })).toEqual(['ЕДБ не е 13 цифри', 'нема адреса']);
    expect(einvoiceBuyerProblems({ edb: '4030012345678', address: 'x', city: 'y' })).toEqual([]);
  });
});
