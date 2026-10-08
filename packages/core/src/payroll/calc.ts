/**
 * Gross/net payroll calculation (legacy `grossFromNet`, `empCalc`, `payTotals`, `g4n`, `stazFor`,
 * `fixRegular`, `catOf`, `HTYPES`, `PCAT`, `PXTRA`, `PSIF0`, `mpinRows`).
 *
 * Amounts are whole denars: every contribution / tax / gross / net figure is rounded with
 * `Math.round` exactly where legacy rounds, so totals are integer arithmetic. Net is computed
 * from the *unrounded* contributions and tax, like УЈП/МПИН (legacy comment "нето како УЈП").
 *
 * DELIBERATE FIXES vs. legacy:
 *  1. No rate fallbacks (PIO 18.8 / вработување 1.2): `empCalc` requires complete params,
 *     see `resolvePayParams` in ./params.
 *  2. Maximum contribution base (`maxBase`, 16 × average wage) is applied. Legacy ignored it
 *     and charged contributions on the full gross of high earners. When the month's gross
 *     exceeds `maxBase`, each line's contribution base is scaled by `maxBase / gross`;
 *     `grossFromNet` solves net → gross with the capped contributions.
 */
import { r2 } from '../money';
import PSIF_JSON from '../data/payroll-psif.json';
import { assertPayParams, type PayParams } from './params';

export type PayCat = 'reg' | 'dop' | 'bol' | 'odm' | 'kor' | 'sin';
type Num = number | string | null | undefined;
const n = (v: Num): number => +(v as number) || 0;

/** Hour types with default % (legacy `HTYPES`). */
export const HTYPES: readonly (readonly [string, number])[] = [
  ['Редовно работење', 100],
  ['Државен празник', 100],
  ['Годишен одмор', 100],
  ['Боледување до 30 дена', 70],
  ['Боледување над 30 дена (рефундација ФЗО)', 70],
  ['Боледување – повреда на работа / проф. болест', 100],
  ['Боледување – бременост / нега на дете (ФЗО)', 100],
  ['Породилно отсуство (плаќа ФЗО)', 0],
  ['Платено отсуство (брак, смрт, селидба…)', 100],
  ['Неплатено отсуство', 0],
  ['Верски празник (за припадници)', 100],
  ['Стручно оспособување / обука', 100],
  ['Прекин во работа не по вина на работникот', 70],
  ['Прекувремена работа', 135],
  ['Работа ноќе', 135],
  ['Работа на празник / неработен ден', 150],
  ['Работа во недела', 150],
];
/** Additional-hours types (no tax exemption share). Legacy `HT_ADD`. */
export const HT_ADD = (t: string): boolean => /^Прекувремена|^Работа ноќе|^Работа на празник|^Работа во недела/.test(t);

/** Payroll line categories (legacy `PCAT`). */
export const PCAT: readonly (readonly [PayCat, string])[] = [
  ['reg', 'Редовно работење'],
  ['dop', 'Дополнителни ставки'],
  ['bol', 'Боледување'],
  ['odm', 'Одмори'],
  ['kor', 'Корекции'],
  ['sin', 'Синдикат/Осигурување'],
];
/** Amount-only line types (legacy `PXTRA`). */
export const PXTRA: readonly (readonly [string, number, PayCat])[] = [
  ['Награда / бонус', 0, 'kor'],
  ['Казна / намалување', 0, 'kor'],
  ['Синдикална членарина', 0, 'sin'],
  ['Осигурување (задршка)', 0, 'sin'],
  ['Кредит / судска забрана (задршка)', 0, 'sin'],
];

/** Category of a line type (legacy `catOf`). */
export function payCatOf(t: unknown): PayCat {
  const s = String(t || '');
  if (/^Боледување|^Породилно/.test(s)) return 'bol';
  if (/одмор|отсуство/i.test(s)) return 'odm';
  if (HT_ADD(s)) return 'dop';
  const x = PXTRA.find((p) => p[0] === s);
  if (x) return x[2];
  return 'reg';
}

export interface PsifCode {
  code: string;
  name: string;
  cat: PayCat;
  pct: number;
  payer: string;
  mpin: string;
  basis: string;
}
/**
 * Payroll line codes 001–603 with legal basis (legacy `PSIF0`). This is the canonical %-table;
 * note legacy `HTYPES` / Excel import used other % for overtime/night/maternity (LEGACY-MAP 6.4 #13).
 */
export const PSIF0: readonly PsifCode[] = PSIF_JSON as PsifCode[];

/** `PSIF0` merged with the firm's `paysif` codebook rows (legacy `PSIF`). */
export function psifCodes(custom: readonly { code?: Num; name?: string; cat?: string; pct?: Num; payer?: string; mpin?: string; basis?: string }[] = []): PsifCode[] {
  const m = new Map<string, PsifCode>(PSIF0.map((r) => [r.code, { ...r }]));
  for (const r of custom) {
    if (!r.code) continue;
    const code = String(r.code);
    const o: Partial<PsifCode> = m.get(code) || {};
    m.set(code, {
      code,
      name: r.name || o.name || '',
      cat: PCAT.some((c) => c[0] === r.cat) ? (r.cat as PayCat) : o.cat || payCatOf(r.name),
      pct: r.pct !== '' && r.pct != null ? +r.pct : (o.pct ?? 100),
      payer: r.payer || o.payer || 'Работодавач',
      mpin: r.mpin ?? o.mpin ?? '',
      basis: r.basis || o.basis || '',
    });
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code, 'mk', { numeric: true }));
}

export interface PayLine {
  type: string;
  hours?: Num;
  /** Percentage of the hourly rate; empty/null = 100. */
  pct?: Num;
  /** Fixed gross amount (kor) or deduction from net (sin). */
  amt?: Num;
  cat?: PayCat | '';
  code?: string;
  payer?: string;
  mpin?: string;
}

/** One employee inside a payroll run (legacy `payroll.emps[]`). */
export interface PayEmp {
  empId: string;
  no?: string;
  name: string;
  embg?: string;
  /** Agreed net for a full month. */
  netBase?: Num;
  /** Agreed gross (when set, beats `netBase`). */
  grossBase?: Num;
  coef?: Num;
  /** Years of service (0.5 %/year seniority supplement). */
  stazY?: Num;
  /** Personal monthly hour fund (part-time). */
  hNorm?: Num;
  noTax?: boolean;
  inout?: 'full' | 'in' | 'out' | '';
  ioDate?: string;
  short?: unknown;
  union?: unknown;
  adv?: unknown;
  lines?: PayLine[];
}

export interface EmpCalcRow extends PayLine {
  hr: number;
  pc: number;
  gr: number;
  ex: number;
  pio: number;
  zdr: number;
  dop: number;
  vrab: number;
  dPio: number;
  dZdr: number;
  dDop: number;
  dVrab: number;
  tax: number;
  ded: number;
  net: number;
}

export interface EmpTotals {
  hours: number;
  gross: number;
  pio: number;
  zdr: number;
  dop: number;
  vrab: number;
  tax: number;
  net: number;
  ex: number;
  /** Employer top-up contributions up to the minimum base. */
  dopl: number;
  dPio: number;
  dZdr: number;
  dDop: number;
  dVrab: number;
  ded: number;
  contr: number;
}

export interface EmpCalc {
  netFull: number;
  base: number;
  /** Seniority supplement %. */
  mt: number;
  /** Final full-month gross. */
  Gf: number;
  Gc: number;
  /** Raised to the (pro-rated) minimum gross. */
  raised: boolean;
  minG: number;
  minB: number;
  /** Tax exemption for a full month. */
  E: number;
  /** Hour fund. */
  H: number;
  /** Factor applied to contribution bases because of `maxBase` (1 = no cap). */
  capK: number;
  rows: EmpCalcRow[];
  T: EmpTotals;
}

const rates = (P: PayParams) => ({ RP: P.pio / 100, RZ: P.zdr / 100, RD: P.dop / 100, RV: P.vrab / 100, RT: P.tax / 100 });

/**
 * Net → gross for a full month with personal exemption `E` (legacy `grossFromNet`, rounded up).
 * Requires complete params; with `maxBase` the contributions are capped (deliberate fix).
 */
export function grossFromNet(net: number, E: number, P: PayParams): number {
  assertPayParams(P);
  const c = (P.pio + P.zdr + P.dop + P.vrab) / 100,
    t = P.tax / 100;
  let G = (net - t * E) / ((1 - c) * (1 - t));
  if ((1 - c) * G <= E) G = net / (1 - c);
  const M = P.maxBase;
  if (M > 0 && G > M) {
    G = (net - t * E) / (1 - t) + c * M;
    if (G - c * M <= E) G = net + c * M;
  }
  return Math.ceil(G - 1e-9);
}

/** Gross for a full month: exactly `minGross` when the net is the statutory minimum net (legacy `g4n`). */
export function g4n(net: number, P: PayParams, ex: number): number {
  return +P.minNet && Math.abs(+net - +P.minNet) < 1 ? +P.minGross : grossFromNet(+net, ex, P);
}

/** Calculate one employee for a payroll month (legacy `empCalc`, v484/v486 patches included). */
export function empCalc(e: PayEmp, P: PayParams): EmpCalc {
  assertPayParams(P);
  const E = +P.exempt || 0,
    H = n(e.hNorm) || n(P.hours) || 176,
    minB = Math.round(P.minBase);
  const netFull = r2(n(e.netBase) * (n(e.coef) || 1));
  const { RP, RZ, RD, RV, RT } = rates(P);
  const minG = P.minGross;
  const base = n(e.grossBase) ? Math.round(n(e.grossBase) * (n(e.coef) || 1)) : grossFromNet(netFull, E, P);
  const mt = r2(n(e.stazY) * 0.5);
  const minN = P.minNet;
  const Gc = minG && minN && !mt && Math.abs(netFull - minN) < 1 ? minG : Math.round(base * (1 + mt / 100));
  /* v486: minimum gross pro-rated for part-time (coef < 1 or personal hour fund below the month's) */
  const coef = n(e.coef),
    hN = n(e.hNorm),
    PH = n(P.hours);
  const ptF = (coef && coef < 1 ? coef : 1) * (hN && PH && hN < PH ? hN / PH : 1);
  const minGs = Math.round(minG * ptF);
  const raised = !!minG && Gc < minGs;
  const Gf = raised ? minGs : Gc;

  const cat = (l: PayLine): PayCat => (l.cat || payCatOf(l.type)) as PayCat;
  const lines = (e.lines || []).filter((l) => n(l.hours) || n(l.amt));
  const grOf = (l: PayLine): number => {
    const hr = n(l.hours),
      pc = l.pct === '' || l.pct == null ? 100 : +l.pct;
    return !hr && n(l.amt) ? Math.round(n(l.amt)) : Math.round((Gf / H) * hr * pc / 100);
  };
  /* maximum contribution base (fix): scale every line's base when the month's gross exceeds it */
  const gTot = lines.reduce((s, l) => (cat(l) === 'sin' ? s : s + grOf(l)), 0);
  const capK = P.maxBase > 0 && gTot > P.maxBase ? P.maxBase / gTot : 1;

  const rows: EmpCalcRow[] = lines.map((l) => {
    if (cat(l) === 'sin') {
      const a = Math.round(n(l.amt));
      return { ...l, hr: 0, pc: 0, gr: 0, ex: 0, pio: 0, zdr: 0, dop: 0, vrab: 0, dPio: 0, dZdr: 0, dDop: 0, dVrab: 0, tax: 0, ded: a, net: -a };
    }
    const hr = n(l.hours),
      pc = l.pct === '' || l.pct == null ? 100 : +l.pct;
    const gr = grOf(l);
    /* v484: the exemption is monthly — none on overtime, Sunday, holiday and night work */
    const ex = cat(l) === 'dop' ? 0 : Math.round((E * hr) / H);
    const cb = capK === 1 ? gr : gr * capK;
    const pio = Math.round(cb * RP),
      zdr = Math.round(cb * RZ),
      dop = Math.round(cb * RD),
      vrab = Math.round(cb * RV);
    const diff = hr ? Math.max(0, (minB * hr) / H - gr) : 0;
    const dPio = Math.round(diff * RP),
      dZdr = Math.round(diff * RZ),
      dDop = Math.round(diff * RD),
      dVrab = Math.round(diff * RV);
    const cU = cb * (RP + RZ + RD + RV),
      taxU = e.noTax ? 0 : Math.max(0, gr - cU - ex) * RT;
    const tax = Math.round(taxU);
    return { ...l, hr, pc, gr, ex, pio, zdr, dop, vrab, dPio, dZdr, dDop, dVrab, tax, ded: 0, net: Math.round(gr - cU - taxU) };
  });
  const S_ = (f: keyof EmpCalcRow): number => rows.reduce((s, r) => s + (r[f] as number), 0);
  const T: EmpTotals = {
    hours: rows.filter((r) => cat(r) !== 'dop').reduce((s, r) => s + r.hr, 0),
    gross: S_('gr'),
    pio: S_('pio'),
    zdr: S_('zdr'),
    dop: S_('dop'),
    vrab: S_('vrab'),
    tax: S_('tax'),
    net: S_('net'),
    ex: S_('ex'),
    dopl: S_('dPio') + S_('dZdr') + S_('dDop') + S_('dVrab'),
    dPio: S_('dPio'),
    dZdr: S_('dZdr'),
    dDop: S_('dDop'),
    dVrab: S_('dVrab'),
    ded: S_('ded'),
    contr: 0,
  };
  T.contr = T.pio + T.zdr + T.dop + T.vrab;
  return { netFull, base, mt, Gf, Gc, raised, minG, minB, E, H, capK, rows, T };
}

export interface PayTotals {
  gross: number;
  net: number;
  pio: number;
  zdr: number;
  dop: number;
  vrab: number;
  tax: number;
  dopl: number;
  dPio: number;
  dZdr: number;
  dDop: number;
  dVrab: number;
  ded: number;
  emps: { e: PayEmp; net: number }[];
}

/** Totals of a payroll run; `P` must already be resolved (legacy `payTotals`). */
export function payTotals(emps: readonly PayEmp[], P: PayParams): PayTotals {
  const A: PayTotals = { gross: 0, net: 0, pio: 0, zdr: 0, dop: 0, vrab: 0, tax: 0, dopl: 0, dPio: 0, dZdr: 0, dDop: 0, dVrab: 0, ded: 0, emps: [] };
  for (const e of emps) {
    const c = empCalc(e, P);
    for (const k of ['gross', 'net', 'pio', 'zdr', 'dop', 'vrab', 'tax', 'dopl', 'dPio', 'dZdr', 'dDop', 'dVrab', 'ded'] as const) A[k] += c.T[k];
    A.emps.push({ e, net: c.T.net });
  }
  return A;
}

/** Recompute regular hours = fund − absences (legacy `fixRegular`; mutates `e.lines`). */
export function fixRegular(e: PayEmp, H: number): void {
  const L = e.lines || [];
  const reg = L.find((l) => l.type === 'Редовно работење');
  if (!reg) return;
  const abs = L.filter((l) => l !== reg && !HT_ADD(l.type) && !['dop', 'kor', 'sin'].includes(l.cat || '')).reduce((s, l) => s + n(l.hours), 0);
  reg.hours = Math.max(0, (+H || 0) - abs);
}

/** Years of service at the end of `month` (legacy `stazFor`). */
export function stazFor(e: { start?: string; stazY?: Num; stazPrev?: Num }, month: string): number {
  if (!e.start) return n(e.stazY);
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0));
  const st = new Date(e.start + 'T00:00:00Z');
  let y = end.getUTCFullYear() - st.getUTCFullYear();
  if (end.getUTCMonth() < st.getUTCMonth() || (end.getUTCMonth() === st.getUTCMonth() && end.getUTCDate() < st.getUTCDate())) y--;
  return Math.max(0, y) + n(e.stazPrev);
}

export interface MpinRow {
  no?: string;
  name: string;
  embg: string;
  hours: number;
  gross: number;
  /** Contribution base (at least the pro-rated minimum base). */
  base: number;
  pio: number;
  zdr: number;
  dop: number;
  vrab: number;
  ex: number;
  taxBase: number;
  tax: number;
  net: number;
  bankAcc: string;
  bank: string;
}

/** Rows for the MPIN Excel / payment orders (legacy `mpinRows`). */
export function mpinRows(emps: readonly PayEmp[], P: PayParams, employees: readonly { id: string; embg?: string; bankAcc?: string; bank?: string }[] = []): MpinRow[] {
  return emps.map((e) => {
    const c = empCalc(e, P);
    const E = employees.find((x) => x.id === e.empId) || ({} as { embg?: string; bankAcc?: string; bank?: string });
    const T = c.T;
    return {
      no: e.no,
      name: e.name,
      embg: e.embg || E.embg || '',
      hours: T.hours,
      gross: T.gross,
      /* fix: capped at maxBase like the contributions (legacy reported the full gross) */
      base: Math.min(P.maxBase > 0 ? P.maxBase : Infinity, Math.max(T.gross, Math.round((c.minB * T.hours) / c.H))),
      pio: T.pio + T.dPio,
      zdr: T.zdr + T.dZdr,
      dop: T.dop + T.dDop,
      vrab: T.vrab + T.dVrab,
      ex: T.ex,
      taxBase: Math.max(0, T.gross - T.contr - T.ex),
      tax: T.tax,
      net: T.net,
      bankAcc: E.bankAcc || '',
      bank: E.bank || '',
    };
  });
}
