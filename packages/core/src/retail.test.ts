import { describe, expect, it } from 'vitest';
import {
  artAnalyze, artApplyAbbr, artFixName, artKey, artPickMaster, artRole, artRules, artSim, artUnit, couponCheck, detectDec, eanBits, eanCheck,
  eanNextInternal, eanValid, findCard, impAuto, impDate, impHeaderRow, impNum, impPurchaseGroups, isNoNameItem, lotBalance, marginPct,
  mrpCalc, nextPrefixedNo, onOrderByItem, orderRest, orderState, posDiscount, priceCalc, productionCost, rasPlanCount, rasPlanPct,
  replenishment, reservedByItem, toCyr,
} from './retail';

describe('price calculator (kalkCalc)', () => {
  it('cost + transport, margin %, VAT', () => {
    expect(priceCalc({ cost: 100, trans: 20, margin: 25, rate: 18 })).toEqual({ nab: 120, marg: 30, net: 150, vat: 27, retail: 177 });
    expect(priceCalc({ cost: '', rate: 18 })).toEqual({ nab: 0, marg: 0, net: 0, vat: 0, retail: 0 });
    expect(marginPct(200, 150)).toBe(25);
    expect(marginPct(0, 150)).toBe(0);
  });
});

describe('EAN-13', () => {
  it('check digit and validation', () => {
    expect(eanCheck('400638133393')).toBe('1');
    expect(eanValid('4006381333931')).toBe(true);
    expect(eanValid('4006381333932')).toBe(false);
    expect(eanValid('123')).toBe(false);
    expect(eanBits('4006381333931')).toHaveLength(95);
  });
  it('next internal 29… code skips used ones', () => {
    const first = eanNextInternal([]);
    expect(first).toBe('2900000000018');
    expect(eanValid(first)).toBe(true);
    expect(eanNextInternal([first])).toBe('2900000000025');
  });
});

describe('item clean-up (artQ)', () => {
  const R = artRules({ 'чок.': 'чоколадо' }, { бр: 'ком' });
  it('keys normalise units, Latin and abbreviations', () => {
    expect(artKey('Kafe 200 gr')).toBe(artKey('Кафе 200г'));
    expect(artKey('Чок. млечно', R.abbr)).toBe('чоколадо млечно');
    expect(toCyr('shishe')).toBe('шише');
    expect(artSim(artKey('Кафе 200г'), artKey('Кафе 500г'))).toBe(0);
    expect(artSim('кафе голд 200г', 'кафе голдд 200г')).toBeGreaterThan(0.75);
  });
  it('units and abbreviations', () => {
    expect(artUnit('KG', R)).toBe('кг');
    expect(artUnit('бр', R)).toBe('ком');
    expect(artUnit('кут', R)).toBe('кут');
    expect(artUnit('xyz', R)).toBe('xyz');
    expect(artApplyAbbr('Чок. млечно 100г', { 'Чок.': 'Чоколадо' })).toBe('Чоколадо млечно 100г');
    expect(artFixName('  КАФЕ  ГОЛД МК 200Г ')).toBe('Кафе Голд МК 200Г');
  });
  it('analysis: duplicates by name, code, barcode; missing data', () => {
    const items = [
      { id: 'a', code: '1', name: 'Кафе 200г', unit: 'ком', price: 100, rate: 18, type: 'goods' },
      { id: 'b', code: '', name: 'kafe 200 gr', unit: 'kom', price: 100, rate: 18, type: 'goods' },
      { id: 'c', code: '1', name: 'Чај', unit: 'ком', price: 0, rate: 7, type: 'goods' },
      { id: 'd', code: '5', name: 'Сол', unit: 'кг', price: 10, rate: 5, type: 'goods', barcodes: ['111'] },
      { id: 'e', code: '6', name: 'Сол морска', unit: 'кг', price: 10, rate: 5, type: 'goods', barcodes: ['111'] },
    ];
    const A = artAnalyze(items, R, { stockOf: (id) => (id === 'd' ? -2 : 0) });
    const ids = A.groups.map((g) => g.map((i) => i.id).sort().join(''));
    expect(ids).toEqual(expect.arrayContaining(['ab', 'ac', 'de']));
    const m = Object.fromEntries(A.miss.map((x) => [x.i.id, x.p]));
    expect(m.c).toEqual(expect.arrayContaining(['ДДВ стапка', 'продажна цена']));
    expect(m.b).toContain('единица „kom“ → „ком“');
    expect(m.d![0]).toMatch(/залиха во минус/);
    expect(artAnalyze(items, R, { filter: { code: 'without' } }).I.map((i) => i.id)).toEqual(['b']);
    expect(artAnalyze(items, R, { filter: { pref: '5-6' } }).I.map((i) => i.id)).toEqual(['d', 'e']);
  });
  it('master: with code, then more moves', () => {
    const g = [{ id: 'x', name: 'A', code: '' }, { id: 'y', name: 'A', code: '7' }, { id: 'z', name: 'A', code: '8' }];
    expect(artPickMaster(g, (id) => (id === 'z' ? 5 : 1)).id).toBe('z');
    expect(isNoNameItem({ name: 'Артикл 123', code: '123' })).toBe(true);
    expect(isNoNameItem({ name: 'Артикл 123', code: '12' })).toBe(false);
    expect(artRole({ type: 'goods', rawK: '3100' })).toBe('prod');
  });
});

describe('orders, replenishment, MRP', () => {
  const lines = [{ itemId: 'a', name: 'A', qty: 5, price: 10, rate: 18 }, { itemId: 'a', name: 'A2', qty: 3, price: 10, rate: 18 }, { itemId: 'b', name: 'B', qty: 2, price: 1, rate: 18 }];
  it('delivered quantities are consumed line by line', () => {
    const R = orderRest(lines, { a: 6 });
    expect(R.map((l) => [l.dl, l.rest])).toEqual([[5, 0], [1, 2], [0, 2]]);
    expect(orderState({ id: 'o', status: 'open', lines }, { a: 6 })).toBe('part');
    expect(orderState({ id: 'o', status: 'open', lines }, { a: 8, b: 2 })).toBe('done');
    expect(orderState({ id: 'o', status: 'cancel', lines }, {})).toBe('cancel');
    const res = reservedByItem([{ id: 'o', status: 'open', lines }, { id: 'p', status: 'open', lines: [lines[2]!] }], (id): Record<string, number> => (id === 'o' ? { a: 6 } : {}), 'p');
    expect(res.get('a')).toBe(2);
    expect(res.get('b')).toBe(2);
    expect(onOrderByItem([{ status: 'open', lines: [{ itemId: 'a', qty: 4 }] }, { status: 'recv', lines: [{ itemId: 'a', qty: 9 }] }]).get('a')).toBe(4);
  });
  it('replenishment suggestion', () => {
    const rows = replenishment([{ id: 'a', type: 'goods', min: 5 }, { id: 'b', type: 'service' }, { id: 'c', type: 'goods' }], {
      cfg: { lead: 7, cover: 14, days: 90 }, outQty: new Map([['a', 90], ['c', 0]]), stockOf: (id) => (id === 'a' ? 10 : 0),
      reserved: new Map([['a', 2]]), onOrder: new Map([['a', 3]]),
    });
    // daily 1 × 21 + 5 − (10 − 2 + 3) = 15
    expect(rows.map((r) => [r.i.id, r.sug, r.days])).toEqual([['a', 15, 8]]);
  });
  it('MRP explodes semi-products using their free stock first', () => {
    const I: Record<string, { id: string; type: string; bom?: { item: string; qty: number }[] }> = {
      P: { id: 'P', type: 'product', bom: [{ item: 'S', qty: 2 }, { item: 'M', qty: 1 }] },
      S: { id: 'S', type: 'product', bom: [{ item: 'M', qty: 3 }] },
      M: { id: 'M', type: 'material' },
    };
    const r = mrpCalc({ P: 10 }, { item: (id) => I[id], stockOf: (id) => (id === 'S' ? 5 : id === 'M' ? 20 : 0), reserved: new Map(), onOrder: new Map([['M', 4]]) });
    // S: need 20, 5 from stock, produce 15 → M 45; plus M 10 directly = 55; short = 55 − 20 − 4 = 31
    expect(r.mats).toEqual([{ id: 'M', q: 55, st: 20, res: 0, oo: 4, short: 31 }]);
    expect(r.prods).toEqual(expect.arrayContaining([{ id: 'P', q: 10 }, { id: 'S', q: 15 }]));
  });
  it('document numbers per year', () => {
    expect(nextPrefixedNo([{ number: 'НР-004/2026', date: '2026-03-01' }, { number: 'НР-009/2025', date: '2025-03-01' }], 'НР-', '2026-05-01')).toBe('НР-005/2026');
    expect(nextPrefixedNo([], 'НД-', '2027-01-02')).toBe('НД-001/2027');
  });
});

describe('production cost, write-off without BOM, lots', () => {
  it('overheads spread by material value', () => {
    const R = productionCost([{ productId: 'a', qty: 10, mat: 300, lab: 100 }, { productId: 'b', qty: 5, mat: 100, lab: 0 }, { productId: 'a', qty: 10, mat: 300, lab: 100 }],
      { overhead: 700, basis: 'mat', std: (id) => (id === 'a' ? 50 : 0), price: (id) => (id === 'a' ? 100 : 0) });
    const a = R.find((x) => x.productId === 'a')!;
    expect(a.ohA).toBe(600);
    expect(a.real).toBe(70);
    expect(a.var).toBe(40);
    expect(a.mar).toBe(30);
    expect(R.find((x) => x.productId === 'b')!.var).toBeNull();
  });
  const rows = [
    { itemId: 'm', a: { qty: 10, value: 100 }, iq: 10, iv: 300, oq: 5, now: { qty: 15, avg: 20 } },
    { itemId: 'n', a: { qty: 0, value: 0 }, iq: 0, iv: 0, oq: 0, now: { qty: 4, avg: 10 } },
  ];
  it('by count: opening + received − issued − counted', () => {
    const P = rasPlanCount(rows, { m: 3 });
    expect(P[0]).toMatchObject({ avg: 20, q: 12, v: 240 });
    expect(P[1]).toMatchObject({ q: 0, v: 0 });
  });
  it('as % of sales spread by stock value', () => {
    const P = rasPlanPct(rows, 1000, 17);
    // total 170; stock values 300 / 40 → 150 / 20
    expect(P.map((x) => x.v)).toEqual([150, 20]);
    expect(P[0]!.q).toBe(7.5);
  });
  it('FEFO lot balance', () => {
    const L = [
      { itemId: 'a', qty: 10, lot: 'L1', exp: '2026-01-10', date: '2025-12-01', src: 'x' },
      { itemId: 'a', qty: 10, lot: 'L2', exp: '2026-03-10', date: '2025-12-05', src: 'y' },
    ];
    expect(lotBalance(L, 12).map((l) => [l.lot, l.on])).toEqual([['L1', 2], ['L2', 10]]);
    expect(lotBalance(L, 0)).toEqual([]);
  });
});

describe('loyalty and coupons', () => {
  const cards = [{ id: '1', no: '2800000001', name: 'Ана', phone: '070 123 456', disc: 5, points: 300 }];
  const cps = [{ id: 'c', code: 'JESEN', kind: 'pct' as const, val: 10, from: '2026-09-01', to: '2026-10-31', max: 2, used: 1, minTotal: 500 }];
  it('finds cards and checks coupons', () => {
    expect(findCard(cards, '070123456')?.id).toBe('1');
    expect(findCard(cards, '2800000001')?.id).toBe('1');
    expect(couponCheck(cps, 'jesen', 1000, '2026-10-01')).toMatchObject({ disc: 100 });
    expect(couponCheck(cps, 'jesen', 100, '2026-10-01')).toHaveProperty('err');
    expect(couponCheck(cps, 'jesen', 1000, '2026-11-01')).toHaveProperty('err');
    expect(couponCheck(cps, 'x', 1000, '2026-10-01')).toEqual({ err: 'Купонот не постои.' });
  });
  it('card discount, coupon, then points', () => {
    const cp = couponCheck(cps, 'JESEN', 950, '2026-10-01');
    const d = posDiscount(1000, { card: cards[0], coupon: cp, usePts: true, rules: { per: 100, val: 1, min: 100 } });
    expect(d).toMatchObject({ tot: 1000, disc: 445, pay: 555, red: 300, redPts: 300 });
  });
});

describe('import helpers', () => {
  it('recognises columns, decimals and dates', () => {
    expect(impAuto('items', ['Шифра', 'Назив на артикл', 'Баркод', 'Цена'])).toMatchObject({ code: 0, name: 1, barcode: 2, price: 3 });
    expect(impHeaderRow([['Лагер листа'], ['', ''], ['Шифра', 'Назив', 'Кол'], ['1', 'А', '2']])).toBe(2);
    expect(detectDec([['1.234,50', '12,5']])).toBe('comma');
    expect(impNum('1.234,50', 'comma')).toBe(1234.5);
    expect(impNum('1,234.50')).toBe(1234.5);
    expect(impNum('12,5')).toBe(12.5);
    expect(impNum('')).toBe(0);
    expect(impDate('5.9.2026')).toBe('2026-09-05');
    expect(impDate(46000)).toBe('2025-12-09');
    expect(impDate('x')).toBe('');
  });
  it('purchase groups from amounts', () => {
    const v: Record<string, number> = { base18: 1000, base5: 500, total: 0 };
    expect(impPurchaseGroups((k) => v[k] ?? 0, () => false, '4000')).toEqual([
      { account: '4000', rate: 18, base: 1000, vat: 180 }, { account: '4000', rate: 5, base: 500, vat: 25 },
    ]);
    expect(impPurchaseGroups((k) => (k === 'total' ? 118 : 0), () => false, '4000')).toEqual([{ account: '4000', rate: 18, base: 100, vat: 18 }]);
  });
});
