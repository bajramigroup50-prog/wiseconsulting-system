import { describe, expect, it } from 'vitest';
import {
  accountCard, assignNumbers, balances, bankNalCode, buildOpening, closeYearLines, csvToGrid, dropSummaryRows,
  groupNalozi, lineTotals, matchPartner, nalogNumber, nalPer, needsPartner, nextCounter, normalizeName, openYearLines,
  parseAmount, parseKontoSrc, parseOpeningSheet, remapResultAccounts, resultBalancingRow, sumPref, trialBalance,
  type LedgerLine,
} from './ledger';

const L = (date: string, account: string, debit: number, credit: number, extra: Partial<LedgerLine> = {}): LedgerLine =>
  ({ date, account, debit, credit, ...extra });

const year: LedgerLine[] = [
  L('2026-01-01', '1000', 10000, 0, { kind: 'open' }),
  L('2026-01-01', '9000', 0, 10000, { kind: 'open' }),
  L('2026-02-10', '1200', 11800, 0, { kind: 'izlez', partnerId: 'p1' }),
  L('2026-02-10', '7400', 0, 10000, { kind: 'izlez' }),
  L('2026-02-10', '230018', 0, 1800, { kind: 'izlez' }),
  L('2026-03-05', '4400', 3000, 0, { kind: 'manual' }),
  L('2026-03-05', '1000', 0, 3000, { kind: 'manual' }),
  L('2026-04-01', '1000', 5900, 0, { kind: 'bank' }),
  L('2026-04-01', '1200', 0, 5900, { kind: 'bank', partnerId: 'p1' }),
];

describe('balances / sumPref', () => {
  it('sums per account', () => {
    const B = balances(year);
    expect(B['1000']).toEqual({ d: 15900, p: 3000, s: 12900 });
    expect(B['1200']!.s).toBe(5900);
    expect(sumPref(B, ['1', '!12'])).toBe(12900);
    expect(sumPref(B, ['7'], -1)).toBe(10000);
  });
});

describe('trialBalance', () => {
  it('splits opening and turnover, balances, levels', () => {
    const tb = trialBalance(year, { level: 'a', from: '2026-01-01', to: '2026-12-31', accountName: (k) => (k === '1000' ? 'Банка' : undefined) });
    expect(tb.balanced).toBe(true);
    const r = tb.rows.find((x) => x.k === '1000')!;
    expect(r).toMatchObject({ name: 'Банка', od: 10000, op: 0, td: 5900, tp: 3000, vd: 15900, vp: 3000, s: 12900 });
    expect(tb.total.vd).toBe(tb.total.vp);
    const cls = trialBalance(year, { level: '1', from: '2026-01-01', to: '2026-12-31' });
    expect(cls.rows.map((x) => x.k)).toEqual(['1', '2', '4', '7', '9']);
    expect(cls.rows[0]!.name).toBe('Парични средства и побарувања');
  });
  it('filters by period, partner and breaks down by partner', () => {
    const q1 = trialBalance(year, { level: '2', from: '2026-01-01', to: '2026-03-31' });
    expect(q1.rows.find((x) => x.k === '12')!.s).toBe(11800);
    const bp = trialBalance(year, { level: 'a', from: '2026-01-01', to: '2026-12-31', byPartnerOf: '1200', partnerName: () => 'Купувач' });
    expect(bp.rows).toHaveLength(1);
    expect(bp.rows[0]).toMatchObject({ k: 'p1', name: 'Купувач', s: 5900 });
    const pf = trialBalance(year, { level: 'a', from: '2026-01-01', to: '2026-12-31', partnerId: 'p1' });
    expect(pf.rows.map((x) => x.k)).toEqual(['1200']);
  });
  it('excludes the closing journal unless asked; flags bbimp mixed with turnover', () => {
    const withClose = [...year, L('2026-12-31', '7400', 10000, 0, { kind: 'close' }), L('2026-12-31', '8000', 0, 10000, { kind: 'close' })];
    expect(trialBalance(withClose, { level: 'a', from: '2026-01-01', to: '2026-12-31' }).rows.some((r) => r.k === '8000')).toBe(false);
    expect(trialBalance(withClose, { level: 'a', from: '2026-01-01', to: '2026-12-31', withClose: true }).rows.some((r) => r.k === '8000')).toBe(true);
    const mixed = [...year, L('2026-12-31', '1000', 1, 0, { kind: 'bbimp' }), L('2026-12-31', '9000', 0, 1, { kind: 'bbimp' })];
    expect(trialBalance(mixed, { level: 'a', from: '2026-01-01', to: '2026-12-31' }).bbimpMixed).toBe(true);
    expect(trialBalance(year, { level: 'a', from: '2026-01-01', to: '2026-12-31' }).bbimpMixed).toBe(false);
  });
});

describe('accountCard', () => {
  it('opening saldo before the period, running balance, totals', () => {
    const c = accountCard(year, { account: '1000', from: '2026-03-01', to: '2026-12-31' });
    expect(c.opening).toBe(10000);
    expect(c.rows.map((r) => r.balance)).toEqual([7000, 12900]);
    expect([c.debit, c.credit, c.closing]).toEqual([5900, 3000, 12900]);
  });
  it('sub-accounts and partner filters', () => {
    expect(accountCard(year, { account: '12', sub: true, from: '2026-01-01', to: '2026-12-31' }).closing).toBe(5900);
    expect(accountCard(year, { account: '1200', partnerId: 'x', from: '2026-01-01', to: '2026-12-31' }).rows).toHaveLength(0);
    expect(accountCard(year, { account: '1000', noPartner: true, from: '2026-01-01', to: '2026-12-31' }).rows).toHaveLength(3);
  });
});

describe('numbering', () => {
  it('period numbers per type', () => {
    expect(nalPer('2026-05-10')).toEqual([4, 6]);
    expect(nalPer('2026-05-10', 'month')).toEqual([5, 5]);
    expect(nalogNumber({ kind: 'vlez', date: '2026-02-01' }).no).toBe('2/1-3');
    expect(nalogNumber({ kind: 'izlez', date: '2026-11-01', settings: { nalogPer: 'month', nalCodes: { izlez: '10' } } }).no).toBe('10/11-11');
    expect(nalogNumber({ kind: 'open', date: '2026-01-01' }).no).toBe('0');
    expect(nalogNumber({ kind: 'close', date: '2026-12-31' }).no).toBe('999');
    expect(nalogNumber({ kind: 'plati', date: '2026-04-10', payMonth: 3 }).no).toBe('12/3-3');
    expect(nalogNumber({ kind: 'plati', date: '2026-04-10', settings: { nalPayPer: 'year' } }).no).toBe('12/1-12');
    expect(nalogNumber({ kind: 'ddv', date: '2026-02-10', vatPeriod: 'month' }).no).toBe('4/2-2');
    expect(nalogNumber({ kind: 'manual', date: '2026-02-10' }).no).toBeNull();
    expect(nalogNumber({ kind: 'vlez', date: '2026-02-10', settings: { nalogMode: 'doc' } }).no).toBeNull();
  });
  it('bank codes 6/66 (MKD) and 7/77 (FX)', () => {
    const banks = [{ id: 'a' }, { id: 'b' }, { id: 'e', cur: 'EUR' }, { id: 'f', cur: 'EUR' }, { id: 'x', nal: '9' }];
    expect(bankNalCode('a', banks)).toBe('6');
    expect(bankNalCode('b', banks)).toBe('66');
    expect(bankNalCode('f', banks)).toBe('77');
    expect(bankNalCode('x', banks)).toBe('9');
    expect(bankNalCode(null, [])).toBe('6');
    expect(nalogNumber({ kind: 'bank', date: '2026-07-01', bankAccountId: 'e', settings: { banks } }).no).toBe('7/7-9');
  });
  it('counters skip every used number', () => {
    expect(nextCounter([])).toBe('1021');
    expect(nextCounter(['1021', '1022', '1024'])).toBe('1023');
    expect(nextCounter(['1', '2'], 0)).toBe('3');
  });
  it('assignNumbers numbers manual journals in date order and keeps explicit numbers', () => {
    const m = assignNumbers([
      { id: 'b', kind: 'manual', date: '2026-03-01' },
      { id: 'a', kind: 'manual', date: '2026-01-01' },
      { id: 'c', kind: 'manual', date: '2026-02-01', number: '1022' },
      { id: 'd', kind: 'vlez', date: '2026-02-01' },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: '1021', c: '1022', d: '2/1-3', b: '1023' });
    const doc = assignNumbers([{ id: 'x', kind: 'vlez', date: '2026-01-01' }, { id: 'y', kind: 'open', date: '2026-01-01' }], { nalogMode: 'doc' });
    expect(Object.fromEntries(doc)).toEqual({ x: '1', y: '2' });
  });
  it('groupNalozi groups by number, sorted numerically', () => {
    const G = groupNalozi([
      { number: '1021', date: '2026-01-05' }, { number: '2/1-3', date: '2026-01-10' }, { number: '2/1-3', date: '2026-02-10' }, { number: '0', date: '2026-01-01' },
    ]);
    expect(G.map((g) => [g.no, g.journals.length, g.date])).toEqual([['0', 1, '2026-01-01'], ['2/1-3', 2, '2026-02-10'], ['1021', 1, '2026-01-05']]);
  });
});

describe('close / open year', () => {
  it('closes classes 4 and 7, books tax and the net result on 951', () => {
    const r = closeYearLines(year);
    expect(r.profit).toBe(7000);
    expect(r.tax).toBe(700);
    expect(r.net).toBe(6300);
    expect(lineTotals(r.lines).balanced).toBe(true);
    const B = balances([...year, ...r.lines.map((l) => ({ ...l, date: '2026-12-31' }))]);
    expect(B['7400']?.s ?? 0).toBe(0);
    expect(B['4400']?.s ?? 0).toBe(0);
    expect(B['951']!.s).toBe(-6300);
    expect(B['2330']!.s).toBe(-700);
    expect(B['8000']!.s).toBe(0);
    expect(B['8200']!.s).toBe(0);
  });
  it('a loss goes to 961 without tax; explicit tax overrides the rate', () => {
    const loss = closeYearLines([L('2026-01-01', '4400', 500, 0), L('2026-01-01', '1000', 0, 500)]);
    expect([loss.profit, loss.tax, loss.net]).toEqual([-500, 0, -500]);
    expect(loss.lines.some((l) => l.account === '961' && l.debit === 500)).toBe(true);
    expect(closeYearLines(year, { tax: 650 }).tax).toBe(650);
    expect(closeYearLines(year, { nondeductible: 1000 }).tax).toBe(800);
  });
  it('opens the next year per partner with 951 → 950', () => {
    const closed = [...year, ...closeYearLines(year).lines.map((l) => ({ ...l, date: '2026-12-31', kind: 'close' }))];
    const o = openYearLines(closed);
    expect(lineTotals(o).balanced).toBe(true);
    expect(o.find((l) => l.account === '1200')).toEqual({ account: '1200', debit: 5900, credit: 0, partnerId: 'p1' });
    expect(o.find((l) => l.account === '950')!.credit).toBe(6300);
    expect(o.some((l) => /^[4578]/.test(l.account) || l.account === '951')).toBe(false);
  });
  it('carries partner-less remainder of partner accounts, and 129x is not split by partner (FIX #6)', () => {
    const o = openYearLines([
      L('2026-01-01', '1200', 100, 0, { partnerId: 'p1' }), L('2026-01-01', '1200', 50, 0),
      L('2026-01-01', '1290', 0, 20, { partnerId: 'p1' }), L('2026-01-01', '9000', 0, 130),
    ]);
    expect(o).toContainEqual({ account: '1200', debit: 100, credit: 0, partnerId: 'p1' });
    expect(o).toContainEqual({ account: '1200', debit: 50, credit: 0 });
    expect(o).toContainEqual({ account: '1290', debit: 0, credit: 20 });
  });
  it('remapResultAccounts merges into existing 950 and nets 950/960 sides', () => {
    const r = remapResultAccounts([
      { account: '951', debit: 0, credit: 100 }, { account: '950', debit: 0, credit: 40 }, { account: '961', debit: 30, credit: 0 },
      { account: '960', debit: 0, credit: 10 },
    ]);
    expect(r).toEqual([{ account: '950', debit: 0, credit: 140 }, { account: '960', debit: 20, credit: 0 }]);
  });
});

describe('opening balance import', () => {
  it('parseAmount handles both decimal styles', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount(' -12 ')).toBe(-12);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(7)).toBe(7);
  });
  it('normalizes names (Cyrillic legal forms stripped) and matches partners', () => {
    expect(normalizeName('„АЛФА“ ДООЕЛ Скопје')).toBe('алфа');
    const P = [{ id: '1', name: 'Алфа ДООЕЛ', edb: '4030990123456' }, { id: '2', name: 'Бета Трејд', code: '77' }];
    expect(matchPartner('x', 'MK4030990123456', P)).toBe('1');
    expect(matchPartner('x', '77', P)).toBe('2');
    expect(matchPartner('АЛФА доо', '', P)).toBe('1');
    expect(matchPartner('Бета Трејд Експорт', '', P)).toBe('2');
    expect(matchPartner('Гама', '', P)).toBe('');
  });
  it('parses a sheet with a two-row header, analytic partner rows and totals', () => {
    const A = [
      ['Бруто биланс'],
      ['Конто', 'Назив', 'Комитент', 'ЕДБ', 'Салдо', ''],
      ['', '', '', '', 'Должи', 'Побарува'],
      ['1000', 'Жиро сметка', '', '', '1.000,00', ''],
      ['1200', 'Купувачи', '', '', '', ''],
      ['', '', 'Алфа ДООЕЛ', '4030990123456', 300, 0],
      ['', '', 'Нов купувач', '123', 200, 0],
      ['1200', 'Вкупно 1200', '', '', 500, 0],
      ['4400', 'Трошоци', '', '', 100, 0],
      ['9000', 'Капитал', '', '', 0, 1600],
    ];
    const R = parseOpeningSheet(A)!;
    expect(R.rows).toEqual([
      ['1000', 'Жиро сметка', '', '', 1000, 0],
      ['1200', '', 'Алфа ДООЕЛ', '4030990123456', 300, 0],
      ['1200', '', 'Нов купувач', '123', 200, 0],
      ['4400', 'Трошоци', '', '', 100, 0],
      ['9000', 'Капитал', '', '', 0, 1600],
    ]);
    expect(R.totals).toEqual([['1200', 500, 0]]);
    const { rows, control } = buildOpening(R, { partners: [{ id: 'p1', name: 'Алфа', edb: '4030990123456' }] });
    expect(rows.map((r) => [r.account, r.partnerId, r.partnerName ?? '', r.debit, r.credit])).toEqual([
      ['1000', '', '', 1000, 0], ['1200', 'p1', '', 300, 0], ['1200', '', 'Нов купувач', 200, 0], ['9000', '', '', 0, 1600],
    ]);
    expect(control).toMatchObject({ n: 4, nP: 2, nNew: 1, chk: 1, bad: [], res: 100 });
    expect(resultBalancingRow(control.res)).toEqual({ account: '960', debit: 100, credit: 0 });
    expect(resultBalancingRow(-5)).toEqual({ account: '950', debit: 0, credit: 5 });
    expect(buildOpening(R, { full: true }).rows.some((r) => r.account === '4400')).toBe(true);
  });
  it('parses headerless CSV (konto; name; debit; credit)', () => {
    const R = parseOpeningSheet(csvToGrid('1000;Банка;100,50;0\n2200;Добавувачи;0;100,50\nxx;skip;1;1'), 'csv')!;
    expect(R.rows).toEqual([['1000', 'Банка', '', '', 100.5, 0], ['2200', 'Добавувачи', '', '', 0, 100.5]]);
  });
  it('drops synthetic sums of sub-accounts and partner rows', () => {
    const r = dropSummaryRows([
      ['120', 'Купувачи', '', '', 500, 0], ['1200', '', 'А', '', 300, 0], ['1200', '', 'Б', '', 200, 0], ['1201', '', '', '', 0, 0],
    ]);
    expect(r.dropped).toBe(1);
    expect(r.rows.map((x) => x[0])).toEqual(['1200', '1200', '1201']);
  });
});

describe('misc', () => {
  it('partner accounts and chart parsing', () => {
    expect(needsPartner('1200')).toBe(true);
    expect(needsPartner('2280')).toBe(true);
    expect(needsPartner('1290')).toBe(false);
    expect(parseKontoSrc('002|Концесии\n1000|Банка')).toEqual([['002', 'Концесии'], ['1000', 'Банка']]);
    expect(lineTotals([{ debit: '10.005', credit: 0 }, { debit: 0, credit: 10 }]).balanced).toBe(false);
  });
});
