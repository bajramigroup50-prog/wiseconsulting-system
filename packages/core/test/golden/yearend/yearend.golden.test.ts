/**
 * Golden tests: the new year-end engine against the legacy functions (loaded from legacy/index.html into `vm`).
 *
 * Every comparison runs the port in `legacy: true` mode first and requires EXACT equality. The default (fixed)
 * behaviour is then compared against legacy and may differ only where a deliberate fix says so — each such
 * expectation is commented with the fix id from src/yearend/YEAREND.md.
 */
import { describe, expect, it } from 'vitest';
import {
  carryForwardLines,
  closeYearLines,
  computeAnnualAccount,
  computeDb,
  computeNpo,
  computeSoleTrader,
  computeVp,
  crmRules,
  crmXml,
  DB_F,
  DB_MIG,
  DE38,
  DE38_AUTO,
  deAuto,
  depEntries,
  depFor,
  deVals,
  f35Rows,
  NKD21,
  NKD35,
  npoCloseLines,
  NPO_ACC,
  NPO_BS,
  NPO_CO,
  NPO_PR,
  NPO_SCH,
  openYearLines,
  parseCrmXml,
  yeBalanceSet,
  zcFindings,
  ZS_DEF,
  ZS_FIX,
  zsRules,
  type AnnualAccountInput,
  type YeLine,
  type ZsResult,
} from '../../../src/yearend';
import { DOO, DOOEL, NPO, TP, ledgerLines, legacyWorld, trialBalance, type Fixture } from './fixtures';
import { legacyAccountNames, legacyRuntime, type LegacyJournal } from './legacy';

type LegacyZs = { V: Record<string, number>; closed: boolean; st: { profit: number }; manual?: boolean; rounded?: { aop: string; d: number } };

const toYe = (lines: LegacyJournal['lines']): YeLine[] => lines.map((l) => ({ account: l.k, debit: +l.d || 0, credit: +l.p || 0, ...(l.partner ? { partner: l.partner } : {}) }));

function input(fx: Fixture, extra: Partial<AnnualAccountInput> = {}): AnnualAccountInput {
  const dates = fx.entries.map((e) => e[0]).sort();
  return {
    year: fx.year,
    tb: trialBalance(fx),
    firm: structuredClone(fx.firm) as AnnualAccountInput['firm'],
    payroll: (fx.payroll ?? []).map((p) => ({ month: p.month, employees: p.emps.length, tax: p.T.tax, contrib: p.T.pio + p.T.zdr + p.T.dop + p.T.vrab })),
    activeEmployees: (fx.employees ?? []).filter((e) => e.active !== false).length,
    firstPostingMonth: dates[0]?.slice(0, 7) ?? '',
    ...extra,
  };
}

const diffKeys = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).sort();

/* ============================================================ reference data ============================================================ */

describe('year-end reference data equals the legacy constants', () => {
  const rt = legacyRuntime({ year: 2025, firm: {}, data: { journal: [] } });
  it('ZS_DEF (205 rows) and ZS_FIX', () => {
    expect(ZS_DEF).toHaveLength(205);
    expect(ZS_DEF).toEqual(rt.get('ZS_DEF'));
    expect(ZS_FIX).toEqual(rt.get('ZS_FIX'));
  });
  it('DB_F and DB_MIG', () => {
    expect(DB_F).toHaveLength(79);
    expect(DB_F).toEqual(rt.get('DB_F'));
    expect(DB_MIG).toEqual(rt.get('DB_MIG'));
  });
  it('DE38 and DE38_AUTO', () => {
    expect(DE38).toHaveLength(124);
    expect(DE38).toEqual(rt.get('DE38'));
    expect(DE38_AUTO).toEqual(rt.get('Object.fromEntries(Object.entries(DE38_AUTO).map(([k,[a,n]])=>[k,[a.source,n.source]]))'));
  });
  it('NPO forms, chart, scheme and company map', () => {
    expect(NPO_ACC).toEqual(rt.get('NPO_ACC'));
    expect(NPO_SCH).toEqual(rt.get('NPO_SCH'));
    expect(NPO_CO).toEqual(rt.get('NPO_CO'));
    const norm = (R: unknown[][]) => R.map((r) => (r[3] === undefined || r[3] === null ? r.slice(0, 3) : [r[0], r[1], r[2], r[3], r[4], r[5] ?? '']));
    expect(NPO_BS).toEqual(norm(rt.get('NPO_BS')));
    expect(NPO_PR).toEqual(norm(rt.get('NPO_PR')));
  });
  it('NKD35 and NKD21', () => {
    expect(NKD35).toEqual(rt.get('NKD35'));
    expect(NKD21).toHaveLength(651);
    expect(NKD21).toEqual(rt.get('NKD21'));
  });
});

/* ============================================================ AOP engine ============================================================ */

const CO_FIXTURES = [DOO, DOOEL, TP];

describe.each(CO_FIXTURES.map((fx) => [fx.name, fx] as const))('zsCompute — %s', (_n, fx) => {
  const rt = legacyRuntime(legacyWorld(fx));
  const L = rt.call<LegacyZs>('zsCompute', fx.year);

  it('legacy mode: every AOP equal', () => {
    const N = computeAnnualAccount(input(fx, { legacy: true }));
    expect(N.zs.V).toEqual(L.V);
    expect(N.zs.closed).toBe(L.closed);
    expect(N.zs.profit).toBe(L.st.profit);
    expect(N.zs.rounded).toEqual(L.rounded);
  });

  it('default: only the provisional-tax AOPs differ (fix F1), and the balance sheet still balances', () => {
    const N = computeAnnualAccount(input(fx));
    const tax = N.db.tax;
    expect(N.zs.V.bu252).toBe(tax);
    const d = diffKeys(N.zs.V, L.V);
    // F3: bs077/bs078 rebuilt from the rounded bu255/bu256 (±1), which moves the ±3 A/P rounding to another row
    const f3 = ['bs065', 'bs077', 'bs078', 'bs081', 'bs095', 'bs111', ...[N.zs.rounded, L.rounded].filter(Boolean).map((r) => 'bs' + r!.aop)];
    // F1: bu252 = ДБ tax → net result rows; bs077 net profit; bs101 current tax liabilities → liability totals
    const f1 = tax ? ['bu252', 'bu255', 'bu256', 'bu269', 'bu270', 'bu288', 'bu291', 'bs101'] : [];
    expect(d.filter((k) => !f1.includes(k) && !f3.includes(k))).toEqual([]);
    if (tax) {
      expect(Math.abs(N.zs.V.bs101! - L.V.bs101! - tax)).toBeLessThanOrEqual(3);
      expect(L.V.bu255! - N.zs.V.bu255!).toBe(tax);
    }
    expect(N.zs.V.bs063).toBe(N.zs.V.bs111);
    // ЦРМ rules 2022 / 2024 hold after F3
    expect(N.zs.V.bs077!).toBeLessThanOrEqual(N.zs.V.bu255!);
    expect(N.zs.V.bs078!).toBeLessThanOrEqual(N.zs.V.bu256!);
  });

  it('ДБ equals legacy dbData', () => {
    const N = computeAnnualAccount(input(fx, { legacy: true }));
    const LD = rt.call<{ V: Record<string, number>; tax: number }>('dbData');
    expect(N.db.V).toEqual(LD.V);
    expect(N.db.tax).toBe(LD.tax);
  });

  it('ДБ-ВП equals legacy vpData', () => {
    const N = computeAnnualAccount(input(fx, { legacy: true }));
    const LV = rt.call<Record<string, unknown>>('vpData');
    const f = fx.firm as { name?: string; nkd?: string };
    const V = computeVp(N.zs, (fx.firm as { vpAdj?: Record<number, object> }).vpAdj?.[fx.year] ?? null, N.db.akAuto, f);
    expect(V).toEqual(LV);
  });
});

describe('zsCompute with manual amounts (zsMan)', () => {
  const fx: Fixture = { ...DOO, firm: { ...DOO.firm, zsMan: { 2025: { bs037: 1_500_000, bu203: 25_000 } } } };
  const rt = legacyRuntime(legacyWorld(fx));
  const L = rt.call<LegacyZs>('zsCompute', 2025);
  it('legacy mode equals legacy (including the rounding pass overwriting the manual bs037)', () => {
    const N = computeAnnualAccount(input(fx, { legacy: true }));
    expect(N.zs.V).toEqual(L.V);
    expect(N.zs.manual).toBe(true);
    expect(L.V.bs037).not.toBe(1_500_000); // the legacy bug F2
  });
  it('F2: manual totals are kept', () => {
    const N = computeAnnualAccount(input(fx));
    expect(N.zs.V.bs037).toBe(1_500_000);
    expect(N.zs.V.bu203).toBe(25_000);
  });
});

/* ============================================================ close / carry-forward ============================================================ */

describe.each([DOO, DOOEL].map((fx) => [fx.name, fx] as const))('closing the year — %s', (_n, fx) => {
  it('close journal, closed AOPs and opening of next year equal legacy', async () => {
    const world = legacyWorld(fx);
    const rt = legacyRuntime(world);
    const saved = await rt.callAsync('closeYear');
    const close = saved.find((s) => s.obj.id === 'close-' + fx.year)!.obj as LegacyJournal & { tax: number; profit: number; net: number };
    const B = yeBalanceSet(trialBalance(fx));
    const C = closeYearLines(B.pre, close.tax);
    expect(C.lines).toEqual(toYe(close.lines));
    expect([C.profit, C.tax, C.net]).toEqual([close.profit, close.tax, close.net]);

    // with ДБ adjustments legacy already takes the ДБ tax; without them it used r2(10%) — the port always uses ДБ (fix F1/close)
    const open = computeAnnualAccount(input(fx));
    if ((fx.firm as { dbAdj?: unknown }).dbAdj) expect(open.db.tax).toBe(close.tax);

    const L = rt.call<LegacyZs>('zsCompute', fx.year);
    const N = computeAnnualAccount(input(fx, { legacy: true, close: { tax: close.tax, lines: toYe(close.lines) } }));
    expect(N.zs.V).toEqual(L.V);
    expect(N.zs.closed).toBe(true);
    // closed year, default mode: only F3 may differ (951/961 balance vs rounded bu255/256, ±1 → A/P rounding row)
    const N2 = computeAnnualAccount(input(fx, { close: { tax: close.tax, lines: toYe(close.lines) } }));
    const f3 = ['bs065', 'bs077', 'bs078', 'bs081', 'bs095', 'bs111', ...[N2.zs.rounded, L.rounded].filter(Boolean).map((r) => 'bs' + r!.aop)];
    expect(diffKeys(N2.zs.V, L.V).filter((k) => !f3.includes(k))).toEqual([]);
    expect(N2.zs.V.bs077).toBe(N2.zs.V.bu255);
    expect(N2.zs.V.bs078).toBe(N2.zs.V.bu256);
    expect(N2.zs.V.bs063).toBe(N2.zs.V.bs111);
    // F1: the income statement before close (default mode) already shows the closed figures
    for (const k of ['bu250', 'bu251', 'bu252', 'bu255', 'bu256', 'bs077', 'bs078']) expect([k, open.zs.V[k]]).toEqual([k, N2.zs.V[k]]);

    // carry forward: 951/961 → 950/960
    const saved2 = await rt.callAsync('openYear', fx.year);
    const op = saved2.find((s) => s.obj.id === 'open-' + (fx.year + 1))!.obj;
    const all = yeBalanceSet(trialBalance(fx), toYe(close.lines)).all;
    const pb = ledgerLines(fx)
      .filter((l) => l.partner && /^(12|22)/.test(l.k))
      .map((l) => ({ account: l.k, partner: l.partner!, balance: (+l.d || 0) - (+l.p || 0) }));
    const mine = openYearLines(all, pb);
    const norm = (L: YeLine[]) => [...L].sort((a, b) => (a.account + (a.partner ?? '')).localeCompare(b.account + (b.partner ?? '')));
    expect(norm(mine)).toEqual(norm(toYe(op.lines)));
    expect(mine.some((l) => /^9[56]1/.test(l.account))).toBe(false);
  });
});

describe('carryForwardLines', () => {
  it('remaps 951/961 and nets 950/960', () => {
    expect(
      carryForwardLines([
        { account: '950', debit: 0, credit: 1000 },
        { account: '951', debit: 0, credit: 400 },
        { account: '9510', debit: 0, credit: 100 },
        { account: '961', debit: 50, credit: 0 },
      ]),
    ).toEqual([
      { account: '950', debit: 0, credit: 1500 },
      { account: '960', debit: 50, credit: 0 },
    ]);
  });
});

/* ============================================================ ЦРМ ============================================================ */

describe('ЦРМ: form 38, form 35, rules and XML (ДОО)', () => {
  const fx = DOO;
  const rt = legacyRuntime(legacyWorld(fx));
  const names = legacyAccountNames();
  const N = computeAnnualAccount(input(fx, { legacy: true }));
  // previous year: no bookings in 2024, so only bu257/bu258 (employees, months) are non-zero — as in legacy
  const prevEmpty: ZsResult = computeAnnualAccount({ year: 2024, tb: [], firm: fx.firm as never, activeEmployees: 4, legacy: true }).zs;

  it('deAuto / deVals', () => {
    const auto = deAuto(N.balances.pre, names, N.zs);
    const Lde = rt.call<{ V: Record<string, number>; a: Record<string, number> }>('deVals', 2025);
    expect(auto).toEqual(Object.fromEntries(Object.entries(Lde.a).map(([k, v]) => [+k, v])));
    expect(deVals(null, auto)).toEqual(Object.fromEntries(Object.entries(Lde.V).map(([k, v]) => [+k, v])));
  });

  it('f35Rows', () => {
    expect(f35Rows(N.balances.pre, fx.firm as never)).toEqual(rt.call('f35Rows', 2025));
  });

  it('crmRules', () => {
    const D = deVals(null, deAuto(N.balances.pre, names, N.zs));
    expect(crmRules(N.zs, D)).toEqual(rt.call('crmRules', 2025));
  });

  it.each([[{}], [{ prev: true }], [{ zeros: true }]])('crmXml %j', (opt) => {
    const D = deVals(null, deAuto(N.balances.pre, names, N.zs));
    const xml = crmXml(
      { year: 2025, current: N.zs, previous: prevEmpty, rules: zsRules(), de38: D, f35: f35Rows(N.balances.pre, fx.firm as never), embs: '7001234', period: 1 },
      opt,
    );
    expect(xml).toBe(rt.call('crmXml', 2025, opt));
  });

  it('parseCrmXml reads back what crmXml wrote', () => {
    const D = deVals(null, deAuto(N.balances.pre, names, N.zs));
    const xml = crmXml({ year: 2025, current: N.zs, previous: prevEmpty, rules: zsRules(), de38: D, f35: f35Rows(N.balances.pre, fx.firm as never), embs: '7001234' }, { zeros: true });
    const P = parseCrmXml(xml);
    expect(P.year).toBe(2025);
    expect(P.period).toBe(1);
    for (const x of zsRules()) expect(P.cur[x.r + x.aop]).toBe(Math.round(N.zs.V[x.r + x.aop] || 0));
    expect(Object.keys(P.f35)).toEqual(f35Rows(N.balances.pre, fx.firm as never).map((r) => String(r.aop)));
    expect(Object.keys(P.f35)).toEqual(['4382']); // 46.900 → NKD21 index 382
  });
});

/* ============================================================ sole trader ============================================================ */

describe('ТП — Образец Б / ДЛД-ДБ', () => {
  const rt = legacyRuntime(legacyWorld(TP));
  const L = rt.call<Record<string, unknown> & { res: number; tax: number; E: [string, number][] }>('tpData');
  it('legacy mode equals tpData', () => {
    expect(computeSoleTrader(2025, trialBalance(TP), TP.firm as never, { legacy: true })).toEqual(L);
  });
  it('T1: result and tax unchanged, cost of goods no longer netted into income', () => {
    const N = computeSoleTrader(2025, trialBalance(TP), TP.firm as never);
    expect([N.res, N.tax, N.diff]).toEqual([L.res, L.tax, L.diff]);
    expect(L.E.at(-1)![1]).toBeLessThan(0); // legacy "Останати расходи" negative
    expect(N.E.at(-1)![1]).toBeGreaterThanOrEqual(0);
    expect(N.inc).toBe(3_120_450.25);
  });
});

/* ============================================================ NPO ============================================================ */

describe('НПО', () => {
  it('NPO chart: open year, close journal and closed year equal legacy', async () => {
    const world = legacyWorld(NPO);
    const rt = legacyRuntime(world);
    const L = rt.call<Record<string, unknown>>('npoCompute', 2025);
    const N = computeNpo(trialBalance(NPO), null, NPO.firm as never);
    expect(N).toEqual(L);
    expect(N.tax).toBeGreaterThan(0);

    const saved = await rt.callAsync('__ACT.npoClose');
    const cl = saved.find((s) => s.obj.id === 'close-2025')!.obj as LegacyJournal & { profit: number; tax: number; net?: number };
    const B = yeBalanceSet(trialBalance(NPO));
    const C = npoCloseLines(B.pre, N, 'npo');
    expect(C.lines).toEqual(toYe(cl.lines));
    expect([C.profit, C.tax]).toEqual([cl.profit, cl.tax]);
    expect(cl.net).toBeUndefined(); // legacy bug (§8.4 item 16) …
    expect(C.net).toBe(Math.round((N.sur - N.tax) * 100) / 100); // … fixed

    const L2 = rt.call<Record<string, unknown>>('npoCompute', 2025);
    expect(computeNpo(trialBalance(NPO), { lines: C.lines }, NPO.firm as never)).toEqual(L2);
  });

  it('company chart (co mode, NPO_CO map) equals legacy', () => {
    const fx: Fixture = { ...DOOEL, firm: { ...DOOEL.firm, ent: 'npo' } };
    const rt = legacyRuntime(legacyWorld(fx));
    expect(computeNpo(trialBalance(fx), null, fx.firm as never)).toEqual(rt.call('npoCompute', 2025));
  });
});

/* ============================================================ depreciation ============================================================ */

describe('depreciation', () => {
  const rt = legacyRuntime(legacyWorld(DOO));
  it('legacy mode equals depFor and runDep', async () => {
    const L = rt.call<{ rows: unknown[]; total: number }>('depFor', 2025);
    const N = depFor(DOO.assets!, 2025, { legacy: true });
    expect(N).toEqual(L);
    const saved = await rt.callAsync('__ACT.runDep');
    expect(depEntries(N.rows, { legacy: true })).toEqual(toYe(saved.at(-1)!.obj.lines));
  });
  it('D1/D3: vehicleOnly skipped, credit per accumulated-depreciation group', () => {
    const N = depFor(DOO.assets!, 2025);
    expect(N.rows.map((r) => r.id)).toEqual(['a1', 'a2', 'a4', 'a5']);
    const E = depEntries(N.rows);
    expect(E).toEqual([
      { account: '4300', debit: 30_000, credit: 0 },
      { account: '4301', debit: 125_000, credit: 0 },
      { account: '4302', debit: 296_000 + 4_500, credit: 0 },
      { account: '0092', debit: 0, credit: 30_000 },
      { account: '0192', debit: 0, credit: 125_000 },
      { account: '0193', debit: 0, credit: 300_500 },
    ]);
    expect(E.some((l) => l.account === '0190')).toBe(false);
  });
});

/* ============================================================ phase gate ============================================================ */

describe('zcFindings (phase gate)', () => {
  const fx: Fixture = {
    ...DOO,
    extra: {
      bank: [
        { date: '2025-11-03', acct: 'main', amount: -1200 },
        { date: '2025-12-20', acct: 'main', konto: '1200', amount: 5000 },
      ],
      invoices: [
        { date: '2025-05-05', partner: null },
        { date: '2025-05-06', partner: 'p1' },
      ],
      purchases: [{ date: '2025-05-07', partner: null }],
      sales: [{ date: '2025-08-01', pend: true }],
      items: [
        { id: 'i1', name: 'Брашно', unit: 'кг', type: 'goods' },
        { id: 'i2', name: 'Услуга', type: 'service' },
      ],
      moves: [
        { item: 'i1', qty: 10, date: '2025-02-01' },
        { item: 'i1', qty: -25, date: '2025-03-01' },
        { item: 'i1', qty: 20, date: '2025-04-01' },
        { item: 'i2', qty: -5, date: '2025-04-01' },
      ],
    },
  };
  // a receivable partner with an overpayment and a 12xx balance without partner
  fx.entries = [...DOO.entries, ['2025-12-30', '1000', '1200', 250_000, undefined, 'p2'], ['2025-12-30', '1200', '1000', 3_000]];
  const world = legacyWorld(fx);
  world.today = '2026-02-01';
  const rt = legacyRuntime(world);
  const L = rt.call<{ key: string; sev: string; area: string }[]>('zcFindings', 2025);
  it('same findings (key, severity, area) as legacy', () => {
    const d = world.data as Record<string, { date?: string; pend?: boolean }[]>;
    const N = zcFindings({
      year: 2025,
      today: '2026-02-01',
      lines: ledgerLines(fx),
      partnerName: (id) => DOO.partners!.find((p) => p.id === id)?.name,
      moves: fx.extra!.moves as never,
      items: Object.fromEntries((fx.extra!.items as { id: string; name?: string }[]).map((i) => [i.id, i])),
      bank: fx.extra!.bank as never,
      pendingDocs: ['invoices', 'purchases', 'sales', 'docs'].flatMap((c) => d[c] ?? []),
      assets: DOO.assets,
      journalIds: [],
      invoices: fx.extra!.invoices as never,
      purchases: fx.extra!.purchases as never,
    });
    const pick = (x: { key: string; sev: string; area: string }[]) => x.map(({ key, sev, area }) => ({ key, sev, area }));
    expect(pick(N)).toEqual(pick(L));
    expect(N.map((x) => x.key)).toEqual(expect.arrayContaining(['np12', 'p12|p2', 'st|i1|main', 'bank', 'pend', 'dep', 'invnp', 'purnp', 'izvEnd|main']));
  });
});

describe('computeDb', () => {
  it('maps legacy dbAdj keys and computes tax at 10%', () => {
    const D = computeDb({ V: { bu250: 1_000_000.4 } }, { rep: 50_000, '42': 10_000, akont: 30_000 }, 0);
    expect(D.V['15']).toBe(50_000);
    expect(D.V['49']).toBe(1_040_000);
    expect(D.tax).toBe(104_000);
    expect(D.V['59']).toBe(74_000);
  });
});
