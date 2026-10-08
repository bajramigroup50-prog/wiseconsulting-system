/**
 * Golden tests for the small legacy helpers the matching depends on, run over string/number tables.
 */
import { describe, expect, it } from 'vitest';
import {
  bmNums, bmKey, bmEq, bmSubset, counterparty, bankParty, matchPartner, BANK_FEE, ppIban, ppAccTxt, fxRate,
  assignStatementNumbers, transitResidue, transitCloseLines, statementGaps, learnRule, bankDupKey,
} from '../../../src/bank-match';
import { decodeCp1251, decodeBankBytes } from '../../../src/bank-parsers';
import { loadLegacy, plain } from './legacy';
import * as F from './fixtures/match-fixture';

const L = loadLegacy();
const call = <T,>(fn: string, ...args: unknown[]): T => plain(L.run<T>(`${fn}(...${JSON.stringify(args)})`));
const c = (x: number) => Math.round(x * 100) || 0;

const DESCS = [
  'Уплата по фактура 46/2026', 'Uplata po faktura br. 45/2026', 'Уплата по фактури бр. 53/2026 и 54/2026', 'ф-ра 12, 13 и 14/2026',
  'INV 2026-77', 'Invoice#: 2026/0045', 'Плаќање фактура бр. 1234', 'фактура 1234-25 материјали', 'сметка бр. 03/2026',
  'плата 02/2026', 'Налог 78', 'датум 12.03.2026 фактура 7', 'fakt. 9/26 + 10/26', 'ф. 100-2025; ф. 101-2025', 'бр.: 5/2026.', '',
  'faktura dhe 4/2026 dhe 5/2026', '№ 77/2026', '#  88', 'ИЗВОД БР 4', 'аванс', 'nr. 2026-0012',
];

describe('invoice-number helpers vs legacy (12471–12483)', () => {
  it('bmNums', () => { for (const d of DESCS) expect(bmNums(d), d).toEqual(call('bmNums', d)); });
  it('bmKey', () => {
    for (const n of ['45/2026', '2026/0045', 'F-1234', 'INV-2026-77', '12', 'ЕX 3/26', 'abc', '', '1-2-3', '2050-1', '7/2101']) expect(bmKey(n), n).toEqual(call('bmKey', n));
  });
  it('bmEq', () => {
    const pairs: [string, string][] = [['45/2026', '45/2026'], ['45/2026', '45'], ['45', '45/26'], ['45/2025', '45/2026'], ['F-1234', '1234-25'], ['2026/77', 'INV-2026-77'], ['1', '2']];
    for (const [a, b] of pairs) for (const weak of [true, false]) expect(bmEq(bmKey(a), bmKey(b), weak), `${a}|${b}|${weak}`).toBe(call('bmEq', bmKey(a), bmKey(b), weak));
  });
  it('bmSubset: fewest documents, then earliest combination; capped at 14 documents', () => {
    const cases: [number[], number][] = [[[100, 150, 70, 30], 100], [[100, 150, 70, 30], 250], [[10, 20, 30, 40, 50], 60], [[1, 2, 4, 8], 15], [[5, 5, 5], 10], [[5], 5], [Array.from({ length: 20 }, (_, i) => i + 1), 39], [Array.from({ length: 20 }, (_, i) => 100 + i), 119 + 118]];
    for (const [os, amt] of cases) {
      const P = os.map((o, i) => ({ id: 'd' + i, o }));
      const leg = call<{ id: string }[] | null>('bmSubset', P, amt);
      const mine = bmSubset(P.map((p) => ({ ...p, o: c(p.o) })), c(amt));
      expect(mine?.map((x) => x.id) ?? null, `${os}→${amt}`).toEqual(leg?.map((x) => x.id) ?? null);
    }
  });
});

describe('names & rules vs legacy', () => {
  it('counterparty (rule key)', () => {
    for (const d of ['Телеком АД – сметка', 'БЕТА ДОО, плаќање', 'АБЦ Трејд ДООЕЛ · уплата', 'ab', 'Makedonski Telekom AD Skopje - internet', 'ЕВН Македонија АД; струја']) expect(counterparty(d), d).toBe(call('counterparty', d));
  });
  it('bankParty / matchPartner (obMatch)', () => {
    L.S.data.partners = structuredClone(F.partners);
    const rows = [
      { desc: 'АБЦ ТРЕЈД ДООЕЛ – Уплата', name: 'АБЦ ТРЕЈД ДООЕЛ' }, { desc: 'Бета ДОО - уплата' }, { desc: '12345 - x' }, { desc: 'Гама Комерц & Ко, аванс' },
      { desc: 'ACME GMBH – INV', name: 'ACME GMBH' }, { desc: 'no separator', partner: 'p2' }, { desc: 'Delta Import – x', name: 'Delta' },
    ];
    for (const r of rows) {
      expect(bankParty(r as never, F.partners), r.desc).toEqual(call('bankParty', r));
      const nm = bankParty(r as never, F.partners).name;
      expect(matchPartner(F.partners, nm, ''), nm).toBe(call('obMatch', nm, ''));
    }
    expect(matchPartner(F.partners, 'x', '4030000000001')).toBe(call('obMatch', 'x', '4030000000001'));
  });
  it('BANK_FEE recogniser is the legacy regex', () => {
    for (const d of ['Надомест за одржување на сметка', 'Провизија', 'bank fee', 'Пакет услуги', 'Уплата', 'Commission EUR']) expect(BANK_FEE.test(d), d).toBe(L.run<boolean>(`BANK_FEE.test(${JSON.stringify(d)})`));
  });
  it('learnRule (legacy change listener 4842)', () => {
    expect(learnRule([], 'Телеком АД – сметка', '4200')).toEqual([{ match: 'телеком', konto: '4200', learned: true }]);
    expect(learnRule([{ match: 'телеком', konto: '4200' }], 'Телеком АД', '4200')).toBeNull();
    expect(learnRule([{ match: 'телеком', konto: '4200' }], 'Телеком АД', '4210')).toEqual([{ match: 'телеком', konto: '4210', learned: true }]);
    expect(learnRule([], 'ab', '4200')).toBeNull();
  });
  it('bankDupKey (bKey 4811)', () => {
    const b = { id: 'x', acct: 'main', date: '2026-03-01', amount: 123456, desc: 'Уплата, ф-ра 1/2026!' };
    expect(bankDupKey(b)).toBe(call('bKey', { ...b, amount: 1234.56 }));
  });
});

describe('payment orders vs legacy (15759–15762)', () => {
  it('ppIban / ppAccTxt', () => {
    for (const a of ['100000000063095', '270-0000123456-78', '300000000299999', '12345', '210 0000001111 11']) {
      expect(ppIban(a), a).toBe(call('ppIban', a));
      for (const d of ['2026-10-31', '2026-11-01']) expect(ppAccTxt(a, d), a + d).toBe(call('ppAccTxt', a, d));
      expect(ppAccTxt(a, '2026-01-01', true)).toBe(call('ppAccTxt', a, '2026-01-01', true));
    }
  });
});

describe('FX rates vs legacy getFx (6494)', () => {
  it('firm codebook → office list → FX_DEF', () => {
    const firmRates = [{ code: 'EUR', rate: 61.6, date: '2026-03-01' }, { code: 'usd', rate: 55, date: '2026-04-01' }];
    const office = [{ cur: 'EUR', rate: 61.55, date: '2026-02-01' }, { cur: 'GBP', rate: 72.1, date: '2026-01-15' }, { cur: 'CHF', rate: 66, date: '' }];
    L.S.cb = firmRates;
    L.S.gfx = { rows: office };
    for (const [cur, date] of [['EUR', '2026-03-10'], ['EUR', '2026-02-10'], ['USD', '2026-03-10'], ['USD', '2026-04-02'], ['GBP', '2026-01-01'], ['GBP', '2026-02-01'], ['CHF', '2026-01-01'], ['MKD', '2026-01-01'], ['TRY', '2026-01-01'], ['XYZ', '2026-01-01'], ['eur', '2026-03-10']]) {
      expect(fxRate(cur!, date!, { firm: firmRates.map((x) => ({ cur: x.code, rate: x.rate, date: x.date })), office }), `${cur} ${date}`).toBe(call('getFx', cur, date));
    }
  });
});

describe('statement numbers vs legacy ensureIzvNos (3474)', () => {
  const run = async (existing: Record<string, string>, acct: string, dates: string[], given: string) => {
    L.S.firm = { id: 'f1', izv: structuredClone(existing) };
    L.S.izvNos = {};
    L.S.args = [acct, dates, given];
    await L.run<Promise<unknown>>('ensureIzvNos(...S.args)');
    return plain(L.S.izvNos) as Record<string, string>;
  };
  it('single-date files and files without a number: equal', async () => {
    const ex = { '2026-03-01': '40', '2026-03-02': '41', 'eur:2026-03-01': '9' };
    for (const [acct, dates, given] of [['main', ['2026-03-05'], '45'], ['main', ['2026-03-05', '2026-03-06'], ''], ['eur', ['2026-03-07'], ''], ['main', ['2026-03-01'], '99'], ['main', ['2025-12-31'], '']] as [string, string[], string][]) {
      expect(assignStatementNumbers(ex, acct, dates, given), `${acct} ${dates}`).toEqual(await run(ex, acct, dates, given));
    }
  });
  it('FIX #12: a multi-date statement keeps its number on its latest date', async () => {
    const ex = { '2026-03-01': '40' };
    expect(await run(ex, 'main', ['2026-03-05', '2026-03-06'], '47')).toEqual({ '2026-03-05': '41', '2026-03-06': '42' }); // legacy ignored 47
    expect(assignStatementNumbers(ex, 'main', ['2026-03-05', '2026-03-06'], '47')).toEqual({ '2026-03-05': '41', '2026-03-06': '47' });
  });
});

describe('transit residue vs legacy trResid (12570)', () => {
  it('per-day residue on 1039/1009 within 5 %', () => {
    const lines = [
      { k: '1039', date: '2026-03-20', d: 61500, p: 61450 }, { k: '1039', date: '2026-03-21', d: 100, p: 0 },
      { k: '1009', date: '2026-03-20', d: 50000, p: 0 }, { k: '1009', date: '2026-03-20', d: 0, p: 49990 }, { k: '1009', date: '2026-03-22', d: 10, p: 1000 },
      { k: '1000', date: '2026-03-20', d: 5, p: 0 },
    ];
    L.S.ledger = lines;
    const leg = call<{ k: string; date: string; r: number }[]>('trResid');
    const mine = transitResidue(lines.map((l) => ({ ...l, d: c(l.d), p: c(l.p) })));
    expect(mine).toEqual(leg.map((x) => ({ ...x, r: c(x.r) })));
    expect(transitCloseLines(mine[0]!)).toEqual([{ k: '4810', d: 5000, p: 0 }, { k: '1039', d: 0, p: 5000 }]);
  });
  it('statementGaps (izvGaps 12597)', () => {
    const sal = { '2026-03-01': { o: 0, c: 100 }, '2026-03-02': { o: 100, c: 150 }, '2026-03-04': { o: 170, c: 200 }, 'eur:2026-03-01': { o: 5, c: 6 }, 'eur:2026-03-02': { o: 6, c: 1 } };
    expect(statementGaps(sal, F.firm.banks, 2026)).toEqual([{ acct: 'main', a: { d: '2026-03-02', o: 100, c: 150 }, b: { d: '2026-03-04', o: 170, c: 200 }, diff: 20 }]);
  });
});

describe('cp1251 decoding', () => {
  it('every byte matches Node’s windows-1251 decoder', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const node = new TextDecoder('windows-1251').decode(all);
    expect(decodeCp1251(all)).toBe(node);
  });
  it('detects UTF-8 vs cp1251 and the XML declaration', () => {
    const s = 'Плаќање ѓ ќ љ њ џ ѕ ј № – €';
    expect(decodeBankBytes(new TextEncoder().encode(s))).toBe(s);
    const enc = (t: string) => { const dec = new TextDecoder('windows-1251'); const m = new Map<string, number>(); for (let b = 0; b < 256; b++) m.set(dec.decode(new Uint8Array([b])), b); return new Uint8Array([...t].map((ch) => m.get(ch)!)); };
    expect(decodeBankBytes(enc(s))).toBe(s);
    expect(decodeBankBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });
});
