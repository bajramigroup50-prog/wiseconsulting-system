/**
 * Bank kontos of statement lines (the owner's mapping): customer 1200, supplier 2200, daily turnover 1009, cash
 * withdrawal / material costs 1020, own transfer 10091, POS 1200001; transit defaults from the chart; own transfers
 * between the main account and branch sub-accounts; the bank konto of a new account by its bank.
 */
import { describe, expect, it } from 'vitest';
import {
  autoMatch, BANK_KONTA, bankTransitDefaults, classifyImported, keywordKonto, ownTransferBy, pickBankKonto, selfCounterparty,
  validateBankKonta, type BankAccount, type BankRow, type MatchContext,
} from '../index';

const CHART = [
  { code: '1000', name: 'Сметка аналитика според сметки во банки' },
  { code: '100001', name: 'Жиро сметка тутунска банка' }, { code: '1000014', name: 'Тутунска банка-подсметка' },
  { code: '100002', name: 'Жиро сметка комерцијална банка' }, { code: '1000021', name: 'Жиро сметка комерцијална банка наменска' },
  { code: '100005', name: 'Жиро сметка халк банка' }, { code: '1000051', name: 'Под сметка халк банка' }, { code: '1000052', name: 'Под сметка халк банка' },
  { code: '1000053', name: 'Под сметка халк банка' },
  { code: '1009', name: 'Предона сметка' }, { code: '10091', name: 'Пренос на средства од сметка на сметка денари' },
  { code: '1020', name: 'Главна благајна' }, { code: '1039', name: 'Предони девизни сметки' }, { code: '10391', name: 'Девизни сметки паунд' },
  { code: '1200', name: 'Купувачи' }, { code: '1200001', name: 'Плаќање со картици' }, { code: '2200', name: 'Добавувачи' },
];

describe('transit defaults from the chart', () => {
  it('10091 when the chart has it, else the 1009 fallback; FX only for a clearly named transfer analytic', () => {
    expect(bankTransitDefaults(CHART)).toEqual({ transit: '10091' });
    expect({ ...BANK_KONTA, ...bankTransitDefaults(CHART.filter((a) => a.code !== '10091')) }.transit).toBe('1009');
    expect(bankTransitDefaults([])).toEqual({});
    // 10391 „Девизни сметки паунд“ is not a transfer konto; one under 1039 that says „пренос“ is
    expect(bankTransitDefaults([...CHART, { code: '10392', name: 'Пренос на девизи од сметка на сметка' }]).transitFx).toBe('10392');
  });
  it('the owner\'s defaults', () => {
    expect([BANK_KONTA.customer, BANK_KONTA.supplier, BANK_KONTA.dailyTurnover, BANK_KONTA.cashWithdraw, BANK_KONTA.pos]).toEqual(['1200', '2200', '1009', '1020', '1200001']);
  });
  it('validates every setting against the chart', () => {
    expect(validateBankKonta({ transit: '10091', dailyTurnover: '1009', cashWithdraw: '' }, CHART)).toEqual({ konta: { transit: '10091', dailyTurnover: '1009' }, errors: [] });
    expect(validateBankKonta({ transit: '99999' }, CHART).errors[0]).toMatch(/99999 го нема/);
    expect(validateBankKonta({ transit: '10' }, CHART).errors).toHaveLength(1); // a class / group is not a konto
  });
});

/** ФУЛЛАМ ДООЕЛ СКОПЈЕ: the main account and three branch sub-accounts. */
const ACC: BankAccount[] = [
  { id: 'main', name: 'Халк', account: '270000000000101', konto: '100005', cur: 'MKD' },
  { id: 'kum', name: 'Куманово', account: '270000000000202', konto: '1000051', cur: 'MKD' },
  { id: 'gos', name: 'Гостивар', account: '270000000000303', konto: '1000052', cur: 'MKD' },
  { id: 'cen', name: 'Скопје-Центар', account: '270000000000404', konto: '1000053', cur: 'MKD' },
];
const K = { ...BANK_KONTA, transit: '10091' };
const ctx = { accounts: ACC, partners: [{ id: 'p1', name: 'Алфа ДОО' }, { id: 'p2', name: 'Бета ДООЕЛ' }], invoices: [], purchases: [], firmName: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', firmEdb: '4030000000001', konta: K };
const row = (x: Partial<BankRow>): BankRow => ({ id: 'r', acct: 'main', date: '2026-03-10', amount: 0, desc: '', ...x });

describe('each kind of line gets the owner\'s konto', () => {
  it('own transfer 10091, daily turnover 1009, cash withdrawal 1020, POS 1200001', () => {
    const c = (x: Partial<BankRow>) => classifyImported(row(x), { ...ctx, posPartner: 'pos' });
    expect(c({ amount: 100_000, name: 'ФУЛЛАМ ДООЕЛ Скопје-КУМАНОВО', desc: 'Пренос на средства', counterAccount: '270000000000202' })).toMatchObject({ cls: 'own', row: { konto: '10091', own: true } });
    expect(c({ amount: 20_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', desc: 'Уплата на пазар' })).toMatchObject({ cls: 'turnover', row: { konto: '1009' } });
    expect(c({ amount: 20_000, desc: 'Полог дневен промет каса 1' })).toMatchObject({ cls: 'turnover', row: { konto: '1009' } });
    expect(c({ amount: -15_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', desc: 'Подигање готовина за материјални трошоци' })).toMatchObject({ cls: 'cash', row: { konto: '1020' } });
    expect(c({ amount: -5_000, desc: 'Исплата во готово' })).toMatchObject({ cls: 'cash', row: { konto: '1020' } });
    expect(c({ amount: 9_850, desc: 'CASYS POS PRILIV' })).toMatchObject({ cls: 'pos', row: { konto: '1200001', partner: 'pos' } });
  });
  it('customer payment 1200 and supplier payment 2200 with the partner', () => {
    const r = autoMatch({
      ...ctx, year: 2026,
      rows: [row({ id: 'in', amount: 11_800, desc: 'Алфа ДОО – фактура 15/2026', name: 'Алфа ДОО' }), row({ id: 'out', amount: -6_000, desc: 'Бета ДООЕЛ – фактура 77', name: 'Бета ДООЕЛ' })],
      invoices: [{ id: 'i', number: '15/2026', date: '2026-03-01', partner: 'p1', total: 11_800 }],
      purchases: [{ id: 'u', number: '77', date: '2026-03-01', partner: 'p2', total: 6_000 }],
    } as MatchContext);
    expect(r.rows.find((x) => x.id === 'in')).toMatchObject({ konto: '1200', partner: 'p1' });
    expect(r.rows.find((x) => x.id === 'out')).toMatchObject({ konto: '2200', partner: 'p2' });
  });
  it('a learned rule still wins over the keyword konto in the matching run', () => {
    const r = autoMatch({ ...ctx, year: 2026, rows: [row({ id: 'w', amount: -3_000, desc: 'Подигање готовина' })], rules: [{ match: 'подигање готовина', konto: '1021' }] } as MatchContext);
    expect(r.rows[0]).toMatchObject({ konto: '1021' });
    expect(r.changes[0]!.how).toBe('rule');
  });
});

describe('own transfers between the main account and the branch sub-accounts', () => {
  it('both sides of every transfer are own transfers (by account, ЕДБ or the name with a branch suffix)', () => {
    const lines: [Partial<BankRow>, string][] = [
      [{ acct: 'main', amount: 100_000, name: 'ФУЛЛАМ ДООЕЛ Скопје-КУМАНОВО', counterAccount: '270000000000202', desc: 'пренос' }, 'acct'],
      [{ acct: 'kum', amount: -100_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', counterAccount: '270000000000101', desc: 'пренос' }, 'acct'],
      [{ acct: 'main', amount: 50_000, name: 'ФУЛЛАМ ДООЕЛ ГОСТИВАР', desc: 'пренос' }, 'name'],
      [{ acct: 'gos', amount: -50_000, name: 'Главна сметка', desc: 'Пренос на средства ЕДБ 4030000000001' }, 'edb'],
      [{ acct: 'main', amount: 30_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ - ЦЕНТАР', desc: 'пренос' }, 'name'],
      [{ acct: 'cen', amount: -30_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', desc: 'пренос' }, 'name'],
    ];
    for (const [x, by] of lines) {
      expect(selfCounterparty(row(x), ctx)).toBe(by);
      expect(classifyImported(row(x), ctx).row).toMatchObject({ konto: '10091', own: true });
    }
  });
  it('a cash deposit of the takings stays on 1009; „пазар“ sent from an own account is a transfer', () => {
    expect(ownTransferBy(row({ amount: 20_000, name: 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', desc: 'Уплата на пазар' }), ctx)).toBeNull();
    expect(keywordKonto(row({ amount: 20_000, desc: 'Уплата на пазар' }), ACC, K)).toEqual({ konto: '1009', cls: 'turnover' });
    expect(classifyImported(row({ acct: 'main', amount: 20_000, name: 'ФУЛЛАМ ДООЕЛ КУМАНОВО', counterAccount: '270000000000202', desc: 'Уплата на пазар' }), ctx).row.konto).toBe('10091');
  });
  it('the firm itself from an account that is not registered → offered as an own account', () => {
    const c = classifyImported(row({ amount: 7_000, name: 'ФУЛЛАМ ДООЕЛ ТЕТОВО', counterAccount: '270000000000909', desc: 'пренос' }), ctx);
    expect(c).toMatchObject({ cls: 'own', row: { konto: '10091' }, newOwnAccount: '270000000000909' });
    expect(selfCounterparty(row({ amount: 7_000, name: 'Друга Фирма ДОО', desc: 'плаќање' }), ctx)).toBeNull();
  });
});

describe('bank konto of a new account by its bank', () => {
  it('270 → 100005, the next Halk accounts → 1000051, 1000052; 300 → 100002; 210 → 100001; unknown code → null (1000)', () => {
    expect(pickBankKonto('270077299520174', CHART)).toBe('100005');
    expect(pickBankKonto('270077299520174', CHART, ['100005'])).toBe('1000051');
    expect(pickBankKonto('MK07270077299520174', CHART, ['100005', '1000051'])).toBe('1000052');
    expect(pickBankKonto('300000000123420', CHART)).toBe('100002'); // never the purpose account 1000021 „наменска“
    expect(pickBankKonto('210000000000123', CHART)).toBe('100001');
    expect(pickBankKonto('999000000000123', CHART)).toBeNull();
    expect(pickBankKonto('380000000000123', CHART)).toBeNull(); // no ПроКредит analytic in this chart
  });
  it('a firm-specific analytic wins', () => {
    expect(pickBankKonto('270077299520174', [...CHART, { code: '1000059', name: 'Халк банка – наша', own: true }])).toBe('1000059');
  });
});
