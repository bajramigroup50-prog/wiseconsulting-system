/**
 * Payroll → journal lines (legacy `payrollEntries2`, `payMatch`, `SCH0`/`SCH_OLD` pay_* keys).
 *
 * DELIBERATE FIX (LEGACY-MAP 6.4 #3): legacy `sch()` treated any value equal to `SCH_OLD[k]`
 * as "unset", so a deliberate `pay_net = '2400'` silently posted to 2401. `resolvePayScheme`
 * honours every explicit value; the legacy guard is still available as `legacyOldGuard` for the
 * legacy importer (old firms that still carry 4200/2410… values).
 * Payroll v1 (`payrollCalc`/`payrollEntries`, SCH_OLD accounts, no callers) is not ported (#2).
 */
import { r2 } from '../money';
import { empCalc, payTotals, type PayEmp } from './calc';
import { resolvePayParams, type PayParamRow, type PayParams } from './params';

export const PAY_SCH_KEYS = [
  'pay_gross',
  'pay_via',
  'pay_eTax',
  'pay_ePio',
  'pay_eZdr',
  'pay_eDop',
  'pay_eVrab',
  'pay_net',
  'pay_contrib',
  'pay_ded',
  'pay_pio',
  'pay_zdr',
  'pay_vrab',
  'pay_dop',
  'pay_tax',
] as const;
export type PaySchKey = (typeof PAY_SCH_KEYS)[number];
/** Account per payroll posting role; `'-'` (or empty) = role switched off. */
export type PayScheme = Record<PaySchKey, string>;

/** Default payroll accounts (legacy `SCH0` pay_* keys). */
export const PAY_SCH0: Readonly<PayScheme> = {
  pay_gross: '4210',
  pay_via: '2400',
  pay_eTax: '-',
  pay_ePio: '-',
  pay_eZdr: '-',
  pay_eDop: '-',
  pay_eVrab: '-',
  pay_net: '2401',
  pay_contrib: '2349',
  pay_ded: '2492',
  pay_pio: '2341',
  pay_zdr: '2342',
  pay_vrab: '2344',
  pay_dop: '2343',
  pay_tax: '2340',
};

/** Pre-2026 payroll accounts (legacy `SCH_OLD` pay_* keys). */
export const PAY_SCH_OLD: Readonly<Partial<PayScheme>> = {
  pay_net: '2400',
  pay_gross: '4200',
  pay_eTax: '4201',
  pay_ePio: '42020',
  pay_eZdr: '42021',
  pay_eDop: '42022',
  pay_eVrab: '42023',
  pay_pio: '2410',
  pay_zdr: '2411',
  pay_vrab: '2412',
  pay_dop: '2413',
  pay_tax: '2420',
};

type SchLayer = Partial<Record<string, string | undefined>> | null | undefined;

/**
 * Resolve the payroll scheme: firm override → office-wide override → `PAY_SCH0`; empty values are
 * ignored. With `legacyOldGuard` values equal to `PAY_SCH_OLD` are ignored too (legacy `sch()`).
 */
export function resolvePayScheme(firmSch?: SchLayer, globalSch?: SchLayer, opts: { legacyOldGuard?: boolean } = {}): PayScheme {
  const out = {} as PayScheme;
  for (const k of PAY_SCH_KEYS) {
    const ok = (v: string | undefined): v is string => v !== undefined && v !== null && v !== '' && !(opts.legacyOldGuard && v === PAY_SCH_OLD[k]);
    const f = firmSch?.[k],
      g = globalSch?.[k];
    out[k] = ok(f) ? f : ok(g) ? g : PAY_SCH0[k];
  }
  return out;
}

const on = (S: PayScheme, k: PaySchKey): boolean => !!S[k] && S[k] !== '-';

/** Journal line produced by the payroll posting. Amounts in denars (2 decimals). */
export interface PayJournalLine {
  account: string;
  partnerId?: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface PayrollRun {
  month: string;
  params?: Partial<PayParams> | null;
  emps: PayEmp[];
}

/**
 * Journal lines for a v2 payroll run (legacy `payrollEntries2`): credits per contribution fund,
 * PIT, net payable, deductions; optional `pay_via` clearing pair; optional employer-expense split
 * (`pay_e*`); debit gross expense. Lines with the same account and side are merged. The gross is
 * adjusted by the "УЈП rounding" difference (net + obligations − gross) so the entry balances.
 */
export function payrollEntries2(p: PayrollRun, scheme: PayScheme = PAY_SCH0, overrides: readonly PayParamRow[] = []): PayJournalLine[] {
  const P = resolvePayParams(p.params, p.month, overrides);
  const A = { gross: 0, net: 0, pio: 0, zdr: 0, dop: 0, vrab: 0, tax: 0, dopl: 0, dPio: 0, dZdr: 0, dDop: 0, dVrab: 0, ded: 0 };
  for (const e of p.emps) {
    const c = empCalc(e, P);
    for (const k of Object.keys(A) as (keyof typeof A)[]) A[k] += c.T[k] || 0;
  }
  type L = { k: string; d: number; p: number; note?: string };
  const ex = (key: PaySchKey, v: number): L | null => (on(scheme, key) ? { k: scheme[key], d: v, p: 0 } : null);
  const eT = A.tax,
    eP = A.pio + A.dPio,
    eZ = A.zdr + A.dZdr,
    eD = A.dop + A.dDop,
    eV = A.vrab + A.dVrab;
  const E = [ex('pay_eTax', eT), ex('pay_ePio', eP), ex('pay_eZdr', eZ), ex('pay_eDop', eD), ex('pay_eVrab', eV)].filter((x): x is L => !!x);
  const split = E.reduce((a, l) => a + l.d, 0);
  const G0 = r2(A.gross + A.dopl);
  const rd = r2(A.net + A.ded + A.pio + A.zdr + A.dop + A.vrab + A.tax - A.gross);
  const G = r2(G0 + rd); /* rounding like УЈП (net + obligations) */
  const via: L[] = on(scheme, 'pay_via')
    ? [
        { k: scheme.pay_via, d: 0, p: G, note: 'Бруто плата' },
        { k: scheme.pay_via, d: G, p: 0, note: 'Распоред на бруто плата' },
      ]
    : [];
  const contrib = (
    [
      ['pay_pio', A.pio + A.dPio],
      ['pay_zdr', A.zdr + A.dZdr],
      ['pay_dop', A.dop + A.dDop],
      ['pay_vrab', A.vrab + A.dVrab],
      ['pay_tax', A.tax],
    ] as const
  ).map(([key, v]): L => ({ k: on(scheme, key) ? scheme[key] : scheme.pay_contrib, d: 0, p: r2(v) }));
  const all: L[] = [
    ...contrib,
    { k: scheme.pay_net, d: 0, p: A.net },
    ...(A.ded ? [{ k: scheme.pay_ded || '2492', d: 0, p: r2(A.ded), note: 'Задршки од плата' }] : []),
    ...via,
    ...E.map((l) => ({ ...l, d: r2(l.d) })),
    { k: scheme.pay_gross, d: r2(G - split), p: 0 },
  ];
  const M: L[] = [];
  for (const l of all) {
    const x = M.find((y) => y.k === l.k && !!y.d === !!l.d);
    if (x) {
      x.d = r2(x.d + l.d);
      x.p = r2(x.p + l.p);
    } else M.push({ ...l });
  }
  return M.filter((l) => l.d || l.p).map((l) => ({ account: l.k, debit: l.d, credit: l.p, ...(l.note ? { note: l.note } : {}) }));
}

export interface PayMatch {
  month: string;
  konto: string;
  split?: { k: string; a: number; n: string }[];
}

/**
 * Match a bank amount to a payroll liability (net, contributions + PIT, contributions, PIT, PIO,
 * health) of the latest v2 payroll not after `date` (legacy `payMatch`).
 */
export function payMatch(
  payrolls: readonly (PayrollRun & { v?: number })[],
  amt: number,
  date: string | undefined,
  scheme: PayScheme = PAY_SCH0,
  overrides: readonly PayParamRow[] = [],
): PayMatch | null {
  const near = (x: number) => x > 0 && Math.abs(x - amt) < 1;
  const K = (key: PaySchKey) => (on(scheme, key) ? scheme[key] : scheme.pay_contrib);
  const mg = (L: { k: string; a: number; n: string }[]) => {
    const M: { k: string; a: number; n: string }[] = [];
    for (const x of L) {
      if (!x.a) continue;
      const y = M.find((z) => z.k === x.k);
      if (y) {
        y.a = r2(y.a + x.a);
        y.n += ' + ' + x.n;
      } else M.push({ ...x, a: r2(x.a) });
    }
    return M;
  };
  const list = payrolls.filter((p) => p.v === undefined || p.v === 2).sort((a, b) => (a.month < b.month ? 1 : -1));
  for (const p of list) {
    if (date && date < p.month + '-01') continue;
    const T = payTotals(p.emps || [], resolvePayParams(p.params, p.month, overrides));
    const pio = T.pio + T.dPio,
      zdr = T.zdr + T.dZdr,
      dop = T.dop + T.dDop,
      vrab = T.vrab + T.dVrab;
    const contr = pio + zdr + dop + vrab;
    const parts = [
      { k: K('pay_pio'), a: pio, n: 'ПИО' },
      { k: K('pay_zdr'), a: zdr, n: 'Здравство' },
      { k: K('pay_dop'), a: dop, n: 'Доп. здравство' },
      { k: K('pay_vrab'), a: vrab, n: 'Вработување' },
    ];
    if (near(T.net)) return { month: p.month, konto: scheme.pay_net };
    if (T.emps.some((x) => near(x.net))) return { month: p.month, konto: scheme.pay_net };
    if (near(contr + T.tax)) {
      const sp = mg([...parts, { k: K('pay_tax'), a: T.tax, n: 'Персонален данок' }]);
      return { month: p.month, konto: sp[0]!.k, ...(sp.length > 1 ? { split: sp } : {}) };
    }
    if (near(contr)) {
      const sp = mg(parts);
      return { month: p.month, konto: sp[0]!.k, ...(sp.length > 1 ? { split: sp } : {}) };
    }
    if (near(T.tax)) return { month: p.month, konto: K('pay_tax') };
    if (near(pio)) return { month: p.month, konto: K('pay_pio') };
    if (near(zdr)) return { month: p.month, konto: K('pay_zdr') };
  }
  return null;
}
