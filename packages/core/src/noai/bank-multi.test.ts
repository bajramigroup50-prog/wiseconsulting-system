import { describe, expect, it } from 'vitest';
import { statementsFromRead, statementNoRange, readStatementNo } from '../ai/bank';
import { splitStatementByDate } from '../bank/statements';
import { statementProblems } from '../bank-parsers';
import { MULTI_ACCOUNT, multiStatementItems } from './bank-multi.fixtures';
import { splitPdfStatements, statementFromPdfItems, statementsFromPdfItems, statementTitleKey } from './bank';

describe('PDF with several daily statements (Комерцијална layout, synthetic)', () => {
  const items = multiStatementItems();

  it('splits by the statement title / footer into 3 statements', () => {
    expect(splitPdfStatements(items)).toHaveLength(3);
    expect(statementTitleKey('Извод за промените и состојбата на сметката за ден 07.10.2026, број на извод 161')).toBe('n161');
    expect(statementTitleKey('Сметка: 300000001234567 Извод број:161 Датум на промет: 07.10.2026')).toBe('n161');
    expect(statementTitleKey('Извод бр. 12 од 05.03.2026')).toBe('n12');
    expect(statementTitleKey('Датум: 15.10.2026')).toBeNull();
  });

  it('each statement: own number, date, account, balances, turnover; reconciles; every row read', () => {
    const S = statementsFromPdfItems(items);
    expect(S.map((s) => s.number)).toEqual(['161', '162', '163']);
    expect(S.map((s) => s.items!.map((x) => x.date))).toEqual([['2026-10-07', '2026-10-07'], ['2026-10-09'], ['2026-10-10']]);
    expect(S.map((s) => s.account)).toEqual([MULTI_ACCOUNT, MULTI_ACCOUNT, MULTI_ACCOUNT]);
    expect(S.map((s) => [s.openingBalance, s.closingBalance])).toEqual([[5000, 9500], [9500, 7500], [7500, 7440]]);
    expect(S.map((s) => [s.totalDebit, s.totalCredit])).toEqual([[0, 4500], [2000, 0], [60, 0]]);
    expect(S.map((s) => s.items!.map((x) => x.amount))).toEqual([[1200, 3300], [-2000], [-60]]);
    for (const s of S) { expect(s.balanced).toBe(true); expect(s.blocking).toBeUndefined(); expect(s.warnings).toBeUndefined(); }
  });

  it('code → osnov, ПБО/ПБЗ → ref, counterparty account, provision as a fee (not a movement)', () => {
    const S = statementsFromPdfItems(items);
    const [a, b] = S[0]!.items!;
    expect(a).toMatchObject({ name: 'ПРИМЕР ТРЕЈД ДООЕЛ СКОПЈЕ', account: '300000009990001', code: '220', ref: '0105/2026 / 0105/2026', purpose: '0105/2026' });
    expect(b).toMatchObject({ code: '220', account: '210000009990002', ref: 'FAKTURA 12 / FAKTURA 12', purpose: 'Плаќање по фактура 12/2026 за извршени услуги' });
    expect(S[1]!.items![0]).toMatchObject({ code: '903', fee: 18, amount: -2000, account: '270000009990003' });
    expect(S[2]!.items![0]).toMatchObject({ code: '666', name: 'БАНКА ПРИМЕР АД СКОПЈЕ - ПРОВИЗИЈА', amount: -60 });
    expect(S[2]!.items![0]!.fee).toBeUndefined();
  });

  it('the read: statements kept apart, no range number; import statements carry 161/162/163', () => {
    const r = statementFromPdfItems(items)!;
    expect(r.number).toBe('');
    expect(r.balanced).toBe(true);
    expect(r.statements).toHaveLength(3);
    expect(r.items!.map((x) => x.stmtNo)).toEqual(['161', '161', '162', '163']);
    const st = statementsFromRead(JSON.parse(JSON.stringify(r)));
    expect(st.map((s) => [s.no, s.date, s.opening, s.closing, s.debit, s.credit, s.lines.length])).toEqual([
      ['161', '2026-10-07', 500000, 950000, 0, 450000, 2],
      ['162', '2026-10-09', 950000, 750000, 200000, 0, 1],
      ['163', '2026-10-10', 750000, 744000, 6000, 0, 1],
    ]);
    expect(st[1]!.lines[0]).toMatchObject({ osnov: '903', iban: '270000009990003', fee: 1800 });
    for (const s of st) expect(statementProblems(s)).toEqual([]);
    expect(st.flatMap(splitStatementByDate).map((d) => d.no)).toEqual(['161', '162', '163']);
  });

  it('a statement that does not reconcile is blocking', () => {
    const bad = items.map((x) => (x.page === 2 && x.s === '2,000.00' && x.y > 260 && x.y < 280 ? { ...x, s: '2,100.00' } : x));
    const S = statementsFromPdfItems(bad);
    expect(S[1]!.balanced).toBe(false);
    expect(S[1]!.blocking!.join(' ')).toMatch(/Салдата не се совпаѓаат/);
    expect(S[0]!.blocking).toBeUndefined();
    const r = statementFromPdfItems(bad)!;
    expect(r.balanced).toBe(false);
    expect(r.blocking!.join(' ')).toMatch(/Извод бр\. 162/);
  });
});

describe('AI read of several statements', () => {
  it('`statements` → one statement each with its own number', () => {
    const S = statementsFromRead({ account: '300000001234567', statements: [
      { number: '161', openingBalance: 100, closingBalance: 150, items: [{ date: '2026-10-07', amount: 50 }] },
      { number: '162', openingBalance: 150, closingBalance: 120, items: [{ date: '2026-10-09', amount: -30, code: '903', account: '270000009990003' }] },
    ] });
    expect(S.map((s) => [s.no, s.account, s.opening, s.closing])).toEqual([['161', '300000001234567', 10000, 15000], ['162', '300000001234567', 15000, 12000]]);
    expect(S[1]!.lines[0]).toMatchObject({ osnov: '903', iban: '270000009990003' });
  });

  it('a range „161-163“ is never a statement number: the days get 161, 162, 163', () => {
    expect(statementNoRange('161-163')).toEqual([161, 163]);
    expect(readStatementNo('161-163')).toBe('');
    expect(readStatementNo('2026105/1')).toBe('105');
    const [st] = statementsFromRead({ number: '161-163', items: [
      { date: '2026-10-07', amount: 1 }, { date: '2026-10-07', amount: 2 }, { date: '2026-10-09', amount: -3 }, { date: '2026-10-10', amount: -1 },
    ] });
    expect(st!.no).toBe('');
    expect(splitStatementByDate(st!).map((d) => [d.date, d.no])).toEqual([['2026-10-07', '161'], ['2026-10-09', '162'], ['2026-10-10', '163']]);
  });
});
