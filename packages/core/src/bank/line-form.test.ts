/** Bank line form helpers: cross-script partner search, „+ Ново конто“ / synthetic konto hints, wrong-side warnings. */
import { describe, expect, it } from 'vitest';
import { autoMatch, ruleSideOk, wrongSideWarning, type BankRow } from '../bank-match';
import { kontoHint, kontoParent, newKontoCheck } from '../konto-hint';
import { findPartnerMatch } from '../partners/match';
import { searchPartners } from '../partners/search';

const P = [
  { id: 'v', name: 'VENG HAUS DOO SKOPJE', code: '0412' },
  { id: 'a', name: 'АЛФА ТРЕЈД ДООЕЛ', code: '0100' },
  { id: 'n', name: 'НЛБ БАНКА АД', code: '0209' },
];

describe('searchPartners (Latin ↔ Cyrillic)', () => {
  it('„ВЕНГ“ finds „VENG HAUS DOO SKOPJE“, „alfa“ finds „АЛФА ТРЕЈД“', () => {
    expect(searchPartners(P, 'ВЕНГ').map((p) => p.id)).toEqual(['v']);
    expect(searchPartners(P, 'венг хаус').map((p) => p.id)).toEqual(['v']);
    expect(searchPartners(P, 'alfa').map((p) => p.id)).toEqual(['a']);
    expect(searchPartners(P, '0209').map((p) => p.id)).toEqual(['n']);
    expect(searchPartners(P, '').length).toBe(3);
  });
  it('the statement counterparty „ВЕНГ ХАУС ДОО Скопје“ preselects VENG HAUS (findPartnerMatch)', () => {
    expect(findPartnerMatch(P, { name: 'ВЕНГ ХАУС ДОО Скопје' }).partner?.id).toBe('v');
  });
});

describe('konto hints', () => {
  const chart = [
    { code: '103', name: 'Девизни сметки' }, { code: '1030', name: 'Девизни сметки во банки' }, { code: '10301', name: 'Девизна сметка EUR' },
    { code: '446', name: 'Банкарски услуги' }, { code: '4460', name: 'Банкарски услуги' }, { code: '447', name: 'Други трошоци' },
  ];
  it('a synthetic with analytics → choose the analytic', () => {
    expect(kontoHint(chart, '1030')).toMatchObject({ kind: 'synthetic', analytics: [{ code: '10301' }] });
    expect(kontoHint(chart, '4460')).toMatchObject({ kind: 'ok' });
  });
  it('a missing konto under an existing synthetic → „+ Ново конто“ with the parent name; else an error', () => {
    expect(kontoHint(chart, '44792')).toMatchObject({ kind: 'new', parent: { code: '447' } });
    expect(kontoParent(chart, '44601')?.code).toBe('4460');
    expect(newKontoCheck(chart, '999')).toEqual({ error: 'Новото конто мора да има 4–8 цифри.' });
    expect(newKontoCheck(chart, '9991')).toMatchObject({ error: expect.stringContaining('Нема синтетичко') });
    expect(newKontoCheck(chart, '4460')).toMatchObject({ error: expect.stringContaining('веќе постои') });
  });
});

describe('inflow on 2200 / outflow on 1200', () => {
  it('warns without an invoice link', () => {
    expect(wrongSideWarning('2200', 354_000, false)).toBe('прилив на 2200?');
    expect(wrongSideWarning('1200', -354_000, false)).toBe('одлив на 1200?');
    expect(wrongSideWarning('2200', 354_000, true)).toBe('');
    expect(wrongSideWarning('1200', 354_000, false)).toBe('');
  });
  it('a learned „ВЕНГ ХАУС → 2200“ rule does not book an inflow from the customer', () => {
    expect(ruleSideOk('2200', 1)).toBe(false);
    const r: BankRow = { id: 'x', date: '2026-07-01', amount: 354_000, desc: 'ВЕНГ ХАУС ДОО Скопје уплата' };
    const m = autoMatch({ rows: [r], accounts: [], invoices: [], purchases: [], partners: [], rules: [{ match: 'венг хаус', konto: '2200' }] });
    expect(m.rows[0]!.konto).toBeUndefined();
  });
});
