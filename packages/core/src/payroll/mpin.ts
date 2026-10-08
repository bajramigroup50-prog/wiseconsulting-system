/**
 * MPIN — УЈП monthly payroll declaration as MPI3 `.txt` (legacy `mpinTxt` 6125 + wrapper 14734,
 * `mpinParse`, `MPIN_OPS`, `MPIN_FZO`, `MPIN_SKOPJE`, `mpOpsFrom`, `mpFzoFrom`, `mpinEmpCodes`).
 * Lines are `;`-separated, CRLF-terminated; the file is windows-1251 (`bytes`).
 *
 * DELIBERATE FIXES vs. legacy:
 *  - Header rates (line 1) come from the run's own resolved params — the same source used for the
 *    amounts — instead of `mpinOfficial` (PAY_DEF only). Legacy could emit a header that did not
 *    match the amounts (LEGACY-MAP 6.4 #8). Callers check `mpinParamDiff` before export, as
 *    legacy `mpinExport` did; when params equal the official row the bytes are identical.
 *  - Code precedence (#9): an explicit code on the employee beats the template, the template beats
 *    a code inferred from city/address, then the template/firm default. Legacy put the template
 *    first for 3.4б/3.4ц, so the warning (`opsMiss`, based on the employee) and the output could
 *    disagree. `opsMiss` now lists exactly the employees whose 3.4ц code falls back to the default
 *    or is not a valid municipality code.
 *  - The template is passed in explicitly; legacy auto-applied a hard-coded sample (with a real
 *    EDB) to a firm whose EDB matched it (#6) — that sample is now a test fixture only.
 */
import MPIN_OPS_JSON from '../data/payroll-mpin-ops.json';
import MPIN_FZO_JSON from '../data/payroll-mpin-fzo.json';
import { empCalc, type PayEmp } from './calc';
import { encodeCp1251 } from './cp1251';
import { resolvePayParams, type PayParamRow } from './params';
import type { PayrollRun } from './entries';

export interface MpinCode {
  code: string;
  name: string;
}
/** 3.4ц municipality of residence (Сл. весник 42/05). */
export const MPIN_OPS: readonly MpinCode[] = MPIN_OPS_JSON;
/** 3.4б ФЗО regional unit. */
export const MPIN_FZO: readonly MpinCode[] = MPIN_FZO_JSON;
/** Municipalities of the City of Skopje (→ ФЗО 4061). */
export const MPIN_SKOPJE: ReadonlySet<string> = new Set(['101', '130', '153', '164', '167', '128', '173', '175', '176', '177', '178', '179', '180', '181', '182', '183', '184', '185']);

const mpN = (x: unknown): string =>
  String(x || '')
    .toLowerCase()
    .replace(/[^а-шѓќљњџѕјa-z]/g, '');

/** Municipality code from free text (city/address); '' when ambiguous (bare "Скопје"). */
export function mpOpsFrom(txt: unknown): string {
  const t = mpN(txt);
  if (!t) return '';
  const L = MPIN_OPS.slice().sort((a, b) => b.name.length - a.name.length);
  if (/скопј/.test(t) && !L.some(({ name }) => t.includes(mpN(name)) && name !== 'Град Скопје')) return '';
  for (const { code, name } of L) if (t.includes(mpN(name))) return code;
  return '';
}

/** ФЗО unit from municipality code / free text. */
export function mpFzoFrom(ops: unknown, txt: unknown): string {
  if (MPIN_SKOPJE.has(String(ops)) || /скопј/.test(mpN(txt))) return '4061';
  const nm = MPIN_OPS.find((x) => x.code === String(ops))?.name;
  const t = mpN(nm || txt);
  if (!t) return '';
  const f = MPIN_FZO.find(({ name }) => {
    const a = mpN(name.replace('Мак.', 'Македонски'));
    return a === t || t.includes(a);
  });
  return f ? f.code : '';
}

export const mpOpsName = (c: unknown): string => MPIN_OPS.find((x) => x.code === String(c))?.name || '';
export const mpFzoName = (c: unknown): string => MPIN_FZO.find((x) => x.code === String(c).slice(0, 4))?.name || '';

export interface MpinEmployee {
  id: string;
  name?: string;
  embg?: string;
  city?: string;
  address?: string;
  /** 3.4ц municipality code. */
  mpOps?: string;
  /** 3.4б ФЗО unit. */
  mpZan?: string;
  /** Column 26 (0050/0047). */
  mpC26?: string;
  bankAcc?: string;
}

/** Employee's codes, inferring missing ones from city/address (legacy `mpinEmpCodes`). */
export function mpinEmpCodes(E: Pick<MpinEmployee, 'city' | 'address' | 'mpOps' | 'mpZan'>): { ops: string; fzo: string } {
  const txt = String(E.city || '').trim() || E.address || '';
  const ops = E.mpOps || mpOpsFrom(txt);
  const fzo = E.mpZan || mpFzoFrom(ops, txt);
  return { ops, fzo };
}

export interface MpinTemplateEmp {
  c2?: string;
  c3?: string;
  c4?: string;
  c5?: string;
  c6?: string;
  c26?: string;
  c42?: string;
  bank?: string;
}
/** A previous MPI3 file parsed as template (legacy `firm.mpinTpl`). */
export interface MpinTemplate {
  l0: (string | undefined)[];
  l1: (string | undefined)[];
  l2: (string | undefined)[];
  emp: Record<string, MpinTemplateEmp>;
  def: (string | undefined)[] | null;
  ver: string;
  edb?: string;
}

/** Parse an MPI3 `.txt` (already decoded) into a template (legacy `mpinParse`). */
export function mpinParse(txt: string): MpinTemplate {
  const L = txt.split(/\r?\n/);
  const sp = (l: string | undefined) => (l || '').split(';');
  const t: MpinTemplate = { l0: sp(L[0]), l1: sp(L[1]), l2: sp(L[2]), emp: {}, def: null, ver: '' };
  for (let i = 3; i < L.length; i++) {
    const l = L[i]!;
    if (/^\*+$/.test(l.trim())) break;
    const c = sp(l);
    if (c.length < 40) continue;
    t.emp[c[1]!] = { c2: c[2], c3: c[3], c4: c[4], c5: c[5], c6: c[6], c26: c[26], c42: c[42], bank: c[45] };
    if (!t.def) t.def = [c[4], c[5], c[6], c[26], c[42]];
  }
  t.ver = (L.filter((x) => x.trim()).slice(-1)[0] || '').trim();
  t.edb = t.l2[0];
  return t;
}

export interface MpinFirm {
  edb?: string;
  embs?: string;
  name?: string;
  address?: string;
  city?: string;
  opstina?: string;
}

export interface MpinTxtRow {
  embg: string;
  prez: string;
  ime: string;
  c4: string;
  c5: string;
  c6: string;
  c26: string;
  c42: string;
  days: number;
  hours: number;
  net: number;
  gross: number;
  pio: number;
  dPio: number;
  zdr: number;
  dZdr: number;
  dop: number;
  dDop: number;
  vrab: number;
  dVrab: number;
  tax: number;
  bank: string;
}

export interface MpinTxtResult {
  /** File content (CRLF line ends). */
  text: string;
  /** `text` encoded as windows-1251 — what is written to disk. */
  bytes: Uint8Array;
  /** `MPI3_{edb}_{yyyy}_{mm}_{k1}_{k2}.txt` */
  name: string;
  R: MpinTxtRow[];
  /** A template was used. */
  tpl: boolean;
  /** Employees without a 13-digit EMBG. */
  miss: number;
  /** Employees whose 3.4ц municipality falls back to the default / is invalid. */
  opsMiss: string[];
}

export interface MpinContext {
  firm: MpinFirm;
  employees?: readonly MpinEmployee[];
  template?: MpinTemplate | null;
  overrides?: readonly PayParamRow[];
}

const DEF_VER = '1.0.3328.24828';

/** Build the MPI3 declaration for a payroll run. */
export function mpinTxt(p: PayrollRun & { emps: (PayEmp & { inout?: string; ioDate?: string })[] }, ctx: MpinContext): MpinTxtResult {
  const T0: MpinTemplate = ctx.template || { l0: [], l1: [], l2: [], emp: {}, def: ['001', '', '', '0050', '1'], ver: '' };
  const f = ctx.firm || {};
  const employees = ctx.employees || [];
  const P = resolvePayParams(p.params, p.month, ctx.overrides);
  const [y, m] = p.month.split('-') as [string, string];
  const n2 = (v: unknown) => (Math.round((+(v as number) || 0) * 100) / 100).toFixed(2);
  const opsOk = (c: string) => MPIN_OPS.some((x) => x.code === c);
  const opsMiss: string[] = [];

  const R: MpinTxtRow[] = (p.emps || []).map((e) => {
    const c = empCalc(e, P);
    const found = employees.find((x) => x.id === e.empId);
    const E: Partial<MpinEmployee> = found || {};
    const embg = String(e.embg || E.embg || '').replace(/\D/g, '');
    const tp = T0.emp[embg] || {};
    const df = T0.def || ['001', '', '', '0050', '1'];
    const parts = String(e.name || E.name || '')
      .trim()
      .split(/\s+/);
    const ime = parts[0] || '',
      prez = parts.slice(1).join(' ');
    const T = c.T;
    let days = new Date(+y, +m, 0).getDate();
    if (e.inout && e.inout !== 'full' && e.ioDate && e.ioDate.slice(0, 7) === p.month) {
      const d = +e.ioDate.slice(8, 10);
      days = e.inout === 'in' ? days - d + 1 : d;
    }
    const inf = found && (!E.mpOps || !E.mpZan) ? mpinEmpCodes(E) : { ops: '', fzo: '' };
    const c6 = E.mpOps || tp.c6 || inf.ops || df[2] || String(f.opstina || '');
    const c5 = E.mpZan || tp.c5 || inf.fzo || df[1] || '';
    if (found && (!(E.mpOps || tp.c6 || inf.ops) || !opsOk(c6))) opsMiss.push(E.name || e.name);
    return {
      embg,
      prez: tp.c2 || prez,
      ime: tp.c3 || ime,
      c4: tp.c4 || df[0] || '',
      c5,
      c6,
      c26: E.mpC26 || tp.c26 || df[3] || '',
      c42: tp.c42 || df[4] || '',
      days,
      hours: T.hours,
      net: T.net,
      gross: T.gross,
      pio: T.pio,
      dPio: T.dPio,
      zdr: T.zdr,
      dZdr: T.dZdr,
      dop: T.dop,
      dDop: T.dDop,
      vrab: T.vrab,
      dVrab: T.dVrab,
      tax: T.tax,
      bank: String(E.bankAcc || tp.bank || '').replace(/\D/g, ''),
    };
  });
  const S_ = (k: keyof MpinTxtRow) => R.reduce((a, r) => a + (+r[k] || 0), 0);
  const obl = S_('pio') + S_('dPio') + S_('zdr') + S_('dZdr') + S_('dop') + S_('dDop') + S_('vrab') + S_('dVrab') + S_('tax');

  const l0: string[] = Array.from({ length: Math.max(18, T0.l0.length) }, (_, i) => T0.l0[i] ?? '');
  l0[0] = String(Math.round(P.avg));
  l0[1] = String(Math.round(P.exempt));
  l0[2] = String(P.pio);
  l0[3] = String(+(P.hours ?? 0) || 176);
  l0[4] = String(P.zdr);
  l0[5] = String(P.vrab);
  l0[6] = String(P.dop);
  if (!l0[7]) l0[7] = '1';
  l0[12] = String(P.tax);
  const k1 = T0.l1[2] || '101',
    k2 = T0.l1[3] || '110';
  const l2: string[] = Array.from({ length: Math.max(16, T0.l2.length) }, (_, i) => T0.l2[i] ?? '');
  const edb = String(f.edb || '').replace(/\D/g, '');
  l2[0] = edb;
  l2[1] = String(f.embs || l2[1] || '');
  l2[2] = String(f.name || '').toUpperCase();
  l2[6] = String(f.address || l2[6] || '').toUpperCase();
  l2[8] = String(f.city || l2[8] || '').toUpperCase();
  if (!l2[10] && f.opstina) l2[10] = String(f.opstina);

  const lines = [l0.join(';'), [m, y, k1, k2, R.length, n2(obl)].join(';') + ';', l2.join(';')];
  R.forEach((r, i) => {
    const c: (string | number)[] = Array(47).fill('');
    Object.assign(c, {
      0: i + 1,
      1: r.embg,
      2: r.prez.toUpperCase(),
      3: r.ime.toUpperCase(),
      4: r.c4,
      5: r.c5,
      6: r.c6,
      7: r.days,
      8: r.hours,
      11: n2(r.net),
      14: '0.00',
      16: n2(r.gross),
      17: n2(r.pio),
      18: n2(r.dPio),
      19: n2(r.zdr),
      20: n2(r.dZdr),
      21: n2(r.dop),
      22: n2(r.dDop),
      23: n2(r.vrab),
      24: n2(r.dVrab),
      25: n2(r.tax),
      26: r.c26,
      32: '0.00',
      33: '0.00',
      34: '0.00',
      37: '0.00',
      42: r.c42,
      43: n2(r.net),
      44: n2(r.net),
      45: r.bank,
    });
    lines.push(c.join(';'));
  });
  lines.push(
    '***********************************',
    [k1, k2, R.length, n2(obl)].join(';') + ';',
    [
      n2(S_('net')), '0.00', n2(S_('gross')), n2(S_('pio')), n2(S_('dPio')), '0.00', '0.00', '0.00',
      n2(S_('zdr')), n2(S_('dZdr')), n2(S_('dop')), n2(S_('dDop')), n2(S_('vrab')), n2(S_('dVrab')), n2(S_('tax')), '0.00', n2(S_('net')),
    ].join(';') + ';',
    T0.ver || DEF_VER,
  );
  const text = lines.join('\r\n') + '\r\n';
  return {
    text,
    bytes: encodeCp1251(text),
    name: `MPI3_${edb}_${y}_${m}_${k1}_${k2}.txt`,
    R,
    tpl: !!ctx.template,
    miss: R.filter((r) => r.embg.length !== 13).length,
    opsMiss,
  };
}
