import { describe, expect, it } from 'vitest';
import { rokPaymentEvidence, rokPayPeriods, type RokPayLine } from './office/rokovi';

const K = { profitTax: '2330', contrib: ['2341', '2342', '2343', '2344', '2349'] };
const TR = '100000000063095';
const line = (o: Partial<RokPayLine>): RokPayLine => ({ id: 'l' + Math.random().toString(36).slice(2, 8), date: '2026-10-14', amount: -12000, counterAccount: TR, statementNo: '94', ...o });

describe('📅 deadline paid from the bank statement', () => {
  it('periods of a line: Повикување на број and „за MM/YYYY“; dates are not periods; a span is not monthly', () => {
    expect(rokPayPeriods('аконтација 01092026-30092026')).toEqual(['2026-09']);
    expect(rokPayPeriods('аконтација за 09/2026 од 15.10.2026')).toEqual(['2026-09']);
    expect(rokPayPeriods('данок на добивка 01012025-31122025')).toEqual(['*']);
    expect(rokPayPeriods('плаќање 15.10.2026')).toEqual([]);
  });
  it('advance: Treasury + revenue code 711212 or the words, this month (or late with the period)', () => {
    const e = rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ purpose: 'Аконтација данок на добивка 711212 00' })], K);
    expect(e?.note).toBe('✓ платено (извод бр. 94 од 14.10.2026, 12.000,00 ден.)');
    // late, with the period in the reference
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ date: '2026-11-20', purpose: 'Аконтација на данок на добивка 01092026-30092026' })], K)).not.toBeNull();
    // late without a period: not this deadline
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ date: '2026-11-14', purpose: 'Аконтација на данок на добивка' })], K)).toBeNull();
    // another month's period
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ purpose: 'Аконтација на данок на добивка за 08/2026' })], K)).toBeNull();
  });
  it('advance: never another tax, an inflow, or a non-Treasury payment', () => {
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ purpose: 'ДДВ за 09/2026 714116' })], K)).toBeNull();
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ purpose: 'Данок на добивка годишен 711216', konto: '2330' })], K)).toBeNull();
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ amount: 12000, purpose: 'Аконтација данок на добивка' })], K)).toBeNull();
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ counterAccount: '300000000000001', name: 'Добавувач', purpose: 'аконтација добивка' })], K)).toBeNull();
    // booked on 2330 without text: only on time, and never in March (the annual top-up is due then)
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-09' }, [line({ konto: '2330' })], K)).not.toBeNull();
    expect(rokPaymentEvidence({ type: 'akont', period: '2026-02' }, [line({ date: '2026-03-13', konto: '2330' })], K)).toBeNull();
  });
  it('МПИН: contributions to the Treasury or the payroll payment matched to the month; PIT alone or the net pay is not enough', () => {
    expect(rokPaymentEvidence({ type: 'mpin', period: '2026-09' }, [line({ purpose: 'Придонес за ПИО за 09/2026' })], K)).not.toBeNull();
    expect(rokPaymentEvidence({ type: 'mpin', period: '2026-09' }, [line({ counterAccount: null, name: 'x', konto: '2341', payRef: '2026-09', date: '2026-11-02' })], K)).not.toBeNull();
    expect(rokPaymentEvidence({ type: 'mpin', period: '2026-09' }, [line({ counterAccount: null, konto: '2401', payRef: '2026-09' })], K)).toBeNull();
    expect(rokPaymentEvidence({ type: 'mpin', period: '2026-09' }, [line({ purpose: 'Персонален данок на доход 711111' })], K)).toBeNull();
    const two = rokPaymentEvidence({ type: 'mpin', period: '2026-09' }, [line({ purpose: 'Придонес ПИО', amount: -8000 }), line({ purpose: 'Придонес здравство', amount: -3000 })], K);
    expect(two?.amount).toBe(11000);
  });
});
