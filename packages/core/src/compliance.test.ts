import { describe, expect, it } from 'vitest';
import {
  complianceRows, complianceScore, deadlineFrom, deadlineState, deletionVerdict, dsrVerdict, fmtCents, fromCents, invalidDocIssues, invoiceLegalIssues, looksLegalEntity,
  isLastInSeries, isWorkday, kontrolaDeadlines, kontrolaObjectionDraft, kontrolaSummary, numberGapWarning, numberingIssues,
  recommendFinding, retentionUntil, toCents, underRetention, vatRatesOn, type ComplianceFacts, type Finding, type InvoiceLegalInput,
} from './compliance';

describe('cents', () => {
  it('parses Macedonian and plain amounts exactly', () => {
    expect(toCents('1.234.567,89')).toBe(123456789);
    expect(toCents('1234.5')).toBe(123450);
    expect(toCents('-10,05')).toBe(-1005);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBe(0);
    expect(() => toCents('12a')).toThrow();
    expect(fromCents(-1005)).toBe('-10.05');
    expect(fmtCents(123456789)).toBe('1.234.567,89');
  });
});

describe('deadlines', () => {
  it('knows weekends and public holidays', () => {
    expect(isWorkday('2026-10-09')).toBe(true); // Friday
    expect(isWorkday('2026-10-10')).toBe(false); // Saturday
    expect(isWorkday('2026-10-23')).toBe(false); // Ден на македонската револуционерна борба
    expect(isWorkday('2026-12-08')).toBe(false); // Св. Климент Охридски
  });
  it('counts days from the day after delivery and rolls a non-working last day to the next working day', () => {
    expect(deadlineFrom('2026-03-02', 15, 'days')).toBe('2026-03-17'); // Tuesday
    // 15 days from 2026-10-08 → 2026-10-23 (holiday, Friday) → Monday 26.10
    expect(deadlineFrom('2026-10-08', 15, 'days')).toBe('2026-10-26');
    // 8 days from Friday 2026-05-15 → Saturday 23.05 → Monday 25.05 (24.05 holiday is a Sunday → moved to Monday 25.05) → 26.05
    expect(deadlineFrom('2026-05-15', 8, 'days')).toBe('2026-05-26');
  });
  it('counts working days only', () => {
    // delivered Thursday 2026-10-08; 11.10 is a Sunday holiday → Monday 12.10 off: Fri 9 (1), Tue 13 (2), Wed 14 (3)
    expect(deadlineFrom('2026-10-08', 3, 'workdays')).toBe('2026-10-14');
    expect(deadlineFrom('2026-03-05', 3, 'workdays')).toBe('2026-03-10');
  });
  it('months clamp to the month end', () => {
    expect(deadlineFrom('2026-01-31', 1, 'months')).toBe('2026-03-02'); // 28.02 is Saturday → Monday 02.03
  });
  it('rejects bad input and grades the state', () => {
    expect(() => deadlineFrom('31.12.2026', 8, 'days')).toThrow();
    expect(() => deadlineFrom('2026-01-01', 0, 'days')).toThrow();
    expect(deadlineState('2026-10-11', '2026-10-10')).toBe('expired');
    expect(deadlineState('2026-10-11', '2026-10-11')).toBe('today');
    expect(deadlineState('2026-10-11', '2026-10-13')).toBe('urgent');
    expect(deadlineState('2026-10-11', '2026-10-30')).toBe('open');
  });
});

const base: InvoiceLegalInput = {
  kind: 'invoice', number: '001/2026', date: '2026-03-10', today: '2026-03-10',
  firm: { name: 'Фирма ДООЕЛ', address: 'Ул. 1', city: 'Скопје', edb: '4030000000001', vatRegistered: true },
  partner: { name: 'Купувач ДОО', address: 'Ул. 2', city: 'Битола', edb: '4002000000002', vatRegistered: true, foreign: false },
  lines: [{ name: 'Стока', qty: 1, price: 100, rate: 18 }],
};
const codes = (x: InvoiceLegalInput) => invoiceLegalIssues(x).map((i) => `${i.code}:${i.sev}`);

describe('invoice mandatory elements', () => {
  it('a complete invoice has no issues', () => expect(invoiceLegalIssues(base)).toEqual([]));
  it('blocks a missing seller ЕДБ, a VAT buyer without ЕДБ and lines without description', () => {
    expect(codes({ ...base, firm: { ...base.firm, edb: '' } })).toContain('seller_edb:block');
    expect(codes({ ...base, partner: { ...base.partner!, edb: null } })).toContain('buyer_edb:warn');
    expect(codes({ ...base, partner: { ...base.partner!, edb: null, vatRegistered: false } })).toEqual(['buyer_edb_np:warn']);
    expect(codes({ ...base, lines: [{ name: '', qty: 1, price: 5, rate: 18 }] })).toContain('line_name:block');
    expect(codes({ ...base, number: '' })).toContain('number:block');
  });
  it('a buyer known only by name is not incomplete: no block, no print banner', () => {
    const only = { ...base, partner: { name: 'Купувач ДООЕЛ', address: null, city: null, edb: null, vatRegistered: true, foreign: false } };
    expect(invoiceLegalIssues(only).filter((i) => i.sev === 'block')).toEqual([]);
    expect(codes(only)).toContain('buyer_address:warn');
    expect(invalidDocIssues(invoiceLegalIssues(only))).toEqual([]);
  });
  it('the print banner is only for a missing number, date or lines', () => {
    const inv = (x: Partial<InvoiceLegalInput>) => invalidDocIssues(invoiceLegalIssues({ ...base, ...x })).map((i) => i.code);
    expect(inv({ number: '' })).toEqual(['number']);
    expect(inv({ date: '' })).toEqual(['date']);
    expect(inv({ lines: [] })).toEqual(['lines']);
    expect(inv({ firm: { ...base.firm, edb: '' } })).toEqual([]);
    expect(inv({ kind: 'proforma', number: '' })).toEqual([]);
  });
  it('recognises a legal entity by the form in its name', () => {
    expect(['Купувач ДООЕЛ Скопје', 'КУПУВАЧ ДОО', 'Макпетрол АД', 'Марко ТП', 'Фирма доо'].every(looksLegalEntity)).toBe(true);
    expect(['Марко Марковски', 'Градинарство', 'Адриана', ''].some(looksLegalEntity)).toBe(false);
  });
  it('a non-VAT firm may not charge VAT', () => {
    expect(codes({ ...base, firm: { ...base.firm, vatRegistered: false } })).toContain('vat_not_registered:block');
    expect(codes({ ...base, firm: { ...base.firm, vatRegistered: false }, lines: [{ name: 'x', qty: 1, price: 1, rate: 0 }] })).not.toContain('vat_not_registered:block');
  });
  it('checks the rate against the date of supply', () => {
    expect(vatRatesOn('2018-05-01')).not.toContain(10);
    expect(vatRatesOn('2026-05-01')).toContain(10);
    expect(codes({ ...base, date: '2018-05-01', today: '2018-05-01', lines: [{ name: 'Ручек', qty: 1, price: 100, rate: 10 }] })).toContain('rate_date:warn');
  });
  it('reverse charge only to a domestic VAT payer; credit notes need the reference', () => {
    expect(codes({ ...base, art32: true, partner: { ...base.partner!, vatRegistered: false } })).toContain('art32_buyer:block');
    expect(codes({ ...base, kind: 'credit' })).toContain('credit_ref:block');
    expect(codes({ ...base, kind: 'credit', ref: { number: '001/2026', date: '2026-03-01' } })).toEqual([]);
  });
  it('the invoice is due within 5 working days of the supply', () => {
    expect(codes({ ...base, pdate: '2026-03-02', date: '2026-03-09' })).toEqual([]);
    expect(codes({ ...base, pdate: '2026-03-02', date: '2026-03-10' })).toEqual(['late_issue:warn']);
  });
  it('0% without the exemption article is a warning; proformas never block', () => {
    expect(codes({ ...base, lines: [{ name: 'x', qty: 1, price: 1, rate: 0 }] })).toEqual(['exempt_ref:warn']);
    expect(codes({ ...base, lines: [{ name: 'x', qty: 1, price: 1, rate: 0 }], note: 'Ослободено согласно член 23' })).toEqual([]);
    expect(invoiceLegalIssues({ ...base, kind: 'proforma', firm: { ...base.firm, edb: '' } }).every((i) => i.sev === 'warn')).toBe(true);
  });
});

describe('numbering', () => {
  const D = (n: string, d: string, o: { kind?: string; cancelled?: boolean } = {}) => ({ number: n, date: d, ...o });
  it('finds gaps, duplicates, a late start and chronology breaks per series and kind', () => {
    const I = numberingIssues([D('001/2026', '2026-01-02'), D('002/2026', '2026-01-03'), D('004/2026', '2026-01-04'), D('F-1', '2026-01-02'), D('F-2', '2026-01-01'),
      D('001/2026', '2026-01-05', { kind: 'credit' }), D('001/2026', '2026-01-06', { kind: 'credit' }), D('009/2025', '2025-12-31')], 2026);
    expect(I.map((i) => `${i.kind}|${i.series}|${i.code}`).sort()).toEqual(['credit||duplicate', 'invoice|F-|order', 'invoice||gap'].sort());
    expect(I.find((i) => i.code === 'gap')!.numbers).toEqual(['3']);
    expect(numberingIssues([D('005', '2026-02-01'), D('006', '2026-02-02')], 2026)[0]!.text).toMatch(/првиот број/);
  });
  it('cancelled invoices keep the number (no gap)', () => {
    expect(numberingIssues([D('1', '2026-01-01'), D('2', '2026-01-02', { cancelled: true }), D('3', '2026-01-03')], 2026)).toEqual([]);
  });
  it('warns when a typed number skips the sequence or goes back in time', () => {
    const E = [D('001/2026', '2026-01-02'), D('002/2026', '2026-01-10')];
    expect(numberGapWarning(E, '003/2026', '2026-01-10')).toBeNull();
    expect(numberGapWarning(E, '005/2026', '2026-01-10')).toMatch(/003\b|3–4/);
    expect(numberGapWarning(E, '003/2026', '2026-01-05')).toMatch(/постар датум/);
    expect(isLastInSeries(E, '002/2026', '2026-01-10')).toBe(true);
    expect(isLastInSeries(E, '001/2026', '2026-01-02')).toBe(false);
  });
});

describe('retention', () => {
  it('counts from the end of the business year; payroll and annual accounts are permanent', () => {
    expect(retentionUntil('2016-05-10', 'books')).toBe('2026-12-31');
    expect(underRetention('2016-05-10', 'books', '2027-01-01')).toBe(false);
    expect(underRetention('2016-05-10', 'books', '2026-12-31')).toBe(true);
    expect(retentionUntil('2001-01-01', 'payroll')).toBeNull();
    expect(underRetention('1990-01-01', 'annual', '2026-01-01')).toBe(true);
  });
  it('turns deletion of an issued invoice in the middle of the series into a cancellation', () => {
    const t = { kind: 'invoice' as const, date: '2026-02-01', today: '2026-03-01' };
    expect(deletionVerdict({ ...t, status: 'posted', lastInSeries: false }).action).toBe('cancel');
    expect(deletionVerdict({ ...t, status: 'posted', lastInSeries: true }).action).toBe('delete');
    expect(deletionVerdict({ ...t, status: 'pending', lastInSeries: false }).action).toBe('delete');
    expect(deletionVerdict({ ...t, status: 'draft', lastInSeries: false, nonTax: true }).action).toBe('delete');
    expect(deletionVerdict({ ...t, status: 'draft', lastInSeries: false, cancelled: true }).action).toBe('block');
  });
});

describe('privacy', () => {
  it('erasure keeps what the law obliges us to keep', () => {
    const v = dsrVerdict('erase', [{ kind: 'payroll', lastDate: '2015-01-31' }, { kind: 'invoice', lastDate: '2012-03-01' }], '2026-10-11');
    expect(v.outcome).toBe('partial');
    expect(v.keep.map((k) => k.kind)).toEqual(['payroll']);
    expect(dsrVerdict('erase', [{ kind: 'invoice', lastDate: '2012-03-01' }], '2026-10-11').outcome).toBe('grant');
    expect(dsrVerdict('erase', [{ kind: 'payroll', lastDate: '2025-01-31' }], '2026-10-11').outcome).toBe('refuse');
    expect(dsrVerdict('access', [{ kind: 'payroll', lastDate: '2025-01-31' }], '2026-10-11').outcome).toBe('grant');
  });
});

describe('inspections (kontrola)', () => {
  const F: Finding[] = [
    { no: 1, area: 'vat', text: 'Неосновано одбиен претходен данок', claimed: 50_000_00, interest: 2_000_00, ours: 10_000_00 },
    { no: 2, area: 'pit', text: 'Неплатен данок на бонус', claimed: 12_000_00, verdict: 'correct' },
    { no: 3, area: 'cash', text: 'Плаќање во готово над лимит', claimed: 0, fine: 500_00, verdict: 'incorrect', officeOk: true, systemError: false },
    { no: 4, area: 'books', text: 'Неевидентирана фактура', claimed: 3_000_00 },
  ];
  it('derives the recommendation per finding', () => {
    expect(F.map(recommendFinding)).toEqual(['partial', 'accept', 'object', 'review']);
    expect(recommendFinding({ ...F[0]!, ours: 50_000_50 })).toBe('accept'); // within 1 denar
  });
  it('aggregates amounts exactly and gives the overall recommendation', () => {
    const S = kontrolaSummary(F);
    expect(S).toMatchObject({ n: 4, claimed: 65_000_00, interest: 2_000_00, fine: 500_00, total: 67_500_00, ours: 10_000_00, claimedRecalc: 50_000_00, diff: 40_000_00, overall: 'partial' });
    expect(S.disputed).toBe(40_000_00 + 500_00);
    expect(S.accepted).toBe(67_500_00 - 40_500_00);
    expect(S.byVerdict).toEqual({ correct: 1, partly: 0, incorrect: 1, unclear: 0, none: 2 });
    expect(kontrolaSummary([]).overall).toBe('review');
    expect(kontrolaSummary([F[1]!]).overall).toBe('accept');
  });
  it('tracks the remedy deadline of the act', () => {
    const [d] = kontrolaDeadlines('ujp', 'reshenie', '2026-10-08', '2026-10-11');
    expect(d!.remedy.name).toBe('Жалба');
    expect(d!.due).toBe('2026-10-26');
    expect(d!.state).toBe('open');
    expect(kontrolaDeadlines('ujp', 'reshenie', null, '2026-10-11')).toEqual([]);
    // the deadline from the act's „правна поука“ prevails
    expect(kontrolaDeadlines('dpi', 'reshenie', '2026-10-08', '2026-10-11', '2026-10-16')[0]).toMatchObject({ due: '2026-10-16', override: true });
    expect(kontrolaDeadlines('dpi', 'reshenie', '2026-10-08', '2026-10-11')[0]).toMatchObject({ due: '2026-10-26' }); // ЗИН чл. 84: 15 days
    expect(kontrolaDeadlines('dzlp', 'reshenie', '2026-10-08', '2026-10-11')[0]!.remedy.name).toBe('Тужба');
    // УЈП record: 8 days (ЗДП чл. 102 sets none; the act's own deadline overrides)
    expect(kontrolaDeadlines('ujp', 'zapisnik', '2026-10-08', '2026-10-14')[0]).toMatchObject({ due: '2026-10-16', state: 'urgent' });
  });
  it('drafts the objection with the disputed findings only', () => {
    const d = kontrolaObjectionDraft({ auth: 'ujp', doc: 'reshenie', docNo: '13-123/1', docDate: '2026-10-01', delivered: '2026-10-08', firm: { name: 'Фирма ДООЕЛ', edb: '4030000000001', city: 'Скопје' }, findings: F, today: '2026-10-11' });
    expect(d.title).toBe('ЖАЛБА');
    expect(d.deadline).toBe('2026-10-26');
    const txt = d.blocks.flatMap((b) => b.p).join('\n');
    expect(txt).toMatch(/1\. Наод: Неосновано одбиен/);
    expect(txt).toMatch(/3\. Наод: Плаќање во готово/);
    expect(txt).not.toMatch(/Неплатен данок на бонус/);
    expect(txt).toMatch(/40\.500,00 ден\./);
    expect(txt).toMatch(/не го одлага извршувањето/);
  });
});

describe('compliance dashboard', () => {
  const facts: ComplianceFacts = {
    today: '2026-10-11', year: 2026,
    firm: { name: 'Ф', edb: '4030000000001', city: 'Скопје', vatRegistered: true, vatPeriod: 'quarter', lockDate: '2025-12-31' },
    turnoverPrev: 30_000_000, invoiceIssues: [], invoiceCount: 3, numbering: [], cancelledCount: 0, vatMissing: [], payrollMissing: [], payrollRaised: 0,
    cash: { single: 0, monthly: [], negativeDays: 0 }, serviceContract: true, dpa: true, activities: 4, dsrOpen: 0, dsrOverdue: 0, breachOpen: 0, breachOverdue: 0,
    auditImmutable: true, kontrolaExpired: 0, kontrolaUrgent: 0, kontrolaOpen: 0, actionsOverdue: 0,
  };
  it('flags a quarterly filer above the monthly threshold', () => {
    const R = complianceRows(facts);
    expect(R.find((r) => r.id === 'vat_period')!.s).toBe('bad');
    expect(complianceRows({ ...facts, firm: { ...facts.firm, vatPeriod: 'month' } }).find((r) => r.id === 'vat_period')!.s).toBe('ok');
  });
  it('flags a non-VAT firm above the registration threshold, missing DPA and expired inspection deadlines', () => {
    const R = complianceRows({ ...facts, firm: { ...facts.firm, vatRegistered: false }, turnoverPrev: 2_500_000, dpa: false, kontrolaExpired: 1 });
    expect(R.find((r) => r.id === 'vat_reg')!.s).toBe('bad');
    expect(R.find((r) => r.id === 'dpa')!.s).toBe('bad');
    expect(R.find((r) => r.id === 'kontrola')!.s).toBe('bad');
    const S = complianceScore(R);
    expect(S.bad).toBeGreaterThanOrEqual(3);
    expect(S.ok + S.warn + S.bad + S.todo + S.na).toBe(R.length);
  });
});
