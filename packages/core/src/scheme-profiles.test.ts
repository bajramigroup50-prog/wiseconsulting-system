import { describe, expect, it } from 'vitest';
import { applyCustomScheme, customSchemeBalanced } from './finance';
import { invoiceEntries, purchaseEntries, vatAccountSet, vatAccountSetAll, vatCloseEntries, withSchemeProfile, type PostingContext } from './posting';
import { can, type Principal } from './rbac';
import {
  docKontoRemap, invoiceLineKonto, nextSchemeNo, PURCHASE_KONTO_KEYS, schemeLabel, schemeNoOf, schemeProfilesOf, schemeShort, validateSchemeProfile,
} from './scheme-profiles';

const base: PostingContext = { firm: { ddv: true, sch: { customer: '1200' } }, global: { sch: { revGoods: '7410' } } };
const S2 = { no: 2, name: 'Услуги во земјата', sch: { revService_18: '7414' } };
const inv = { id: 'i', date: '2026-05-10', number: '1', partner: 'p', items: [{ qty: 2, price: 500, rate: 18, konto: '7400' }, { qty: 1, price: 100, rate: 5, konto: '7410' }] };

describe('Шема N over Шема 1', () => {
  it('overrides only the given keys; the lines equal Шема 1 except the overridden konto', () => {
    const L1 = invoiceEntries(inv, base), L2 = invoiceEntries(inv, withSchemeProfile(base, S2));
    expect(L1.map((l) => l.account)).toContain('740018');
    expect(L2.map((l) => l.account)).toContain('7414');
    expect(L2).toEqual(L1.map((l) => (l.account === '740018' ? { ...l, account: '7414' } : l)));
  });
  it('without a profile the context is the same object (Шема 1)', () => {
    expect(withSchemeProfile(base, null)).toBe(base);
    expect(withSchemeProfile(base, { no: 3, sch: {} }).firm.sch).toBe(base.firm.sch);
  });
  it('a VAT konto of a profile counts for the VAT close and the closed-period guard', () => {
    const c = { ...base, firm: { ...base.firm, profiles: [{ no: 2, vatOut: { 18: '2300181' } }] } };
    expect(vatAccountSet(c).has('2300181')).toBe(false);
    expect(vatAccountSetAll(c).has('2300181')).toBe(true);
    const close = vatCloseEntries([{ account: '2300181', date: '2026-05-01', debit: 0, credit: 18 }], '2026-04-01', '2026-06-30', c);
    expect(close.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([['2300181', 18, 0], ['23008', 0, 18]]);
  });
  it('invoice line kontos stored with Шема 1 move by item type; the per-rate split uses the profile', () => {
    const P = withSchemeProfile(base, { no: 2, sch: { revService: '7414' } });
    expect(invoiceLineKonto(base, P, '7400', 'service')).toBe('7414');
    expect(invoiceLineKonto(base, P, '7400', 'product')).toBe('7400'); // revProduct is not overridden
    expect(invoiceLineKonto(base, P, '7499', 'service')).toBe('7499'); // the article's own konto stays
    expect(invoiceLineKonto(base, base, '7400', 'service')).toBe('7400');
  });
  it('purchase group kontos move only for overridden keys (first key owns a konto)', () => {
    const P = withSchemeProfile(base, { no: 2, sch: { purDefault: '4010', supplier: '2210' } });
    const f = docKontoRemap(base, P, PURCHASE_KONTO_KEYS);
    expect([f('4000'), f('6600'), f('4020')]).toEqual(['4010', '6600', '4020']);
    const pur = { id: 'p', date: '2026-05-01', number: 'D', partner: 's', groups: [{ konto: f('4000'), rate: 18, base: 1000, vat: 180 }] };
    const A1 = purchaseEntries({ ...pur, groups: [{ ...pur.groups[0]!, konto: '4000' }] }, base).map((l) => l.account);
    expect(purchaseEntries(pur, P).map((l) => l.account)).toEqual(A1.map((a) => (a === '4000' ? '4010' : a === '2200' ? '2210' : a)));
  });
});

describe('profiles: parsing, labels, validation', () => {
  it('cleans the stored list', () => {
    const L = schemeProfilesOf({ schemeProfiles: [{ no: 3, name: 'Б', sch: { revGoods: '7411', retailMethod: true, x: '1' } }, { no: 1, name: 'не' }, { no: 3, name: 'дупла' }, { no: '2', name: '' }] });
    expect(L.map((p) => [p.no, p.name, p.sch])).toEqual([[2, 'Шема 2', {}], [3, 'Б', { revGoods: '7411' }]]);
    expect(nextSchemeNo(L)).toBe(4);
    expect(schemeNoOf('2')).toBe(2);
    expect(schemeNoOf('x')).toBe(1);
    expect(schemeNoOf(0)).toBe(1);
    expect(schemeLabel(1)).toBe('Шема 1 – основна');
    expect(schemeLabel(3, L)).toBe('Шема 3 – Б');
    expect([schemeShort(1), schemeShort(2)]).toEqual(['', 'Ш2']);
  });
  it('refuses bad kontos and summary VAT kontos', () => {
    expect(validateSchemeProfile({ name: 'А', sch: { revService_18: '7414', vatNoDed: '-' } })).toEqual([]);
    expect(validateSchemeProfile({ name: 'А', sch: { revService_18: '74x' } })[0]).toMatch(/не е конто/);
    expect(validateSchemeProfile({ name: 'А', sch: { r32out: '2300' } })[0]).toMatch(/збирното конто 2300/);
    expect(validateSchemeProfile({ name: 'А', sch: { r32out: '-' } })[0]).toMatch(/не е конто за ДДВ/);
    expect(validateSchemeProfile({ name: 'А', vatIn: { 18: '1300' } })[0]).toMatch(/збирното конто 1300/);
    expect(validateSchemeProfile({ name: 'А', sch: { retailMethod: 'true' } })[0]).toMatch(/не е клуч/);
    expect(validateSchemeProfile({ name: '' })[0]).toMatch(/назив/);
  });
});

describe('unchanged neighbours', () => {
  it('custom schemes for manual journals still work', () => {
    const c = { rows: [{ k: '4120', s: 'd' as const, v: 100 }, { k: '2200', s: 'p' as const, v: 100 }] };
    expect(customSchemeBalanced(c)).toBe(true);
    expect(applyCustomScheme(c, 1500)).toEqual([{ account: '4120', debit: 1500, credit: 0, note: '' }, { account: '2200', debit: 0, credit: 1500, note: '' }]);
  });
  it('permissions: editing schemes needs settings, choosing one on a document needs write', () => {
    const P = (role: Principal['role']): Principal => ({ id: 'u', role, firms: ['f'] });
    expect(can(P('acc'), 'schSave', 'f')).toBe(false);
    expect(can(P('oper'), 'schSave', 'f')).toBe(false);
    expect(can(P('senior'), 'schSave', 'f')).toBe(true);
    expect(can(P('acc'), 'write', 'f')).toBe(true);
    expect(can(P('oper'), 'write', 'f')).toBe(true);
    expect(can(P('view'), 'write', 'f')).toBe(false);
    expect(can({ ...P('senior'), demo: true }, 'schSave', null)).toBe(false);
  });
});
