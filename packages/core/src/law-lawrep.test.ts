import { describe, expect, it } from 'vitest';
import { lrCheck, lrCtx, lrDays, lrInt, lrPartnerLegal, lrVatPeriods, LR_RULES, type LrInput } from './law/lawrep';

const base = (o: Partial<LrInput> = {}): LrInput => ({
  firm: { name: 'Тест', vat: true, per: 'quarter', nkd: ['47.11'], kasaMax: 0 }, year: '2026', today: '2026-10-10',
  lines: [], prevRev74: 0, accName: {}, partners: {}, purchases: [], assets: [], vatMissing: [], employees: 3,
  popisLoss: 0, cashWithdrawals: 0, cashAccounts: ['1020'], profit: null, ...o,
});
const find = (x: ReturnType<typeof lrCheck>, id: string) => x.R.find((r) => r.r.id === id);
const L = (account: string, debit: number, credit: number, date = '2026-03-01', partnerId: string | null = null) => ({ account, debit, credit, date, partnerId });
const nonVat = { name: 'x', vat: false, per: 'quarter' as const, nkd: [], kasaMax: 0 };

describe('Даночен преглед (legacy LR_RULES / lrCheck)', () => {
  it('interest 0,03% per day and VAT periods due', () => {
    expect(lrDays('2026-01-25', '2026-02-24')).toBe(30);
    expect(lrInt(10000, '2026-01-25', '2026-02-24')).toBe(90);
    expect(lrVatPeriods('2026', '2026-10-10', 'quarter').map((x) => x.p)).toEqual(['2026-Т2', '2026-Т1']);
    expect(lrVatPeriods('2026', '2026-10-30', 'quarter').map((x) => x.p)).toEqual(['2026-Т3', '2026-Т2', '2026-Т1']);
    expect(lrVatPeriods('2026', '2026-03-10', 'month').map((x) => x.p)).toEqual(['2026-01']);
  });
  it('rule list in the final legacy order (v541 splice before p_short; loans pending)', () => {
    expect(LR_RULES.map((r) => r.id)).toEqual(['v_reg', 'v_mon', 'v_repr', 'v_hot', 'v_car', 'v_late', 'p_repr', 'p_spon', 'p_fine', 'p_wo', 'p_own', 'p_loan', 'l_cash', 'p_short', 'p_est', 'l_dnl', 'l_div']);
  });
  it('ЗДДВ registration threshold for a non-VAT firm', () => {
    const X = lrCheck(lrCtx(base({ firm: nonVat, lines: [L('1200', 1180000, 0, '2026-02-01'), L('7400', 0, 1180000, '2026-02-01'), L('7400', 0, 1000000, '2026-05-20')] })));
    const r = find(X, 'v_reg')!;
    expect(r.s).toBe('bad');
    expect(r.txt).toBe('Прометот во 2026 го надмина 2.000.000 ден. на 20.05.2026 – рок за регистрација 15.06.2026.');
    expect(r.amt).toBe(Math.round(180000 * 18 / 118 * 100) / 100);
    expect(find(X, 'v_repr')).toBeUndefined();
    expect(find(lrCheck(lrCtx(base({ firm: nonVat, prevRev74: 2500000 }))), 'v_reg')!.s).toBe('bad');
  });
  it('representation: deducted VAT is a violation with interest; 90% non-deductible expense', () => {
    const X = lrCheck(lrCtx(base({
      accName: { '4440': 'Трошоци за репрезентација' },
      lines: [L('4440', 10000, 0)],
      purchases: [{ date: '2026-03-01', number: 'Ф-1', partnerName: 'Ресторан', art32: false, pending: false, groups: [{ konto: '4440', vat: 1800 }] }],
    })));
    const v = find(X, 'v_repr')!;
    expect(v.s).toBe('bad');
    expect(v.txt).toBe('1 влезни фактури за репрезентација со одбиен ДДВ 1.800,00 ден. (пр. Ф-1 Ресторан)');
    expect(v.amt).toBe(1800 + lrInt(1800, '2026-04-25', '2026-10-10'));
    const p = find(X, 'p_repr')!;
    expect([p.s, p.amt]).toEqual(['warn', 900]);
    expect(X.bad).toBe(1);
    expect(X.exp).toBe(Math.round((v.amt! + 900) * 100) / 100);
  });
  it('sponsorships over 3% of income, fines, unfiled VAT, loans to persons, cash', () => {
    const X = lrCheck(lrCtx(base({
      accName: { '4430': 'Спонзорства', '4680': 'Казни и пенали', '1630': 'Дадени заеми', '1020': 'Благајна' },
      partners: { p1: { name: 'Петар Петров', legal: false, legalX: false }, p2: { name: 'Фирма ДОО', legal: true, legalX: true } },
      lines: [L('7400', 0, 100000), L('4430', 5000, 0), L('4680', 2000, 0), L('1630', 30000, 0, '2026-02-01', 'p1'), L('1630', 50000, 0, '2026-02-01', 'p2'), L('1020', 40000, 0)],
      vatMissing: [{ p: '2026-Т2', due: '2026-07-25', net: 10000 }], cashWithdrawals: 50000, firm: { name: 'x', vat: true, per: 'quarter', nkd: [], kasaMax: 10000 },
    })));
    expect(find(X, 'p_spon')!.txt).toBe('Спонзорства 5.000,00 (дозволено 3% = 3.000,00), донации 0,00 (дозволено 5% = 5.000,00) – вишок 2.000,00 ден.');
    expect(find(X, 'p_fine')!.amt).toBe(200);
    expect(find(X, 'v_late')!.amt).toBe(lrInt(10000, '2026-07-25', '2026-10-10'));
    expect(find(X, 'p_loan')!.txt).toBe('Отворени дадени заеми 30.000,00 ден.: Петар Петров 30.000,00');
    expect(find(X, 'l_cash')!.txt).toMatch(/^Во благајна останува 40\.000,00 ден\. \(максимум 10\.000,00\), а од сметка се подигнати 50\.000,00 ден\. – неоправдано ≈ 30\.000,00/);
    expect(find(X, 'p_est')).toBeUndefined();
  });
  it('profit estimate tiers and partner legal form', () => {
    expect(find(lrCheck(lrCtx(base({ profit: 0, lines: [L('7400', 0, 5000000)] }))), 'p_est')!.txt).toMatch(/1% \(= 50\.000,00\)/);
    expect(lrPartnerLegal('Алфа ДООЕЛ')).toBe(true);
    expect(lrPartnerLegal('Алфа ДООЕЛ', { embg: '1' })).toBe(false);
    expect(lrPartnerLegal('Општина Центар')).toBe(false);
    expect(lrPartnerLegal('Општина Центар', {}, true)).toBe(true);
  });
  it('a failing rule becomes a warning', () => {
    const X = lrCheck(lrCtx(base()), [{ id: 'x', law: 'zdd', art: '', t: 't', run: () => { throw new Error('boom'); } }]);
    expect(X.R[0]).toMatchObject({ s: 'warn', txt: 'Проверката не успеа: boom' });
  });
});
