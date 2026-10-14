import { describe, expect, it } from 'vitest';
import { checkJournalProposal, numbersIn, routeQuestion, ROBOT_STARTERS, unverifiedNumbers } from './robot';

describe('free router', () => {
  it('routes the deterministic questions without the model', () => {
    expect(routeQuestion('Салдо на конто 1200', 2026)).toEqual({ tool: 'account_balance', input: { konto: '1200' } });
    expect(routeQuestion('салдо 1020', 2026)).toEqual({ tool: 'account_balance', input: { konto: '1020' } });
    expect(routeQuestion('Рокови оваа недела', 2026)).toEqual({ tool: 'deadlines', input: { days: 7 } });
    expect(routeQuestion('рокови во наредните 30 дена', 2026)).toEqual({ tool: 'deadlines', input: { days: 30 } });
    expect(routeQuestion('Провери ја фирмата', 2026)).toEqual({ tool: 'health_check', input: {} });
    expect(routeQuestion('Состојба на благајна и жиро сметка', 2026)?.tool).toBe('cash_bank');
    expect(routeQuestion('ДДВ за овој период', 2026)?.tool).toBe('vat_summary');
    expect(routeQuestion('Лагер – вредност и минус залихи', 2026)?.tool).toBe('stock_summary');
    expect(routeQuestion('Бруто биланс', 2026)).toEqual({ tool: 'trial_balance', input: { level: '3' } });
    expect(routeQuestion('бруто биланс за конто 4', 2026)).toEqual({ tool: 'trial_balance', input: { level: '3' } });
    expect(routeQuestion('Плата за март', 2026)).toEqual({ tool: 'payroll_summary', input: { month: '2026-03' } });
    expect(routeQuestion('ИОС на Макпетрол', 2026)).toEqual({ tool: 'partner_card', input: { partner: 'макпетрол' } });
    expect(routeQuestion('ЗДДВ чл. 51', 2026)?.tool).toBe('law_search');
    expect(routeQuestion('најди фактура 15/2026', 2026)).toEqual({ tool: 'find_documents', input: { text: '15/2026' } });
  });
  it('questions that need reasoning go to the agent', () => {
    expect(routeQuestion('Зошто салдото на конто 1200 е толку големо?', 2026)).toBeNull();
    expect(routeQuestion('Предложи налог за амортизација', 2026)).toBeNull();
    expect(routeQuestion('Кои купувачи доцнат со плаќање и треба опомена?', 2026)).toBeNull();
    expect(routeQuestion('', 2026)).toBeNull();
    // a year is not a konto
    expect(routeQuestion('салдо во 2026', 2026)).toBeNull();
  });
  it('the first starters are free', () => {
    for (const s of ROBOT_STARTERS.slice(0, 6)) expect(routeQuestion(s, 2026)).not.toBeNull();
  });
});

describe('journal proposal check', () => {
  const chart = new Set(['1020', '1200', '7400', '4440']);
  it('a balanced journal on existing kontos passes', () => {
    const r = checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1200', debit: 1180, partnerId: 'p1' }, { konto: '7400', credit: '1.180,00'.replace('.', '') }] }, chart, 2026);
    expect(r.ok).toBe(true);
    expect([r.debit, r.credit, r.diff]).toEqual([1180, 1180, 0]);
  });
  it('an unbalanced journal is rejected with the difference', () => {
    const r = checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1020', debit: 100 }, { konto: '7400', credit: 99.99 }] }, chart, 2026);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/не е изедначен.*0\.01/);
  });
  it('unknown konto, missing partner, both sides, negative amounts, wrong year, one line', () => {
    expect(checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '9999', debit: 1 }, { konto: '7400', credit: 1 }] }, chart, 2026).errors.join()).toMatch(/9999 не постои/);
    expect(checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1200', debit: 1 }, { konto: '7400', credit: 1 }] }, chart, 2026).errors.join()).toMatch(/бара комитент/);
    expect(checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1020', debit: 1, credit: 1 }, { konto: '7400', credit: 0 }] }, chart, 2026).ok).toBe(false);
    expect(checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1020', debit: -5 }, { konto: '7400', credit: -5 }] }, chart, 2026).errors.join()).toMatch(/позитивни/);
    expect(checkJournalProposal({ date: '2025-05-01', lines: [{ konto: '1020', debit: 1 }, { konto: '7400', credit: 1 }] }, chart, 2026).errors.join()).toMatch(/работната година/);
    expect(checkJournalProposal({ date: '2026-05-01', lines: [{ konto: '1020', debit: 1 }] }, chart, 2026).ok).toBe(false);
  });
});

describe('amounts in answers must come from tools', () => {
  it('reads Macedonian and plain number formats', () => {
    expect(numbersIn('салдо 1.234.567,89 ден. и 1234567.89')).toEqual(['1234567.89', '1234567.89']);
    expect(numbersIn('300,5')).toEqual(['300.50']);
  });
  it('flags an invented amount, accepts tool amounts, dates, years and small numbers', () => {
    const tools = [JSON.stringify({ closing: 1234567.89, debit: 5000 })];
    expect(unverifiedNumbers('Салдото е 1.234.567,89 ден., должи 5.000,00 ден., рок 25.10.2026, член 51, година 2026.', tools)).toEqual([]);
    expect(unverifiedNumbers('Салдото е 1.234.999,00 ден.', tools)).toEqual(['1.234.999,00']);
    expect(unverifiedNumbers('Должи -5.000,00', tools)).toEqual([]);
  });
});
