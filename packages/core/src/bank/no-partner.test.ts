/**
 * Statement lines that are never a customer / supplier (production NLB / Halk statements, synthetic data):
 * salaries with a payroll period, the Treasury, the firm's own bank (provisions, card purchases) and a payment that
 * names our invoice number.
 */
import { describe, expect, it } from 'vitest';
import { autoMatch, bmNums, classifyImported, isPeriodToken, noPartnerLine, type BankRow, type MatchContext, type OpenDoc } from '../bank-match';
import { partnerFixPlan } from './parity';
import { reviewMatch } from './review';
import { bkCore } from '../bank-match';

const doc = (id: string, number: string, date: string, total: number, partner: string): OpenDoc => ({ id, number, date, total, partner });
const ctx = (rows: BankRow[], o: Partial<MatchContext> = {}): MatchContext => ({
  rows, accounts: [{ id: 'main', name: 'НЛБ', account: '210000000000123', konto: '1000', cur: 'MKD' }], invoices: [], purchases: [], year: 2026,
  firmName: 'Тест Фирма ДООЕЛ', partners: [{ id: 'home', name: 'ХОУМ ЕКСКЛУЗИВ ДООЕЛ' }, { id: 'tek', name: 'ТЕКНОПАНЕЛ ДОО' }], ...o,
});
const row = (id: string, amount: number, desc: string, extra: Partial<BankRow> = {}): BankRow => ({ id, date: '2026-07-10', amount, desc, ...extra });

describe('period tokens are never invoice numbers', () => {
  it('„07-2026“, „06/2026“, „7/2026“ are periods; „17/26“ and keyword numbers stay', () => {
    expect(['07-2026', '06/2026', '7/2026', '12-2026'].every(isPeriodToken)).toBe(true);
    expect(isPeriodToken('17/26')).toBe(false);
    expect(bmNums('Цана Деа 9102026074061273115724+ 07-2026')).toEqual([]);
    expect(bmNums('плата 06/2026')).toEqual([]);
    expect(bmNums('по фактура 17/26')).toEqual(['17/26']);
  });
});

describe('salaries → net-salary liability (no invoice, no partner)', () => {
  const home = doc('p7', '7/2026', '2026-07-01', 2_604_600, 'home');
  it('„Цана Деа 910…+ 07-2026“ −26.046 is not the purchase „7/2026“ of ХОУМ ЕКСКЛУЗИВ', () => {
    const rows = [
      row('s1', -2_604_600, 'Цана Деа 9102026074061273115724+ 07-2026'),
      row('s2', -2_250_000, 'Рамадан Ердуан 9102026074061273115999+ 07-2026'),
    ];
    const C = reviewMatch(ctx(rows, { purchases: [home] }));
    for (const id of ['s1', 's2']) {
      const c = C.get(id)!;
      expect(c.how).toBe('payroll');
      expect(c.row.konto).toBe('2401');
      expect(c.row.ref).toBeUndefined();
      expect(c.row.partner).toBeUndefined();
      expect(c.newPartner).toBeUndefined();
    }
    // the firm's payroll scheme decides the konto
    expect(reviewMatch(ctx(rows, { purchases: [home], payScheme: { pay_net: '2410' } })).get('s1')!.row.konto).toBe('2410');
  });

  it('a natural person with a payroll period / salary words → net salary; a company with a period is not', () => {
    expect(noPartnerLine(row('a', -100_000, 'Марко Марковски плата 06/2026'))).toMatchObject({ kind: 'wage', konto: '2401' });
    expect(noPartnerLine(row('b', -100_000, 'надоместок за храна', { name: 'Ана Петрова' }))).toMatchObject({ kind: 'wage' });
    expect(noPartnerLine(row('c', -100_000, 'Закупнина 06-2026', { name: 'Ана Петрова' }))).toBeNull();
    expect(noPartnerLine(row('d', -100_000, 'ХОУМ ЕКСКЛУЗИВ ДООЕЛ ф-ра 06-2026'))).toBeNull();
  });

  it('with a payroll run the amount match (split / payroll month) is used', () => {
    const r = row('s', -2_604_600, 'Цана Деа 9102026074061273115724+ 07-2026');
    const m = autoMatch(ctx([r], { purchases: [home], payMatch: () => ({ month: '2026-07', konto: '2401' }) }));
    expect(m.changes.find((c) => c.id === 's')!.row).toMatchObject({ konto: '2401', payRef: '2026-07' });
  });
});

describe('Трезор на РМ: never a partner; payroll contributions by the hints', () => {
  const T = (desc: string) => row('t', -50_000, desc, { name: 'Трезор на РМ' });
  it.each([
    ['Penziski 07-2026', '2341'], ['Zdravstvo 07-2026', '2342'], ['0.5% dodatno 07-2026', '2343'], ['Vrabotuvanje 07-2026', '2344'], ['Danok 07-2026', '2340'],
  ])('%s → %s', (desc, konto) => {
    expect(noPartnerLine(T(desc))).toMatchObject({ kind: 'treasury', konto });
    const C = reviewMatch(ctx([T(desc)]));
    expect(C.get('t')!.row).toMatchObject({ konto });
    expect(C.get('t')!.row.partner).toBeUndefined();
  });
  it('without a hint: no proposal, no partner, no invoice by amount', () => {
    const r = T('уплата');
    expect(noPartnerLine(r)).toEqual({ kind: 'treasury' });
    expect(reviewMatch(ctx([r], { purchases: [doc('x', '5', '2026-07-01', 50_000, 'home')] })).has('t')).toBe(false);
  });
});

describe('the bank as counterparty: fees on 4460, card purchases on 1020, never a partner', () => {
  const lines = [
    row('f1', -15_000, 'НЛБ Банка- Провизии'),
    row('f2', -6_000, '[AutoProv] надоместок за трансакција'),
    row('f3', -30_000, 'НЛБ Банка-ПРОВИЗИЈА ЗА ЕЛЕКТРОНСКО БАНКАРСТВО'),
    row('f4', -12_000, 'ХАЛКБАНК АД одржување на сметка'),
    row('c1', -123_400, 'MBDP:8330:4111********1234 KAFE BAR SKOPJE'),
    row('c2', -98_000, 'VISA*6874 -Ramstor Skopje'),
  ];
  it('autoMatch proposes 4460 / 1020 without a partner, never a purchase by amount', () => {
    const m = autoMatch(ctx(lines, { purchases: [doc('x', '5', '2026-07-01', 15_000, 'home'), doc('y', '6', '2026-07-01', 98_000, 'home')] }));
    const by = (id: string) => m.rows.find((r) => r.id === id)!;
    for (const id of ['f1', 'f2', 'f3', 'f4']) expect(by(id)).toMatchObject({ konto: '4460' });
    for (const id of ['c1', 'c2']) expect(by(id)).toMatchObject({ konto: '1020' });
    for (const r of m.rows) { expect(r.partner).toBeUndefined(); expect(r.ref).toBeUndefined(); }
    expect(m.changes.some((c) => c.newPartner)).toBe(false);
  });

  it('a learned rule wins for a card merchant', () => {
    const m = autoMatch(ctx([lines[5]!], { rules: [{ match: 'ramstor', konto: '4010' }] }));
    expect(m.rows[0]).toMatchObject({ konto: '4010' });
  });

  it('import classification: no partner to create for the bank / a card merchant (the konto is proposed by the review)', () => {
    for (const r of [row('i', -15_000, 'НЛБ Банка- Провизии', { konto: '2200' }), { ...lines[4]!, konto: '2200' }]) {
      const c = classifyImported(r, ctx([]));
      expect(c.newPartner).toBeUndefined();
      expect(c.row.partner).toBeUndefined();
    }
  });

  it('„Поврзи ги со комитентот од изводот“ does not list the bank, the Treasury or employees', () => {
    const rows = [
      row('n1', -15_000, 'НЛБ Банка- Провизии'),
      row('n2', -30_000, 'НЛБ Банка-ПРОВИЗИЈА ЗА ЕЛЕКТРОНСКО БАНКАРСТВО'),
      row('n3', -50_000, 'Трезор на РМ - Penziski 07-2026'),
      row('n4', -2_604_600, 'Цана Деа 9102026074061273115724+ 07-2026'),
      row('n5', -40_000, 'ХОУМ ЕКСКЛУЗИВ ДООЕЛ - плаќање'),
      { ...row('n6', -15_000, 'НЛБ Банка- Провизии'), konto: '2200' },
    ];
    const plan = partnerFixPlan(rows, { year: 2026, partners: ctx([]).partners, refPartner: () => '', partnerKey: bkCore });
    expect(plan.map((x) => x.id)).toEqual(['n5']);
  });
});

describe('our invoice number in the description wins over the amount', () => {
  const r = row('t1', 2_500_000, 'ТЕКНОПАНЕЛ ДОО уплата по CLK-202606-1019', { date: '2026-09-05' });
  const i1019 = doc('i1019', 'CLK-202606-1019', '2026-06-20', 2_500_000, 'tek');
  const i1132 = doc('i1132', 'CLK-202608-1132', '2026-08-25', 2_500_000, 'tek');

  it('the named invoice is linked, not the other one with the same amount', () => {
    for (const partners of [ctx([]).partners, []]) {
      for (const x of [r, { ...r, name: 'ТЕКНОПАНЕЛ ДОО' }]) {
        const C = reviewMatch(ctx([x], { invoices: [i1132, i1019], partners }));
        expect(C.get('t1')!.row.ref).toMatchObject({ id: 'i1019' });
        expect(C.get('t1')!.refs).toEqual([expect.objectContaining({ id: 'i1019' })]);
      }
    }
  });

  it('the named invoice is not open (already paid / unknown): no amount match to another CLK invoice', () => {
    const paid = { ...i1019, paidOther: 2_500_000 };
    for (const invoices of [[i1132, paid], [i1132]]) {
      const C = reviewMatch(ctx([r], { invoices }));
      expect(C.get('t1')?.row.ref).toBeUndefined();
      expect(autoMatch(ctx([r], { invoices })).rows[0]!.ref).toBeUndefined();
    }
  });

  it('a referenced number that is not found: no amount-only match to a later-dated invoice', () => {
    const x = row('t2', 1_000_000, 'Алфа уплата фактура 55/26', { date: '2026-07-01' });
    const later = doc('l', '61/26', '2026-07-15', 1_000_000, 'zz');
    expect(autoMatch(ctx([x], { invoices: [later] })).rows[0]!.ref).toBeUndefined();
  });
});

describe('МИНИСТЕРСТВО ЗА ФИНАНСИИ / Treasury: tax payments on the tax kontos, never a partner', () => {
  const M = (desc: string, amount = -80_000) => row('m', amount, desc, { name: 'МИНИСТЕРСТВО ЗА ФИНАНСИИ' });
  it.each([
    ['уплата мдб 06/2026', '2330'], ['камата', '44792'], ['ДДВ 06/2026', '23008'], ['данок на додадена вредност', '23008'],
  ])('%s → %s', (desc, konto) => {
    expect(noPartnerLine(M(desc))).toMatchObject({ kind: 'treasury', konto });
    const C = reviewMatch(ctx([M(desc)], { purchases: [doc('x', '6/2026', '2026-06-01', 80_000, 'home')] }));
    expect(C.get('m')?.row.konto).toBe(konto);
    expect(C.get('m')?.row.partner).toBeUndefined();
    expect(C.get('m')?.row.ref).toBeUndefined();
  });
  it('the kontos follow the firm settings', () => {
    expect(noPartnerLine(M('уплата мдб 06/2026'), { konta: { profitTax: '2331' } })).toMatchObject({ konto: '2331' });
  });
  it('not listed for „Поврзи ги со комитентот од изводот“', () => {
    expect(partnerFixPlan([M('уплата мдб 06/2026'), M('нешто')], { year: 2026, partners: [], refPartner: () => '', partnerKey: bkCore })).toEqual([]);
  });
});

describe('currency purchase on a denar account → FX transit 1039 („Предони девизни сметки“)', () => {
  it('„купопродажба на девизи“ → 1039, no partner', () => {
    const m = autoMatch(ctx([row('k', -6_150_000, 'НЛБ Банка купопродажба на девизи EUR 1000')]));
    expect(m.rows[0]).toMatchObject({ konto: '1039', conv: true });
    expect(m.rows[0]!.partner).toBeUndefined();
  });
});
