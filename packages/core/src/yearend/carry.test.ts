import { describe, expect, it } from 'vitest';
import {
  CARRY_STAT_REASON, carryCandidateAccounts, carryEvidence, carryOneLine, carryPlan, carryStatAccount, parseCarryStatPrefixes, type CarryLedgerLine,
} from './carry';

const L = (account: string, debit: number, credit: number, extra: Partial<CarryLedgerLine> = {}): CarryLedgerLine => ({ account, debit, credit, ...extra });

// a closed year: sales to two customers, a supplier, a loan with a partner, cash, result 951, classes 4/7 closed
const year: CarryLedgerLine[] = [
  L('1200', 1180, 0, { partnerId: 'A', doc: 'F1' }), L('1200', 590, 0, { partnerId: 'B', doc: 'F2' }), L('1200', 0, 590, { partnerId: 'B', doc: 'F2' }),
  L('1000', 590, 0), L('7600', 0, 1500), L('2300', 0, 270),
  L('2200', 0, 300, { partnerId: 'S' }), L('4000', 300, 0),
  L('1000', 1000, 0), L('2610', 0, 1000, { partnerId: 'BANK' }), // loan with a partner (26x)
  L('0220', 500, 0, { locationId: 'LOC1' }), L('2200', 0, 500, { partnerId: 'S' }),
  // close: 7600 → 8000, 4000 → 8000, 8000 → 8200 → 951
  L('7600', 1500, 0), L('8000', 0, 1500), L('8000', 300, 0), L('4000', 0, 300), L('8000', 1200, 0), L('8200', 0, 1200), L('8200', 1200, 0), L('951', 0, 1200),
  // last year's retained profit
  L('950', 0, 100), L('1000', 100, 0),
];

describe('carry-over plan', () => {
  it('carries classes 0,1,2,3,6,9 per konto and per partner (any partner-bearing konto), 951 → 950, location kept', () => {
    const P = carryPlan(year);
    const get = (a: string, p: string | null = null) => P.lines.find((l) => l.account === a && l.partnerId === p);
    expect(get('1200', 'A')?.debit).toBe(1180);
    expect(get('1200', 'B')).toBeUndefined(); // zero balance
    expect(get('2200', 'S')?.credit).toBe(800);
    expect(get('2610', 'BANK')?.credit).toBe(1000); // loan split by partner too
    expect(get('950')?.credit).toBe(1300); // 100 + 1200 from 951
    expect(get('951')).toBeUndefined();
    expect(P.lines.find((l) => l.account === '0220')?.locationId).toBe('LOC1');
    expect(P.lines.some((l) => /^[4578]/.test(l.account))).toBe(false);
    expect(P.debit).toBe(P.credit);
    const why = (a: string) => P.rows.find((r) => r.account === a)?.reason ?? '';
    expect(why('7600')).toMatch(/класа 7/);
    expect(why('4000')).toMatch(/класа 4/);
    expect(why('8000')).toMatch(/класа 8/);
    expect(P.rows.find((r) => r.account === '1200' && r.partnerId === 'B')?.reason).toMatch(/нулто салдо/);
  });

  it('statistical VAT-base accounts (994 / 999) are never carried; the rule is marked so the screen shows it as correct', () => {
    const y = [...year, L('994018', 1000, 0), L('999018', 0, 1000), L('99408', 50, 0), L('9990018', 0, 50)];
    const P = carryPlan(y);
    expect(P.lines.some((l) => /^99[49]/.test(l.account))).toBe(false);
    expect(P.debit).toBe(P.credit);
    const r = P.rows.find((x) => x.account === '994018')!;
    expect([r.target, r.rule, r.reason]).toEqual([null, 'stat', CARRY_STAT_REASON]);
    expect(P.rows.find((x) => x.account === '9990018')?.rule).toBe('stat');
    expect(P.rows.find((x) => x.account === '7600')?.rule).toBe('class');
    expect(P.rows.find((x) => x.account === '1200' && x.partnerId === 'B')?.rule).toBe('zero');
    // a firm with its own list: only 994 → the 999 lines are carried (and the opening is then unbalanced — its choice)
    expect(carryPlan(y, { statPrefixes: ['994'] }).lines.some((l) => l.account === '999018')).toBe(true);
    expect(carryCandidateAccounts(y)).not.toContain('994018');
    expect(parseCarryStatPrefixes('994, 999;x 12 999')).toEqual(['12', '994', '999']);
    expect(carryStatAccount('9990018')).toBe(true);
    expect(carryStatAccount('9000')).toBe(false);
    // evidence: rule-based rows carry their rule; a stat row still in an old opening is a real difference
    const E = carryEvidence(P, P.lines, { opened: true });
    expect(E.totals.ok).toBe(true);
    expect(E.rows.find((x) => x.account === '994018')).toMatchObject({ carried: false, status: 'note', rule: 'stat' });
    const old = carryEvidence(P, [...P.lines, { account: '994018', debit: 1000, credit: 0 }, { account: '999018', debit: 0, credit: 1000 }], { opened: true });
    expect(old.rows.find((x) => x.account === '994018')).toMatchObject({ status: 'missing', rule: null, opening: 1000 });
    expect(old.rows.filter((x) => x.account === '994018')).toHaveLength(1);
  });

  it('splits 12x/22x per open document when byDoc is on', () => {
    const y = [L('1200', 100, 0, { partnerId: 'A', doc: 'F1' }), L('1200', 50, 0, { partnerId: 'A', doc: 'F2' }), L('950', 0, 150)];
    const P = carryPlan(y, { byDoc: true });
    expect(P.lines.filter((l) => l.account === '1200').map((l) => [l.doc, l.debit])).toEqual([['F1', 100], ['F2', 50]]);
    expect(carryPlan(y).lines.filter((l) => l.account === '1200')).toHaveLength(1);
  });

  it('falls back to the synthetic account when the analytic one is missing; blocks when none exists', () => {
    const y = [L('100005', 100, 0), L('950', 0, 100)];
    expect(carryCandidateAccounts(y)).toEqual(['100', '1000', '10000', '100005', '950']);
    const P = carryPlan(y, { missingAccounts: ['100005', '10000'] });
    expect(P.lines.find((l) => l.account === '1000')?.debit).toBe(100);
    expect(P.rows.find((r) => r.account === '100005')?.reason).toMatch(/пренесено на 1000/);
    const B = carryPlan(y, { missingAccounts: ['100005', '10000', '1000', '100'] });
    expect(B.blocked).toEqual(['100005']);
  });

  it('evidence: ✓ when the opening equals the closing, reasons otherwise; one row carried without re-running', () => {
    const P = carryPlan(year);
    const none = carryEvidence(P, [], { opened: false });
    expect(none.rows.filter((r) => r.carried).every((r) => r.status === 'missing')).toBe(true);
    const full = carryEvidence(P, P.lines, { opened: true });
    expect(full.totals.ok).toBe(true);
    expect(full.totals.closingAssets).toBe(full.totals.closingLiabilities);
    expect(full.rows.filter((r) => r.carried && r.status === 'missing')).toHaveLength(0);
    // the partner line of S was carried without partner (e.g. by hand): carry just that row
    const actual = P.lines.map((l) => (l.account === '2200' ? { ...l, partnerId: null } : l));
    const ev = carryEvidence(P, actual, { opened: true });
    expect(ev.rows.find((r) => r.account === '2200' && r.partnerId === 'S')?.status).toBe('missing');
    const r = carryOneLine(P, actual, { account: '2200', partnerId: 'S', doc: null, locationId: null });
    expect('lines' in r).toBe(true);
    if ('lines' in r) expect(carryEvidence(P, r.lines, { opened: true }).totals.ok).toBe(true);
  });
});
