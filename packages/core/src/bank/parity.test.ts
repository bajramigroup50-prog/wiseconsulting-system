import { describe, expect, it } from 'vitest';
import { partnerKey, type BankRow } from '../bank-match';
import {
  bankClassifyAnswers, bankClassifyLists, bankCpName, bankKontoName, bookSaldoCur, ownerCheck, ownMatchFirm, partnerFixPlan,
  payNoteCfg, payNoteMail, payNoteRecent, payNoteSummary, posBoxState, posFeeLines, posFeeValid, posSaldo, sameRefKey, sameRefRows,
  statementNumberSuggestions, techAccountKonto, transitOpen, transitResidueLabel, withNote,
} from './parity';

describe('bank account konto (legacy addBankAcct 7203)', () => {
  it('names the chart account after the bank and currency', () => {
    expect(bankKontoName('Халкбанк', 'MKD')).toBe('Трансакциска сметка – Халкбанк');
    expect(bankKontoName('Комерцијална EUR', 'eur')).toBe('Девизна сметка EUR – Комерцијална EUR');
  });
  it('KB special account takes the first free 108x (12677)', () => {
    expect(techAccountKonto(['1000', '1080', '1081'])).toBe('1082');
    expect(techAccountKonto([])).toBe('1080');
  });
});

describe('izvSugg (12392)', () => {
  it('previous known number + distance, else next − distance, else position; per account and year', () => {
    const S = [
      { acct: 'a', date: '2026-01-02', no: '5' }, { acct: 'a', date: '2026-01-03' }, { acct: 'a', date: '2026-01-05', no: '' },
      { acct: 'b', date: '2026-01-02' }, { acct: 'b', date: '2026-01-04', no: '10' },
      { acct: 'c', date: '2026-03-01' }, { acct: 'c', date: '2026-03-02' },
      { acct: 'a', date: '2025-12-30' },
    ];
    expect(statementNumberSuggestions(S)).toEqual({
      'a|2026-01-03': '6', 'a|2026-01-05': '7', 'b|2026-01-02': '9', 'c|2026-03-01': '1', 'c|2026-03-02': '2', 'a|2025-12-30': '1',
    });
  });
  it('non-numeric neighbours do not count; a non-positive guess is skipped', () => {
    expect(statementNumberSuggestions([{ acct: 'a', date: '2026-01-01' }, { acct: 'a', date: '2026-01-02', no: '1' }])).toEqual({});
    expect(statementNumberSuggestions([{ acct: 'a', date: '2026-01-01', no: '12/A' }, { acct: 'a', date: '2026-01-02' }])).toEqual({ 'a|2026-01-02': '2' });
  });
});

describe('bookSaldoCur (12652)', () => {
  it('first statement opening + amounts in currency up to the date', () => {
    const bal = [{ date: '2026-01-10', opening: 100000 }, { date: '2026-01-05', opening: 50000 }];
    const L = [{ date: '2026-01-04', amount: 9, amountCur: 99999 }, { date: '2026-01-05', amount: 1, amountCur: 2000 }, { date: '2026-01-10', amount: 1, amountCur: -500 }, { date: '2026-01-11', amount: 1, amountCur: 7 }];
    expect(bookSaldoCur(bal, L, '2026-01-10')).toBe(51500);
    expect(bookSaldoCur(bal, L, '2026-01-04')).toBeNull();
  });
});

describe('POS (13075–13082)', () => {
  const L = [
    { k: '1200001', date: '2026-01-10', d: 100000, p: 0 }, { k: '1200001', date: '2026-01-12', d: 0, p: 98500 },
    { k: '1200001', date: '2026-01-11', d: 0, p: 0 }, { k: '1200', date: '2026-01-12', d: 0, p: 5000 },
  ];
  it('saldo, last credit date and the fee state', () => {
    const x = posSaldo(L, '1200001');
    expect(x).toEqual({ k: '1200001', d: 100000, p: 98500, s: 1500, last: '2026-01-12' });
    expect(posBoxState(x)).toBe('fee');
    expect(posBoxState(posSaldo(L.slice(0, 1), '1200001'))).toBe('waiting');
    expect(posBoxState(posSaldo([], '1200001'))).toBe('none');
    expect(posBoxState({ ...x, p: 100000, s: 0 })).toBe('closed');
    expect(posBoxState({ ...x, p: 100100, s: -100 })).toBe('over');
    expect(posFeeValid(1500, x)).toBe(true);
    expect(posFeeValid(1502, x)).toBe(false);
    expect(posFeeValid(0, x)).toBe(false);
  });
  it('fee lines: D 4460 / P POS konto with the POS partner', () => {
    expect(posFeeLines(1500, '1200001', 'pp')).toEqual([{ k: '4460', d: 1500, p: 0 }, { k: '1200001', d: 0, p: 1500, partner: 'pp' }]);
  });
});

describe('transit (12764, 12573)', () => {
  it('one-sided days only; small residues of two-sided transfers are left to trResid', () => {
    const L = [
      { k: '1039', date: '2026-02-01', d: 100000, p: 0 },
      { k: '1039', date: '2026-02-02', d: 100000, p: 0 }, { k: '1039', date: '2026-02-02', d: 0, p: 99000 },
      { k: '1009', date: '2026-02-03', d: 0, p: 5000 },
      { k: '1009', date: '2026-02-04', d: 100000, p: 0 }, { k: '1009', date: '2026-02-04', d: 0, p: 50000 },
    ];
    expect(transitOpen(L)).toEqual([
      { k: '1039', date: '2026-02-01', r: 100000 }, { k: '1009', date: '2026-02-03', r: -5000 }, { k: '1009', date: '2026-02-04', r: 50000 },
    ]);
    expect(transitResidueLabel(5)).toBe('расход (4810)');
    expect(transitResidueLabel(-5)).toBe('приход (7810)');
  });
});

describe('bkpFix plan (12427)', () => {
  const partners = [{ id: 'p1', name: 'Алфа ДОО' }, { id: 'pj', name: 'Плаќање фактура 15' }];
  const row = (o: Partial<BankRow>): BankRow => ({ id: 'x', date: '2026-01-05', amount: 1000, desc: '', ...o });
  it('links by document partner, by name, proposes new partners, and fixes junk partners', () => {
    const R = [
      row({ id: 'a', name: 'Алфа ДОО', desc: 'Алфа ДОО – уплата' }),
      row({ id: 'b', name: 'Нова Фирма', desc: 'Нова Фирма – уплата' }),
      row({ id: 'c', desc: 'x', ref: { type: 'invoice', id: 'i1', label: '1' } }),
      row({ id: 'd', name: 'Гама', desc: 'Плаќање фактура 15 - Гама', partner: 'pj' }),
      row({ id: 'e', name: 'Алфа ДОО', desc: 'Алфа', konto: '4460' }),
      row({ id: 'f', name: 'Алфа ДОО', desc: 'Алфа', date: '2025-12-31' }),
      row({ id: 'g', desc: '' }),
    ];
    const plan = partnerFixPlan(R, { year: 2026, partners, refPartner: (b) => (b.ref?.id === 'i1' ? 'p1' : ''), partnerKey });
    expect(plan).toEqual([
      { id: 'a', partner: 'p1', name: 'Алфа ДОО', junk: false },
      { id: 'b', partner: '', name: 'Нова Фирма', junk: false },
      { id: 'c', partner: 'p1', name: 'Алфа ДОО', junk: false },
      { id: 'd', partner: '', name: 'Гама', junk: true },
    ]);
    expect(bankCpName('Плаќање фактура 15 - Гама')).toBe('Плаќање фактура 15');
  });
});

describe('same reference (12690)', () => {
  it('finds other rows with the same ≥ 6-digit reference', () => {
    const b = { id: '1', bref: 'REF 1234567', desc: 'x' };
    const R = [b, { id: '2', bref: '', desc: 'налог 1234567' }, { id: '3', bref: '', desc: 'x', counterAccount: '1234567' }, { id: '4', bref: '123456', desc: '' }];
    expect(sameRefKey(b)).toBe('1234567');
    expect(sameRefRows(b, R).map((x) => x.id)).toEqual(['2', '3']);
    expect(sameRefRows({ id: '9', bref: '12', desc: 'abc' }, R)).toEqual([]);
    expect(withNote('Опис · [стара]', ' депозит ')).toBe('Опис · [депозит]');
    expect(withNote('Опис · [стара]', '')).toBe('Опис');
  });
});

describe('owner check (12877–12888)', () => {
  const me = { id: 'me', name: 'Тест ДООЕЛ Скопје', edb: '4030000000001', accounts: ['300000000123420'] };
  const other = { id: 'o', name: 'Бета Трејд ДОО', edb: '4030000000002', accounts: ['210000000555555'] };
  it('matches the current firm by account, ЕДБ or name', () => {
    expect(ownMatchFirm(me, { acct: '300-0000001234-20' })).toBe(true);
    expect(ownMatchFirm(me, { edb: 'MK4030000000001' })).toBe(true);
    expect(ownMatchFirm(me, { name: 'TEST DOOEL' })).toBe(true);
    expect(ownerCheck(me, [other], { acct: '300000000123420' })).toBeNull();
  });
  it('names the other firm when it matches; silent for an unknown name alone', () => {
    expect(ownerCheck(me, [other], { acct: '210000000555555' })?.other?.id).toBe('o');
    expect(ownerCheck(me, [other], { acct: '210000000555555' })?.message).toContain('префрлете се на „Бета Трејд ДОО“');
    expect(ownerCheck(me, [other], { name: 'Некоја Трета Фирма' })).toBeNull();
    expect(ownerCheck(me, [other], { name: 'Некоја', acct: '999999999999' })?.message).toContain('Проверете дали е избрана точната фирма');
  });
});

describe('aiClassify (4856)', () => {
  it('builds the prompt lists like legacy', () => {
    const L = bankClassifyLists({
      chart: [{ code: '1000', name: 'Жиро' }, { code: '4460', name: 'Банкарски услуги' }, { code: '7400', name: 'Приходи' }, { code: '8000', name: 'x' }, { code: '1020', name: 'Благајна' }],
      bankKontos: ['1000'],
      docs: [{ type: 'invoice', id: 'i1', number: '15/2026', partnerName: 'Алфа', open: 1180000 }, { type: 'purchase', id: 'p1', number: '77', partnerName: 'Бета', open: 500050 }, { type: 'invoice', id: 'i2', partnerName: 'x', open: 0 }],
      lines: [{ id: 'l1', date: '2026-01-05', amount: -15000, desc: 'Провизија' }],
    });
    expect(L.acc).toBe('4460 Банкарски услуги\n1020 Благајна');
    expect(L.docs).toBe('inv:i1 | наша фактура 15/2026 | купувач Алфа | отворено 11800\npur:p1 | влезна фактура 77 | добавувач Бета | отворено 5000.5');
    expect(L.lines).toBe('l1 | 2026-01-05 | -150 | Провизија');
    expect(bankClassifyLists({ chart: [], bankKontos: [], docs: [], lines: [] }).docs).toBe('(none)');
  });
  it('validates the answer: direction of documents, chart kontos, no bank kontos', () => {
    const res = [
      { id: 'in', ref: 'inv:i1', reason: 'фактура' }, { id: 'out', ref: 'inv:i1', konto: null, reason: 'x' },
      { id: 'out2', ref: 'pur:p1', reason: 'добавувач' }, { id: 'fee', konto: '4460', reason: 'провизија' },
      { id: 'bank', konto: '1000', reason: 'x' }, { id: 'nok', konto: '9999', reason: 'x' }, { id: 'gone', konto: '4460', reason: 'x' },
      { id: 'in2', ref: 'inv:zz', reason: 'x' },
    ];
    const lines = new Map([['in', { amount: 100 }], ['out', { amount: -100 }], ['out2', { amount: -5 }], ['fee', { amount: -1 }], ['bank', { amount: 1 }], ['nok', { amount: 1 }], ['in2', { amount: 1 }]]);
    expect(bankClassifyAnswers(res, { lines, docs: new Set(['inv:i1', 'pur:p1']), chart: new Set(['4460', '1000']), bankKontos: ['1000'] })).toEqual([
      { id: 'in', ref: { type: 'invoice', id: 'i1' }, reason: 'фактура' },
      { id: 'out2', ref: { type: 'purchase', id: 'p1' }, reason: 'добавувач' },
      { id: 'fee', konto: '4460', reason: 'провизија' },
    ]);
    expect(bankClassifyAnswers({ items: [{ id: 'fee', konto: '4460', reason: 'r'.repeat(200) }] }, { lines, docs: new Set(), chart: new Set(['4460']), bankKontos: [] })[0]!.reason).toHaveLength(160);
    expect(bankClassifyAnswers('nonsense', { lines, docs: new Set(), chart: new Set(), bankKontos: [] })).toEqual([]);
  });
});

describe('payment notifications (13309–13313)', () => {
  it('config defaults and recency window', () => {
    expect(payNoteCfg(undefined)).toEqual({ pay: true, sum: true, to: '' });
    expect(payNoteCfg({ pay: false, to: ' a@b.mk ' })).toEqual({ pay: false, sum: true, to: 'a@b.mk' });
    expect(payNoteRecent('2026-01-01', '2026-02-15')).toBe(true);
    expect(payNoteRecent('2026-01-01', '2026-02-16')).toBe(false);
  });
  it('mail texts', () => {
    const q = { invNo: '15/2026', invDate: '2026-01-02', partner: 'Алфа', email: 'a@x.mk', amt: 1180000, open: 0, date: '2026-01-05', ok: true };
    const m = payNoteMail(q, { name: 'Тест ДООЕЛ', signer: 'Ана' });
    expect(m.subject).toBe('Потврда за уплата – фактура 15/2026 – Тест ДООЕЛ');
    expect(m.body).toContain('на 05.01.2026 за фактура бр. 15/2026 од 02.01.2026.\nФактурата е целосно платена.');
    expect(payNoteMail({ ...q, open: 50000 }, {}).body).toContain('Преостанат износ за плаќање:');
    const s = payNoteSummary([q, { ...q, open: 100, ok: false, why: 'без е-пошта' }], { name: 'Тест' }, '2026-01-06');
    expect(s.closed).toBe(1);
    expect(s.total).toBe(2360000);
    expect(s.body).toContain('· потврда испратена на a@x.mk');
    expect(s.body).toContain('· потврда: без е-пошта');
  });
});
