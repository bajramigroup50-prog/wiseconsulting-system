import { describe, expect, it } from 'vitest';
import { buildClientReport, changeLines, clientReportHtml, clientReportPrompt, ledgerTotals, monthBounds, moneyAt, payablesAt, prevMonth, receivablesAt } from './client-report';
import { captureRoute, captureScale, captureStatus, captureSubject, isCaptureKind } from './capture';
import { klAllowedViews, klLang } from './portal';

describe('monthly client report — deterministic numbers', () => {
  it('month bounds and the previous month (across the year)', () => {
    expect(monthBounds('2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(monthBounds('2028-02')[1]).toBe('2028-02-29');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-10')).toBe('2026-09');
  });

  it('revenue / expenses by class, year-close journal and other months excluded; money from accounts 10…', () => {
    const L = [
      { account: '7400', debit: 0, credit: 1000, date: '2026-09-02' },
      { account: '7000', debit: 300, credit: 0, date: '2026-09-02' }, // cost of goods sold = expense
      { account: '4200', debit: 200, credit: 0, date: '2026-09-30' },
      { account: '7400', debit: 1000, credit: 0, date: '2026-09-30', kind: 'close' },
      { account: '4200', debit: 999, credit: 0, date: '2026-10-01' },
      { account: '1000', debit: 500, credit: 0, date: '2026-01-01', kind: 'open' },
      { account: '1020', debit: 0, credit: 100, date: '2026-09-15' },
      { account: '1000', debit: 50, credit: 0, date: '2025-12-31' }, // previous year: not this year's money
    ];
    expect(ledgerTotals(L, '2026-09-01', '2026-09-30')).toEqual({ rev: 1000, exp: 500 });
    expect(moneyAt(L, '2026-09-30')).toBe(400);
    expect(moneyAt(L, '2026-08-31')).toBe(500);
  });

  it('receivables older than 60 days by due date (else the date), payables past due', () => {
    const D = [
      { remaining: 100, date: '2026-07-01', due: '2026-07-31' }, // 61 days at 30.09
      { remaining: 200, date: '2026-07-01', due: '2026-08-01' }, // 60 days: not over
      { remaining: 50, date: '2026-07-20', due: null },
      { remaining: 0, date: '2026-01-01', due: null },
      { remaining: 999, date: '2026-10-01', due: null }, // after the month
    ];
    expect(receivablesAt(D, '2026-09-30')).toEqual({ total: 350, over60: 150, n60: 2 });
    expect(payablesAt(D, '2026-09-30')).toEqual({ total: 350, overdue: 350 });
  });

  it('report, changes vs last month, texts mk / sq, AI prompt with the numbers only', () => {
    const d = buildClientReport({
      period: '2026-01',
      lines: [{ account: '7400', debit: 0, credit: 2000, date: '2026-01-10' }, { account: '7400', debit: 0, credit: 1000, date: '2025-12-10' }],
      invoices: [], purchases: [], vat: { period: '2026-Т1', amount: 360, due: '2026-04-25', closed: false, partial: true },
    });
    expect(d.prev).toMatchObject({ period: '2025-12', rev: 1000 });
    expect(d.changes.find((c) => c.key === 'rev')).toMatchObject({ diff: 1000, pct: 100 });
    expect(changeLines(d, 'mk')[0]).toContain('пораст 100 %');
    expect(changeLines(d, 'sq')[0]).toContain('rritje');
    const p = clientReportPrompt(d, 'sq');
    expect(p).toContain('албански');
    expect(p).toContain('"revenue": 2000');
    const h = clientReportHtml(d, { firm: 'Фирма <b>', lang: 'sq', summary: 'Mirë' });
    expect(h).toContain('Raport mujor');
    expect(h).toContain('Фирма &lt;b&gt;');
    expect(h).toContain('deri tani në tremujor');
  });
});

describe('📷 capture', () => {
  it('kind → suggested office route, subject, status, compression scale', () => {
    expect(captureRoute('in')).toEqual({ route: 'purchase', category: null });
    expect(captureRoute('contract')!.route).toBe('dossier');
    expect(captureRoute('xx')).toBeNull();
    expect(isCaptureKind('toString')).toBe(false);
    expect(captureSubject('bank', 2)).toBe('📷 Извод (2 стр.)');
    expect(captureStatus({ done: false })).toBe('received');
    expect(captureScale(4000, 3000)).toBe(0.5);
    expect(captureScale(800, 600)).toBe(1);
  });
  it('every client may open the phone capture and the monthly reports; language defaults to Macedonian', () => {
    expect(klAllowedViews({ on: {} })).toEqual(expect.arrayContaining(['klFoto', 'klIzv']));
    expect(klLang(null)).toBe('mk');
    expect(klLang({ lang: 'sq' })).toBe('sq');
  });
});
