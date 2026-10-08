/**
 * Golden tests: bank matching & classification vs the legacy `autoMatch` chain (13073 → 12775 → 12666
 * → 12646 → 12590 → 12500 → 4818) and the legacy `save('bank')` wrappers, run in Node `vm`.
 * Every deliberate difference is asserted explicitly and labelled FIX.
 */
import { describe, expect, it } from 'vitest';
import {
  autoMatch, classifyImported, fxDifference, pairConversions, virtualAdvances, openDocsFor, fifoPick, linkPayment,
  type BankRow, type MatchContext, type OpenDoc,
} from '../../../src/bank-match';
import * as F from './fixtures/match-fixture';
import { loadLegacy, plain } from './legacy';

const c = (x: number | null | undefined) => (x == null ? undefined : Math.round(Math.round(x * 100) / 100 * 100) || 0);
const clone = <T,>(x: T): T => structuredClone(x);
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

type LRow = Record<string, any>;
const toPortRow = (r: LRow): BankRow => drop({ ...r, amount: c(r.amount)!, amountCur: c(r.amountCur), settle: c(r.settle), refs: r.refs?.map((x: LRow) => ({ ...x, amt: c(x.amt) })), lines: undefined }) as BankRow;
const toPortDoc = (d: LRow): OpenDoc => drop({ ...d, total: c(d.total)!, paidOther: c(d.paidOther) }) as OpenDoc;

interface Setup { rows: LRow[]; invoices?: LRow[]; purchases?: LRow[]; partners?: LRow[]; firm?: LRow; pay?: LRow[]; year?: number }
const base = (s: Partial<Setup> = {}): Setup => ({ rows: F.rows, invoices: F.invoices, purchases: F.purchases, partners: F.partners, firm: F.firm, pay: F.pay, year: 2026, ...s });

function portCtx(s: Setup): MatchContext {
  const f = s.firm || F.firm;
  return {
    rows: s.rows.map(toPortRow),
    accounts: f.banks,
    invoices: (s.invoices || []).map(toPortDoc),
    purchases: (s.purchases || []).map(toPortDoc),
    partners: s.partners || [],
    year: s.year,
    firmName: f.name,
    rules: f.rules,
    osnovK: f.osnovK,
    posPartner: f.posP,
    konta: { pos: f.posK },
    payMatch: (amt, date) => { const m = (s.pay || []).find((x) => Math.abs(c(x.amount)! - amt) < 100 && (!date || date >= x.month + '-01')); return m ? { month: m.month, konto: m.konto } : null; },
  };
}

async function legacyAutoMatch(s: Setup, noVirt = true) {
  const L = loadLegacy();
  Object.assign(L.S, { year: s.year, firm: clone(s.firm || F.firm), pay: clone(s.pay || []), _noVirt: noVirt });
  Object.assign(L.S.data, { bank: clone(s.rows), invoices: clone(s.invoices || []), purchases: clone(s.purchases || []), partners: clone(s.partners || []) });
  await L.run<Promise<unknown>>('autoMatch()');
  return { rows: plain(L.S.data.bank) as LRow[], log: (plain(L.S.log) as LRow[]).map((x) => x.id as string) };
}

const projLegacy = (r: LRow) => drop({ id: r.id, konto: r.konto, partner: r.partner, ref: r.ref, refs: r.refs?.map((x: LRow) => ({ ...x, amt: c(x.amt) })), settle: c(r.settle), split: r.split, pos: r.pos, own: r.own, conv: r.conv, payRef: r.payRef });
const projPort = (r: BankRow) => drop({ id: r.id, konto: r.konto, partner: r.partner, ref: r.ref, refs: r.refs, settle: r.settle, split: r.split, pos: r.pos, own: r.own, conv: r.conv, payRef: r.payRef });

describe('autoMatch vs legacy (full 7-layer chain)', () => {
  it('a month of rows: POS, VAT, payment codes, FX invoices, number/amount/subset matches, fees, payroll, rules', async () => {
    const s = base();
    const leg = await legacyAutoMatch(s);
    const mine = autoMatch(portCtx(s));
    expect(mine.rows.map(projPort)).toEqual(leg.rows.map(projLegacy));
    expect(mine.changes.map((x) => x.id)).toEqual(leg.log);
    expect(mine.needPosPartner).toBe(false);

    const how = Object.fromEntries(mine.changes.map((x) => [x.id, x.how]));
    expect(how).toEqual({
      b14: 'pos', b5: 'vat', b15: 'osnov', b9: 'fx', b10: 'fx',
      b1: 'num', b2: 'amt', b4: 'num', b8: 'sum', b17: 'num', b18: 'amt', b19: 'num',
      b3: 'fee', b11: 'invoice', b12: 'rule', b13: 'fee', b16: 'payroll',
    });
    const row = (id: string) => mine.rows.find((r) => r.id === id)!;
    expect(row('b8').refs).toEqual([{ type: 'invoice', id: 'i4', label: '48/2026', amt: 1500000 }, { type: 'invoice', id: 'i5', label: '52/2026', amt: 700000 }]);
    expect(row('b17').refs?.map((r) => [r.id, r.amt])).toEqual([['i9', 1200000], ['i10', 800000]]);
    expect(row('b19').konto).toBe('2210'); // import supplier
    expect(row('b7').konto).toBeUndefined(); // advance without invoice stays open
  });

  it('FX differences equal the 7810/4810 lines legacy bankEntries posted', async () => {
    const s = base();
    const leg = await legacyAutoMatch(s);
    const mine = autoMatch(portCtx(s));
    for (const id of ['b9', 'b10']) {
      const l = leg.rows.find((r) => r.id === id)!;
      const fxLine = (l.lines as LRow[]).find((x) => x.k === '7810' || x.k === '4810')!;
      const d = fxDifference(mine.rows.find((r) => r.id === id)!);
      expect(d).toEqual({ konto: fxLine.k, side: fxLine.d ? 'd' : 'p', amount: c(fxLine.d || fxLine.p) });
    }
    expect(fxDifference(mine.rows.find((r) => r.id === 'b9')!)).toEqual({ konto: '7810', side: 'p', amount: 10000 });
    expect(fxDifference(mine.rows.find((r) => r.id === 'b10')!)).toEqual({ konto: '7810', side: 'p', amount: 2500 });
    expect(fxDifference({ amount: -61600, ref: { type: 'purchase', id: 'x', label: '' }, settle: 61500 })).toEqual({ konto: '4810', side: 'd', amount: 100 });
    expect(fxDifference({ amount: -61400, ref: { type: 'purchase', id: 'x', label: '' }, settle: 61500 })).toEqual({ konto: '7810', side: 'p', amount: 100 });
  });

  it('running it again changes nothing (idempotent), like legacy', async () => {
    const s = base();
    const first = autoMatch(portCtx(s));
    const again = autoMatch({ ...portCtx(s), rows: first.rows });
    expect(again.changes).toEqual([]);
  });

  it('POS partner missing → reported, not created', () => {
    const mine = autoMatch({ ...portCtx(base({ rows: [F.rows.find((r) => r.id === 'b14')!] })), posPartner: undefined });
    expect(mine.needPosPartner).toBe(true);
    expect(mine.rows[0]).toMatchObject({ konto: '1200001', pos: true });
  });
});

describe('autoMatch — deliberate fixes', () => {
  it('FIX #3: base layer books an import purchase on its supplier konto (legacy 2200)', async () => {
    const s = base({
      rows: [{ id: 'x1', acct: 'main', date: '2025-12-28', amount: -5000, desc: 'Плаќање увоз' }],
      purchases: [{ id: 'u3', number: 'INV-2025-90', partner: 'p6', total: 5000, date: '2025-12-01', imp: true, supKonto: '2215' }],
    });
    const leg = await legacyAutoMatch(s);
    const mine = autoMatch(portCtx(s));
    expect(leg.rows[0]).toMatchObject({ konto: '2200', ref: { id: 'u3' } });
    expect(mine.rows[0]).toMatchObject({ konto: '2215', ref: { id: 'u3' }, partner: 'p6' });
  });

  it('FIX #8: a payment larger than the open amount is capped; the rest stays an advance', async () => {
    const s = base({
      rows: [{ id: 'x2', acct: 'main', date: '2026-03-20', amount: 1500, desc: 'АБЦ ТРЕЈД ДООЕЛ – по фактура 61/2026', name: 'АБЦ ТРЕЈД ДООЕЛ' }],
      invoices: [{ id: 'i61', number: '61/2026', partner: 'p1', total: 1000, date: '2026-03-01' }],
    });
    const leg = await legacyAutoMatch(s);
    expect(leg.rows[0]!.ref).toMatchObject({ id: 'i61' });
    expect(leg.rows[0]!.refs).toBeUndefined(); // legacy: the whole 1500 counts as paid on a 1000 invoice
    const mine = autoMatch(portCtx(s));
    expect(mine.rows[0]).toMatchObject({ ref: { id: 'i61' }, refs: [{ id: 'i61', amt: 100000 }] });
    expect(mine.changes[0]!.excess).toBe(50000);
  });

  it('FIX #8: multi-invoice payment smaller than the invoices drops zero allocations', async () => {
    const s = base({
      rows: [{ id: 'x3', acct: 'main', date: '2026-03-20', amount: 500, desc: 'АБЦ ТРЕЈД ДООЕЛ – фактури бр. 62/2026 и 63/2026', name: 'АБЦ ТРЕЈД ДООЕЛ' }],
      invoices: [{ id: 'a', number: '62/2026', partner: 'p1', total: 600, date: '2026-03-01' }, { id: 'b', number: '63/2026', partner: 'p1', total: 600, date: '2026-03-02' }],
    });
    const leg = await legacyAutoMatch(s);
    expect(leg.rows[0]!.refs.map((r: LRow) => r.amt)).toEqual([500, 0]);
    const mine = autoMatch(portCtx(s));
    expect(mine.rows[0]!.refs).toBeUndefined();
    expect(mine.rows[0]!.ref).toEqual({ type: 'invoice', id: 'a', label: '62/2026' });
  });

  it('FIX #7: open amounts ignore virtual advances (legacy base layer missed exact matches)', async () => {
    const s = base({
      rows: [
        { id: 'adv', acct: 'main', date: '2025-11-02', amount: 3000, desc: 'Гама Комерц – аванс', partner: 'p3' },
        { id: 'pay', acct: 'main', date: '2025-12-20', amount: 10000, desc: 'Гама Комерц – уплата' },
      ],
      invoices: [{ id: 'z1', number: 'Z-1/2025', partner: 'p3', total: 10000, date: '2025-12-01' }],
    });
    const legVirt = await legacyAutoMatch(s, false);
    expect(legVirt.rows.find((r) => r.id === 'pay')!.ref).toBeUndefined();
    const legReal = await legacyAutoMatch(s, true);
    expect(legReal.rows.find((r) => r.id === 'pay')!.ref).toMatchObject({ id: 'z1' });
    const mine = autoMatch(portCtx(s));
    expect(mine.rows.map(projPort)).toEqual(legReal.rows.map(projLegacy));
  });

  it('pending (client-submitted) documents are never matched (legacy base layer matched them)', async () => {
    const s = base({
      rows: [{ id: 'x4', acct: 'main', date: '2025-12-20', amount: 700, desc: 'уплата' }],
      invoices: [{ id: 'pn', number: '9/2025', partner: 'p2', total: 700, date: '2025-12-01', pend: true }],
    });
    const leg = await legacyAutoMatch(s);
    expect(leg.rows[0]!.ref).toMatchObject({ id: 'pn' });
    expect(autoMatch(portCtx(s)).rows[0]!.ref).toBeUndefined();
  });
});

describe('virtualAdvances vs legacy bkVirt (12529)', () => {
  it('unlinked partner payments applied FIFO to the oldest open invoices', async () => {
    const rows = [
      { id: 'a1', acct: 'main', date: '2026-03-02', amount: 12000, desc: 'аванс', partner: 'p3' },
      { id: 'a2', acct: 'main', date: '2026-03-03', amount: 20000, desc: 'аванс 2', partner: 'p3', konto: '1200' },
      { id: 'a3', acct: 'main', date: '2026-03-03', amount: -800, desc: 'плаќање', partner: 'p2' },
      { id: 'a4', acct: 'main', date: '2026-03-04', amount: 900, desc: 'POS', partner: 'p4', konto: '1200001', pos: true },
    ];
    const s = base({ rows });
    const L = loadLegacy();
    Object.assign(L.S, { year: 2026, firm: clone(F.firm) });
    Object.assign(L.S.data, { bank: clone(rows), invoices: clone(F.invoices), purchases: clone(F.purchases), partners: clone(F.partners) });
    const leg = plain(L.run<{ V: Record<string, number>; ADV: LRow[] }>('bkVirt()'));
    const mine = virtualAdvances(portCtx(s));
    expect(mine.V).toEqual(Object.fromEntries(Object.entries(leg.V).map(([k, v]) => [k, c(v)])));
    expect(mine.ADV.map((a) => [a.type, a.pid, a.paid, a.applied, a.left, a.pays.map((p) => p.id)]))
      .toEqual(leg.ADV.map((a) => [a.type, a.pid, c(a.paid), c(a.applied), c(a.left), a.pays.map((p: LRow) => p.id)]));
    expect(mine.V).toEqual({ invoicei3: 1000000, invoicei4: 1500000, invoicei5: 700000, purchaseu1: 80000 });
  });
});

describe('manual linking vs legacy bmOpenFor / bmLink', () => {
  it('open documents and FIFO pick', async () => {
    const b = { id: 'm1', acct: 'main', date: '2026-03-20', amount: 30000, desc: 'Гама Комерц – уплата', partner: 'p3' };
    const s = base({ rows: [b] });
    const L = loadLegacy();
    Object.assign(L.S, { year: 2026, firm: clone(F.firm) });
    Object.assign(L.S.data, { bank: clone([b]), invoices: clone(F.invoices), purchases: clone(F.purchases), partners: clone(F.partners) });
    const lo = plain(L.run<{ type: string; pid: string; O: LRow[] }>('bmOpenFor(S.data.bank[0])'));
    const ctx = portCtx(s);
    const mo = openDocsFor(ctx.rows[0]!, ctx);
    expect([mo.type, mo.pid, mo.O.map((z) => [z.x.id, z.o])]).toEqual([lo.type, lo.pid, lo.O.map((z) => [z.x.id, c(z.o)])]);
    const pick = fifoPick(ctx.rows[0]!, mo.O);
    expect(pick.map((z) => z.x.id)).toEqual(['i3', 'i4', 'i5']);
    await L.run('bmLink(S.data.bank[0],(()=>{const {O}=bmOpenFor(S.data.bank[0]);let rem=30000;const P=[];for(const z of O){if(rem<=0.009)break;P.push(z);rem=r2(rem-z.o)}return P})(),"invoice")');
    const lrow = plain(L.S.data.bank[0]) as LRow;
    const r = linkPayment(ctx.rows[0]!, pick, 'invoice')!;
    // legacy gave the last invoice the remainder 5000 on a 7000 invoice — within its open amount, so equal
    expect(projPort(r.row)).toEqual(projLegacy(lrow));
    expect(r.excess).toBe(0);
  });
});

describe('classifyImported vs legacy save chain (13072 → 12758 → 12568 → 12421, convPair 12772)', () => {
  const rows: LRow[] = [
    { id: 'c1', acct: 'main', date: '2026-03-20', amount: 9850, desc: 'CASYS POS PRILIV' },
    { id: 'c2', acct: 'main', date: '2026-03-20', amount: -61500, desc: 'Откуп на девизи EUR 1000' },
    { id: 'c3', acct: 'eur', date: '2026-03-21', amount: -61500, amountCur: -1000, cur: 'EUR', desc: 'Продажба на девизи' },
    { id: 'c4', acct: 'main', date: '2026-03-20', amount: -50000, desc: 'ВАЈС КОНСАЛТИНГ ДООЕЛ – пренос на средства', name: 'ВАЈС КОНСАЛТИНГ ДООЕЛ' },
    { id: 'c5', acct: 'main', date: '2026-03-20', amount: -3000, desc: 'Бета ДОО - плаќање', name: 'Бета ДОО' },
    { id: 'c6', acct: 'main', date: '2026-03-20', amount: 700, desc: 'Нов Купувач ДООЕЛ – уплата', name: 'Нов Купувач ДООЕЛ', konto: '1200' },
    { id: 'c7', acct: 'eur', date: '2026-03-20', amount: 61450, amountCur: 1000, cur: 'EUR', desc: 'Пренос од сопствена сметка 270000012345678' },
    { id: 'c8', acct: 'main', date: '2026-03-20', amount: 1000, desc: 'Непознат' },
  ];

  it('same konto / partner / flags as the legacy save chain', async () => {
    const L = loadLegacy();
    Object.assign(L.S, { year: 2026, firm: clone(F.firm) });
    Object.assign(L.S.data, { bank: [], invoices: clone(F.invoices), purchases: clone(F.purchases), partners: clone(F.partners) });
    for (const r of rows) { L.S.row = clone(r); await L.run<Promise<unknown>>('saveBank(S.row)'); }
    const leg = plain(L.S.data.bank) as LRow[];

    const ctx = portCtx(base({ rows }));
    const out = ctx.rows.map((r) => classifyImported(r, ctx));
    const paired = pairConversions(out.map((o) => o.row), ctx.accounts);
    const final = out.map((o) => paired.find((p) => p.id === o.row.id) || o.row);

    const pr = (r: LRow) => drop({ id: r.id, konto: r.konto, partner: r.partner, pos: r.pos, own: r.own, conv: r.conv });
    // c6: legacy silently created partner "new1"; the port reports it instead (FIX #5)
    expect(leg.find((r) => r.id === 'c6')!.partner).toMatch(/^new/);
    expect(out.find((o) => o.row.id === 'c6')!.newPartner).toBe('Нов Купувач ДООЕЛ');
    expect(final.map(pr)).toEqual(leg.map((r) => pr(r.id === 'c6' ? { ...r, partner: undefined } : r)));
    expect(out.map((o) => o.cls)).toEqual(['pos', 'conv', 'conv', 'own', null, null, 'own', null]);
    expect(final.find((r) => r.id === 'c7')).toMatchObject({ konto: '1030', conv: true, own: true }); // paired with c2
  });
});
