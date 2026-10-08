/**
 * Golden tests: new `posting.ts` vs the effective legacy functions on the same fixtures.
 * Where legacy is buggy the corrected behaviour is asserted and the difference documented.
 */
import { describe, expect, it } from 'vitest';
import {
  bankEntries, blgEntries, fiskEntries, invoiceEntries, isBalanced, kompEntries, purchaseEntries, saleEntries, scrEntries,
  type JournalLine,
} from '../../../src/posting';
import { ctxOf, invOf, legacyState, LOCS, purOf } from './fixtures';
import { loadLegacy, normLegacy, plain } from './legacy';

const legacy = loadLegacy();
const same = (mine: JournalLine[], leg: JournalLine[]) => {
  expect(plain(mine)).toEqual(plain(leg));
  expect(isBalanced(mine)).toBe(true);
};

/* ------------------------------------------------------------------ invoices */

const ADV = { id: 'ADV1', number: 'A-1', date: '2026-02-01', partner: 'P1', advance: true, items: [{ name: 'Аванс', qty: 1, price: 10000, rate: 18, konto: '7400' }] };

const INVOICES: [string, any, Record<string, any>?][] = [
  ['services and goods 18% with discounts', { date: '2026-03-01', partner: 'P1', items: [
    { name: 'Консалтинг', qty: 3, price: 1250.5, disc: 10, rate: 18, konto: '7400' },
    { name: 'Стока', qty: '2', price: '999.99', disc: '', rate: '18', konto: '7410' },
  ] }],
  ['mixed rates 18/10/5/0, zero-rated goods → 74102', { date: '2026-03-02', partner: 'P1', items: [
    { qty: 1, price: 1000, rate: 18, konto: '7410' }, { qty: 4, price: 33.33, rate: 10, konto: '7410' },
    { qty: 7, price: 12.49, disc: 3, rate: 5, konto: '7410' }, { qty: 1, price: 500, rate: 0, konto: '7410' },
    { qty: 1, price: 300, rate: 0 },
  ] }],
  ['art. 32-a reverse charge', { date: '2026-03-03', partner: 'P1', art32: true, items: [{ qty: 10, price: 4500, rate: 18, konto: '7400' }] }],
  ['credit note flips sides', { date: '2026-03-04', partner: 'P1', credit: true, refInv: 'X', items: [{ qty: 1, price: 2000, rate: 18, konto: '7410' }, { qty: 1, price: 100, rate: 5, konto: '7410' }] }],
  ['advance invoice → advances konto', ADV],
  ['final invoice with partial advance deduction', { date: '2026-03-05', partner: 'P1', advances: { ADV1: 6000 }, items: [{ qty: 1, price: 25000, rate: 18, konto: '7400' }] }],
  ['fractional rounding per line', { date: '2026-03-06', partner: 'P1', items: [{ qty: 3, price: 33.335, disc: 7.5, rate: 18, konto: '7400' }, { qty: 0.333, price: 17.77, rate: 18, konto: '7400' }] }],
  ['export (rate 0)', { date: '2026-03-07', partner: 'P4', export: true, items: [{ qty: 5, price: 6150, rate: 0, konto: '7460' }] }],
  ['firm scheme overrides', { date: '2026-03-08', partner: 'P1', items: [{ qty: 1, price: 1000, rate: 18, konto: '7400' }, { qty: 1, price: 50, rate: 0, konto: '7400' }] },
    { firm: { sch: { customer: '1201', revService_18: '-', revService0: '7409' }, vatOut: { 18: '2300180' } } }],
  ['global VAT override ignored when it is a summary konto', { date: '2026-03-09', partner: 'P1', items: [{ qty: 1, price: 1000, rate: 10, konto: '7400' }] },
    { gsch: { vatOut: { 10: '2300' }, sch: { revService: '7401' } } }],
  ['non-VAT firm', { date: '2026-03-10', partner: 'P1', items: [{ qty: 2, price: 500, rate: 18, konto: '7400' }] }, { firm: { ddv: false } }],
];

describe('invoiceEntries', () => {
  for (const [name, inv, extra] of INVOICES) {
    it(name, () => {
      const st = legacyState({ ...(extra ?? {}), data: { invoices: [ADV, inv] } });
      const leg = legacy.run(st, (L) => normLegacy(L.invoiceEntries!(inv)));
      same(invoiceEntries(invOf(inv, [ADV]), ctxOf(st)), leg);
    });
  }

  it('FIX: VAT on a rate without an output-VAT konto throws instead of posting unbalanced', () => {
    const inv = { date: '2026-03-01', partner: 'P1', items: [{ qty: 1, price: 100, rate: 7, konto: '7400' }] };
    const st = legacyState();
    // Legacy drops the VAT line: debit 107, credit 100.
    const leg = legacy.run(st, (L) => normLegacy(L.invoiceEntries!(inv)));
    expect(isBalanced(leg)).toBe(false);
    expect(() => invoiceEntries(invOf(inv), ctxOf(st))).toThrow(/7%/);
  });

  it('FIX: a firm value equal to an old default (SCH_OLD) is honoured', () => {
    const inv = { date: '2026-03-01', partner: 'P1', advance: true, items: [{ qty: 1, price: 100, rate: 18, konto: '7400' }] };
    const st = legacyState({ firm: { sch: { advance: '2270' } } });
    const leg = legacy.run(st, (L) => normLegacy(L.invoiceEntries!(inv)));
    expect(leg.find((l) => l.credit === 100)!.account).toBe('2220'); // legacy silently ignores the choice
    expect(invoiceEntries(invOf(inv), ctxOf(st)).find((l) => l.credit === 100)!.account).toBe('2270');
  });
});

/* ------------------------------------------------------------------ purchases */

const PURCHASES: [string, any, Record<string, any>?][] = [
  ['domestic services 18% + 5%, whole-denar rounding', { date: '2026-03-01', number: 'Ф-11', partner: 'P2', groups: [
    { konto: '4190', rate: 18, base: 1234.56, vat: 222.22 }, { konto: '4010', rate: 5, base: 99.5, vat: 4.98 },
  ] }],
  ['goods into main warehouse, goods + material split', { date: '2026-03-02', number: 'Ф-12', partner: 'P2', groups: [{ konto: '6600', rate: 18, base: 15000, vat: 2700 }],
    stock: [{ item: 'I1', qty: 100, price: 100, rab: 0 }, { item: 'I2', qty: 100, price: 50, rab: 0 }] }],
  ['goods into warehouse with its own stock konto', { date: '2026-03-02', number: 'Ф-13', partner: 'P2', wh: 'W2', groups: [{ konto: '6600', rate: 18, base: 7777.7, vat: 1399.99 }],
    stock: [{ item: 'I1', qty: 77, price: 101.01, rab: 0 }] }],
  ['import with customs, transport, forwarding and FX cost', { date: '2026-03-03', number: 'INV-77', partner: 'P4', imp: true, vid: 'U', supKonto: '2210', fx: 61.5, cur: 'EUR',
    groups: [{ konto: '6600', rate: 0, base: 61500, vat: 0 }],
    costs: {
      car: { amt: 3075, partner: 'P3', doc: 'ЕЦД-1', lines: [{ base: 64575, rate: 18, vat: 11623.5 }] },
      sped: { amt: 2500, partner: 'P3', doc: 'Ф-5', lines: [{ base: 2500, rate: 18, vat: 450 }] },
      trans: { amt: 4000.4, partner: 'P3', lines: [{ base: 4000.4, rate: 5, vat: 200.02 }] },
      dev: { amt: 10, fx: 61.5 },
    },
    stock: [{ item: 'I1', qty: 10, price: 100, rab: 0 }] }],
  ['cash purchase (fiscal receipt)', { date: '2026-03-04', number: '000123', partner: 'P2', cash: true, groups: [{ konto: '4011', rate: 18, base: 847.46, vat: 152.54 }] }],
  ['art. 32-a purchase', { date: '2026-03-05', number: 'Ф-32', partner: 'P2', art32: true, groups: [{ konto: '4190', rate: 18, base: 50000, vat: 0 }, { konto: '4190', rate: '', base: 1000.4, vat: 0 }] }],
  ['non-VAT firm capitalises VAT', { date: '2026-03-06', partner: 'P2', groups: [{ konto: '4000', rate: 18, base: 1000, vat: 180 }] }, { firm: { ddv: false } }],
  ['noDed purchase (travel prior services)', { date: '2026-03-07', partner: 'P2', noDed: true, groups: [{ konto: '4190', rate: 18, base: 20000, vat: 3600 }] }],
  ['vatNoDed konto configured', { date: '2026-03-08', partner: 'P2', groups: [{ konto: '4190', rate: 18, base: 1000, vat: 180 }] },
    { firm: { ddv: false, sch: { vatNoDed: '4999' } } }],
  ['firm single input-VAT konto', { date: '2026-03-09', partner: 'P2', groups: [{ konto: '4190', rate: 10, base: 1000, vat: 100 }] },
    { firm: { vatInKonto: '130099' } }],
];

describe('purchaseEntries', () => {
  for (const [name, p, extra] of PURCHASES) {
    it(name, () => {
      const st = legacyState(extra ?? {});
      const leg = legacy.run(st, (L) => normLegacy(L.purchaseEntries!(p, (st.firm as any).ddv)));
      same(purchaseEntries(purOf(p), ctxOf(st), p.wh ? LOCS[p.wh] : undefined), leg);
    });
  }

  it('retail store purchase (retail method: margin + retail VAT)', () => {
    const p = { date: '2026-03-10', number: 'Ф-90', partner: 'P2', wh: 'S1', groups: [{ konto: '6600', rate: 18, base: 14000, vat: 2420 }],
      stock: [{ item: 'I1', qty: 100, price: 100, rab: 0, sp: '' }, { item: 'I3', qty: 50, price: 80, rab: 0, sp: '' }] };
    const st = legacyState({ firm: { sch: { retailMethod: true } } });
    const { leg, rows } = legacy.run(st, (L) => ({ leg: normLegacy(L.purchaseEntries!(p, true)), rows: L.calcRows!(p) as { marg: number; vat: number }[] }));
    const retail = { margin: rows.reduce((s, r) => s + r.marg, 0), vat: rows.reduce((s, r) => s + r.vat, 0) };
    same(purchaseEntries(purOf(p, retail), ctxOf(st), LOCS.S1), leg);
  });

  it('FIX: art. 32-a group without konto defaults to the purchase default (4000), not 4100 rail transport', () => {
    const p = { date: '2026-03-05', partner: 'P2', art32: true, groups: [{ rate: 18, base: 1000, vat: 0 }] };
    const st = legacyState();
    const leg = legacy.run(st, (L) => normLegacy(L.purchaseEntries!(p, true)));
    const mine = purchaseEntries(purOf(p), ctxOf(st));
    expect(leg.map((l) => l.account)).toContain('4100');
    expect(mine.map((l) => l.account)).toContain('4000');
    expect(plain(mine.map((l) => ({ ...l, account: l.account === '4000' ? '4100' : l.account })))).toEqual(plain(leg));
  });

  it('FIX: landed-cost VAT at a rate without input-VAT konto is capitalised, not posted to summary konto 1300', () => {
    const p = { date: '2026-03-05', partner: 'P2', groups: [{ konto: '4190', rate: 18, base: 1000, vat: 180 }], costs: { trans: { amt: 100, partner: 'P3', lines: [{ base: 100, rate: 7, vat: 7 }] } } };
    const st = legacyState();
    const leg = legacy.run(st, (L) => normLegacy(L.purchaseEntries!(p, true)));
    const mine = purchaseEntries(purOf(p), ctxOf(st));
    expect(leg.some((l) => l.account === '1300')).toBe(true);
    expect(mine.some((l) => l.account === '1300')).toBe(false);
    expect(mine.find((l) => l.note === 'ДДВ Транспорт')).toMatchObject({ account: '4190', debit: 7 });
    expect(isBalanced(mine)).toBe(true);
  });
});

/* ------------------------------------------------------------------ bank */

const BANK: [string, any, { konto?: string; cur?: string }][] = [
  ['inflow, default customer konto', { acct: 'main', amount: 11800, partner: 'P1' }, { konto: '1000' }],
  ['outflow, default supplier konto', { acct: 'main', amount: -5000.55, partner: 'P2' }, { konto: '1000' }],
  ['explicit konto (fee)', { acct: 'main', amount: -150, konto: '4460' }, { konto: '1000' }],
  ['inflow settling an invoice with FX gain', { acct: 'main', amount: 61600, partner: 'P4', ref: { type: 'invoice', id: 'X' }, settle: 61500 }, { konto: '1000' }],
  ['inflow settling an invoice with FX loss', { acct: 'main', amount: 61400, partner: 'P4', ref: { type: 'invoice', id: 'X' }, settle: 61500 }, { konto: '1000' }],
  ['outflow with FX loss', { acct: 'main', amount: -61600, partner: 'P4', ref: { type: 'purchase', id: 'Y' }, settle: 61500 }, { konto: '1000' }],
  ['outflow with FX gain', { acct: 'main', amount: -61400, partner: 'P4', ref: { type: 'purchase', id: 'Y' }, settle: 61500 }, { konto: '1000' }],
  ['settle ignored without ref', { acct: 'main', amount: 100, partner: 'P1', settle: 90 }, { konto: '1000' }],
  ['salary split with remainder to pay_net', { acct: 'main', amount: -100000, split: [{ k: '2401', a: 60000, n: 'Нето' }, { k: '2341', a: '25000.5' }, { k: '2342', a: 0 }] }, { konto: '1000' }],
  ['conversion: FX side posts nothing', { acct: 'eur', amount: 1000, konto: '1030', conv: true }, { konto: '1030', cur: 'EUR' }],
  ['conversion: MKD side', { acct: 'main', amount: -61500, konto: '1030', conv: true }, { konto: '1000' }],
  ['zero amount', { acct: 'main', amount: 0 }, { konto: '1000' }],
];

describe('bankEntries', () => {
  for (const [name, b, acc] of BANK) {
    it(name, () => {
      const st = legacyState();
      const leg = legacy.run(st, (L) => normLegacy(L.bankEntries!(b)));
      same(bankEntries(b, ctxOf(st), acc), leg);
    });
  }
  it('FIX: split larger than the payment books the excess as a credit (legacy: negative debit)', () => {
    const b = { acct: 'main', amount: -1000, split: [{ k: '2401', a: 1200 }] };
    const st = legacyState();
    const leg = legacy.run(st, (L) => L.bankEntries!(b)) as { k: string; d: number; p: number }[];
    expect(leg.find((l) => l.k === '2401' && l.d < 0)).toBeTruthy();
    const mine = bankEntries(b, ctxOf(st), { konto: '1000' });
    expect(mine.find((l) => l.account === '2401' && l.credit === 200)).toBeTruthy();
    expect(isBalanced(mine)).toBe(true);
  });
});

/* ------------------------------------------------------------------ retail / fiscal */

const Z = { date: '2026-03-15', total: 12285, groups: [{ rate: 18, konto: '7411', base: 10000, vat: 1800 }, { rate: 5, konto: '7411', base: 461.9, vat: 23.1 }] };

describe('saleEntries / fiskEntries', () => {
  it('cash sale day', () => {
    const st = legacyState();
    same(saleEntries(Z, ctxOf(st)), legacy.run(st, (L) => normLegacy(L.saleEntries!(Z))));
  });
  it('cash sale with zero-rated group and no konto', () => {
    const z = { date: '2026-03-15', total: 1180 + 200, groups: [{ rate: 18, base: 1000, vat: 180 }, { rate: 0, base: 200, vat: 0 }] };
    const st = legacyState();
    same(saleEntries(z, ctxOf(st)), legacy.run(st, (L) => normLegacy(L.saleEntries!(z))));
  });
  it('FIX: total ≠ Σ groups — difference to the largest revenue line (legacy unbalanced)', () => {
    const z = { ...Z, total: 12286 };
    const st = legacyState();
    const leg = legacy.run(st, (L) => normLegacy(L.saleEntries!(z)));
    expect(isBalanced(leg)).toBe(false);
    const mine = saleEntries(z, ctxOf(st));
    expect(isBalanced(mine)).toBe(true);
    expect(mine.find((l) => l.account === '741118')!.credit).toBe(10001);
  });

  const FISK: [string, any, Record<string, any>?][] = [
    ['no scheme, card payments on the POS konto with POS partner', { ...Z, card: 2000.5 }],
    ['no scheme, card konto not 12x keeps no partner', { ...Z, card: 1000, cardKonto: '1009' }],
    ['usl scheme', { ...Z, card: 500, fisk: { sc: 'usl' } }],
    ['usl scheme with own cash konto and revenue', { ...Z, fisk: { sc: 'usl', cashK: '1021', rev: '7415' } }],
    ['trg scheme', { ...Z, card: 1500, fisk: { sc: 'trg' } }],
    ['trg scheme, nonVat flag', { ...Z, fisk: { sc: 'trg', nonVat: true } }],
    ['card larger than total is clamped', { ...Z, card: 99999, fisk: { sc: 'usl' } }],
    ['groups total differs (scheme absorbs into revenue)', { ...Z, total: 12290, fisk: { sc: 'usl' } }],
  ];
  for (const [name, z, extra] of FISK) {
    it(`fiskEntries: ${name}`, () => {
      const st = legacyState(extra ?? {});
      same(fiskEntries(z, ctxOf(st)), legacy.run(st, (L) => normLegacy(L.fiskEntries!(z))));
    });
  }
  it('FIX: trgNoVat books the retail margin on 6694 (legacy hard-coded 6690), otherwise identical to legacy', () => {
    const z = { ...Z, card: 300, fisk: { sc: 'trgNoVat', from: '2026-03-01', to: '2026-03-15' } };
    const st = legacyState({ firm: { ddv: false } });
    const leg = legacy.run(st, (L) => normLegacy(L.fiskEntries!(z)));
    expect(leg.some((l) => l.account === '6690')).toBe(true);
    const mine = fiskEntries(z as any, ctxOf(st));
    expect(isBalanced(mine)).toBe(true);
    expect(plain(mine)).toEqual(plain(leg.map((l) => (l.account === '6690' ? { ...l, account: '6694' } : l))));
    // a firm-level retail margin override is followed; an explicit fiskMarg still wins
    const st2 = legacyState({ firm: { ddv: false, sch: { retailMarg: '6695' } } });
    expect(fiskEntries(z as any, ctxOf(st2)).find((l) => l.debit === 12285)!.account).toBe('6695');
    const st3 = legacyState({ firm: { ddv: false, sch: { fiskMarg: '6699' } } });
    expect(fiskEntries(z as any, ctxOf(st3)).find((l) => l.debit === 12285)!.account).toBe('6699');
  });
  it('FIX: trg scheme with a configured kasaCash no longer double-debits', () => {
    const z = { ...Z, fisk: { sc: 'trg' } };
    const st = legacyState({ firm: { sch: { kasaCash: '1022' } } });
    const leg = legacy.run(st, (L) => normLegacy(L.fiskEntries!(z)));
    expect(isBalanced(leg)).toBe(false);
    const mine = fiskEntries(z, ctxOf(st));
    expect(isBalanced(mine)).toBe(true);
    expect(plain(mine)).toEqual(plain(leg.filter((l) => l.account !== '1022')));
  });
});

/* ------------------------------------------------------------------ cash register */

const BLG: [string, any, string, Record<string, any>?][] = [
  ['fuel receipt with VAT 18%', { kind: 'out', reg: '1020', date: '2026-03-02', cur: 'MKD', amt: 3540, rate: 18, cat: 'fuel', merchant: 'Макпетрол', country: 'MK' }, '1020'],
  ['receipt with printed VAT and explicit konto, partner', { kind: 'out', reg: '1020', date: '2026-03-02', cur: 'MKD', amt: 1000.4, rate: 10, vat: 90.95, konto: '4190', partner: 'P2', merchant: 'Ресторан' }, '1020'],
  ['abroad hotel in EUR (no VAT, currency amounts)', { kind: 'out', reg: '1051', date: '2026-03-03', cur: 'EUR', fx: 61.53, amt: 120.5, rate: 18, cat: 'accommodation', merchant: 'Hotel', country: 'GR' }, '1051'],
  ['abroad taxi in EUR', { kind: 'out', reg: '1051', date: '2026-03-03', cur: 'EUR', fx: 61.53, amt: 15, cat: 'transport', merchant: 'Taxi', country: 'AT' }, '1051'],
  ['cash in from bank', { kind: 'in', reg: '1020', date: '2026-03-04', cur: 'MKD', amt: 20000, note: 'Подигање од банка' }, '1020'],
  ['cash in EUR with payK', { kind: 'in', reg: '1051', date: '2026-03-04', cur: 'EUR', fx: 61.5, amt: 500, konto: '1030', payK: '1052' }, '1051'],
  ['non-VAT firm', { kind: 'out', reg: '1020', date: '2026-03-02', cur: 'MKD', amt: 1180, rate: 18, cat: 'office' }, '1020', { firm: { ddv: false } }],
];

describe('blgEntries', () => {
  for (const [name, x, regId, extra] of BLG) {
    it(name, () => {
      const st = legacyState(extra ?? {});
      const reg = (st.firm as any).blg.find((r: any) => r.id === regId);
      same(blgEntries(x, ctxOf(st), reg), legacy.run(st, (L) => normLegacy(L.blgEntries!(x), { cur: x.cur })));
    });
  }
});

/* ------------------------------------------------------------------ supplier credits, compensations */

describe('scrEntries / kompEntries', () => {
  const PUR_IMP = { id: 'PI', date: '2026-02-01', partner: 'P4', imp: true, supKonto: '2211', groups: [] };
  const SCR: [string, any][] = [
    ['goods return to stock', { type: 'supcr', kind: 'ret', date: '2026-03-05', partner: 'P2', rows: [{ item: 'I1', qty: 3, price: 100.4, rate: 18 }, { item: 'I3', qty: 2, price: 80.6, rate: 5 }] }],
    ['price discount without konto → 7690', { type: 'supcr', kind: 'disc', date: '2026-03-05', partner: 'P2', supNo: 'ОД-1', rows: [{ qty: 1, price: 1500, rate: 18 }, { qty: 1, price: 99.5, rate: 18, konto: '4190' }] }],
    ['return of an import → import supplier konto', { type: 'supcr', kind: 'ret', date: '2026-03-05', partner: 'P4', refPur: 'PI', rows: [{ qty: 1, price: 6150, rate: 0, konto: '6600' }] }],
  ];
  for (const [name, d] of SCR) {
    it(name, () => {
      const st = legacyState({ data: { purchases: [PUR_IMP] } });
      const mine = scrEntries({ ...d, refPurchase: d.refPur ? PUR_IMP : null }, ctxOf(st));
      same(mine, legacy.run(st, (L) => normLegacy(L.scrEntries!(d))));
    });
  }
  it('non-VAT firm credit has no VAT', () => {
    const d = { type: 'supcr', kind: 'disc', date: '2026-03-05', partner: 'P2', rows: [{ qty: 1, price: 1000, rate: 18 }] };
    const st = legacyState({ firm: { ddv: false } });
    same(scrEntries(d as any, ctxOf(st)), legacy.run(st, (L) => normLegacy(L.scrEntries!(d))));
  });
  it('compensation', () => {
    const d = { type: 'komp', kind: 'bi', number: 'К-001/2026', rows: [
      { side: 'rec', ref: { type: 'invoice', id: 'I' }, docNo: '12/2026', amt: 15000.5, partner: 'P1' },
      { side: 'pay', ref: { type: 'purchase', id: 'Q' }, docNo: 'Ф-9', amt: 15000.5, partner: 'P1' },
      { side: 'pay', amt: 0, partner: 'P1' },
    ] };
    const st = legacyState({ firm: { sch: { customer: '1201' } } });
    same(kompEntries(d as any, ctxOf(st)), legacy.run(st, (L) => normLegacy(L.kompEntries!(d))));
  });
});
