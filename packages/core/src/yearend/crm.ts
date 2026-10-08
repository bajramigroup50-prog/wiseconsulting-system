/**
 * ЦРСМ e-annual account: form 38 (state records, AOP 601–724), form 35 (revenue by activity), validation rules
 * and the `<AnnualAccount>` XML (Operation 450).
 *
 * Legacy: `DE38`/`DE38_AUTO`/`deAuto`/`deVals` 10976–10990, `NKD35`/`nkd5`/`NKD21`/`nkd21Aop`/`f35Rows`
 * 10992–10999, `spData` 7652, `crmRules` 11001, `crmXml` 11022, `crmXmlImport` 17027, `crmXClr` 17043.
 */
import { r2 } from '../money';
import de38Data from '../data/yearend-de38.json';
import nkdData from '../data/yearend-nkd.json';
import { yeSumPref, type YeBalances } from './balances';
import type { ZsRule, ZsResult } from './aop';

/* ---------------- form 38 ---------------- */

export const DE38: readonly (readonly [number, string])[] = de38Data.rows as [number, string][];
/** `aop → [account regex, account-name regex]` (sources of case-sensitive regexes). */
export const DE38_AUTO: Readonly<Record<string, readonly [string, string]>> = de38Data.auto as unknown as Record<string, [string, string]>;

/**
 * Suggested form-38 amounts from account names (legacy `deAuto`). Only leaf accounts are summed (an account that has
 * a longer account under it in the balances is skipped).
 */
export function deAuto(pre: YeBalances, accountNames: Readonly<Record<string, string>>, C: Pick<ZsResult, 'V'>): Record<number, number> {
  const out: Record<number, number> = {};
  const keys = Object.keys(pre);
  for (const [aop, [preS, reS]] of Object.entries(DE38_AUTO)) {
    const pre1 = new RegExp(preS);
    const re = new RegExp(reS);
    let s = 0;
    for (const [k, v] of Object.entries(pre)) {
      if (!pre1.test(k)) continue;
      const n = String(accountNames[k] ?? '').toLowerCase();
      if (!re.test(n)) continue;
      if (keys.some((x) => x !== k && x.startsWith(k))) continue;
      s += Math.abs(v.s);
    }
    if (s >= 0.5) out[+aop] = Math.round(s);
  }
  if (out[641] || out[642]) out[640] = (out[641] || 0) + (out[642] || 0);
  if (C.V.bu202) out[643] = Math.max(0, Math.round(C.V.bu202) - (out[644] || 0));
  const emp = Math.round(C.V.bu257 || 0);
  if (emp) {
    out[722] = emp;
    out[723] = emp;
  }
  return out;
}

/** Form-38 values: manual (`firm.deMan[year]`) over the automatic suggestion (legacy `deVals`). */
export function deVals(manual: Readonly<Record<string | number, number | string>> | null | undefined, auto: Readonly<Record<number, number>>): Record<number, number> {
  const M = manual ?? {};
  const V: Record<number, number> = {};
  for (const [n] of DE38) {
    const m = M[n];
    V[n] = m != null && m !== '' ? +m : auto[n] || 0;
  }
  return V;
}

/* ---------------- form 35 ---------------- */

export const NKD35: Readonly<Record<string, number>> = nkdData.nkd35;
export const NKD21: readonly string[] = nkdData.nkd21;

/** Normalise an activity code to `NN.NNN` (legacy `nkd5`). */
export function nkd5(s: string | null | undefined): string {
  const m = String(s || '').match(/(\d{2})\.?(\d{1,3})?/);
  if (!m) return '';
  const b = (m[2] || '0').padEnd(3, '0');
  return m[1] + '.' + b;
}
/** Form-35 AOP = 4000 + index of the NACE Rev 2.1 class (legacy `nkd21Aop`). */
export function nkd21Aop(n: string | null | undefined): number | null {
  const c = String(n || '').replace(/\D/g, '').slice(0, 4);
  const i = NKD21.indexOf(c);
  return i >= 0 ? 4000 + i : null;
}

export interface F35Firm {
  nkd?: string;
  activity?: string;
  /** konto → activity code */
  actMap?: Record<string, string>;
  /** activity → AOP overrides */
  nkdAop?: Record<string, number>;
}

/** Revenue (74–79) by activity (legacy `spData().byA`). */
export function revenueByActivity(pre: YeBalances, firm: F35Firm): Record<string, number> {
  const map = firm.actMap || {};
  const byA: Record<string, number> = {};
  for (const [k, v] of Object.entries(pre)) {
    if (!/^7[4-9]/.test(k)) continue;
    const val = r2(-v.s);
    if (!(Math.abs(val) > 0.009)) continue;
    const a = map[k] || firm.activity || '';
    byA[a || '—'] = r2((byA[a || '—'] || 0) + val);
  }
  return byA;
}

/** Form-35 rows (legacy `f35Rows`). `manual` = `firm.f35Man[year]` (activity → amount). */
export function f35Rows(pre: YeBalances, firm: F35Firm, manual?: Record<string, number> | null): { nkd: string; v: number; aop: number | null }[] {
  const map = firm.nkdAop || {};
  const src: Record<string, number> =
    manual ||
    Object.fromEntries(Object.entries(revenueByActivity(pre, firm)).map(([a, v]) => [nkd5(a === '—' ? firm.nkd || firm.activity : a), Math.round(v)]));
  return Object.entries(src)
    .filter(([n, v]) => n && Math.round(+v || 0))
    .map(([n, v]) => ({ nkd: n, v: Math.round(+v), aop: map[n] || NKD35[n] || nkd21Aop(n) || null }));
}

/* ---------------- ЦРМ rules ---------------- */

export type CrmFinding = [no: number | string, text: string, level?: 'warn'];

const fi = (n: number) => (+n || 0).toLocaleString('mk-MK', { maximumFractionDigits: 0 });

/** ЦРМ control rules 2000–2349 and 2600–2712; returns the failed ones (legacy `crmRules`). */
export function crmRules(C: Pick<ZsResult, 'V'>, D: Readonly<Record<number, number>>): CrmFinding[] {
  const g = (a: string) => Math.round(C.V[a] || 0);
  const b = (n: number) => g('bs' + String(n).padStart(3, '0'));
  const u = (n: number) => g('bu' + n);
  const d = (n: number) => Math.round(D[n] || 0);
  const sum = (f: (x: number) => number, L: number[]) => L.reduce((s, x) => s + f(x), 0);
  const out: CrmFinding[] = [];
  const R = (no: number | string, txt: string, ok: boolean) => {
    if (!ok) out.push([no, txt]);
  };
  const E = (no: number, a: number, L: number[], f: (x: number) => number) =>
    R(no, `${String(a).padStart(3, '0')}=${L.map((x) => String(x).padStart(3, '0')).join('+')}`, f(a) === sum(f, L));
  E(2000, 1, [2, 9, 20, 21, 31], b);
  E(2001, 2, [3, 4, 5, 6, 7, 8], b);
  E(2002, 9, [10, 13, 14, 15, 16, 17, 18, 19], b);
  E(2003, 10, [11, 12], b);
  E(2004, 21, [22, 23, 24, 25, 26, 30], b);
  E(2005, 26, [27, 28, 29], b);
  E(2006, 31, [32, 33, 34], b);
  E(2007, 36, [37, 45, 52, 59], b);
  E(2008, 37, [38, 39, 40, 41, 42, 43], b);
  E(2009, 45, [46, 47, 48, 49, 50, 51], b);
  E(2010, 52, [53, 56, 57, 58], b);
  E(2011, 53, [54, 55], b);
  E(2012, 59, [60, 61], b);
  E(2013, 63, [1, 35, 36, 44, 62], b);
  R(2014, '065=066+067-068-069+070+071+075-076+077-078', b(65) === b(66) + b(67) - b(68) - b(69) + b(70) + b(71) + b(75) - b(76) + b(77) - b(78));
  E(2015, 71, [72, 73, 74], b);
  E(2016, 81, [82, 85, 95], b);
  E(2017, 82, [83, 84], b);
  E(2018, 85, [86, 87, 88, 89, 90, 91, 92, 93], b);
  E(2019, 95, [96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108], b);
  E(2020, 111, [65, 81, 94, 109, 110], b);
  R(2021, 'ако 256=0, тогаш 078=0', u(256) !== 0 || b(78) === 0);
  R(2022, '078<=256', b(78) <= u(256));
  R(2023, 'ако 255=0, тогаш 077=0', u(255) !== 0 || b(77) === 0);
  R(2024, '077<=255', b(77) <= u(255));
  R(2025, '063>0', b(63) > 0);
  R(2026, '111>0', b(111) > 0);
  R(2027, '063=111', b(63) === b(111));
  R(2028, '064=112', b(64) === b(112));
  R(2030, 'ако 077=0, тогаш 255=0', b(77) !== 0 || u(255) === 0);
  R(2031, 'ако 078=0, тогаш 256=0', b(78) !== 0 || u(256) === 0);
  R(2032, 'ако 077>0 тогаш 078=0', !(b(77) > 0) || b(78) === 0);
  R(2033, 'ако 078>0 тогаш 077=0', !(b(78) > 0) || b(77) === 0);
  E(2300, 201, [202, 203, 206], u);
  E(2301, 207, [208, 209, 210, 211, 212, 213, 218, 219, 220, 221, 222], u);
  E(2302, 213, [214, 215, 216, 217], u);
  E(2303, 223, [224, 229, 230, 231, 232, 233], u);
  E(2304, 224, [225, 226, 227, 228], u);
  E(2305, 234, [235, 239, 240, 241, 242, 243], u);
  E(2306, 235, [236, 237, 238], u);
  const I = u(201) + u(223) + u(244);
  const X = u(204) - u(205) + u(207) + u(234) + u(245);
  R(2307, '246=(201+223+244)-(204-205+207+234+245)', !(I >= X) || u(246) === I - X);
  R(2308, '247=(204-205+207+234+245)-(201+223+244)', !(X >= I) || u(247) === X - I);
  R(2313, 'ако 250>0 и 250>=252: 255=250-252+253-254', !(u(250) > 0 && u(250) >= u(252)) || u(255) === u(250) - u(252) + u(253) - u(254));
  R(2314, 'ако 251>0: 256=251+252-253+254', !(u(251) > 0) || u(256) === u(251) + u(252) - u(253) + u(254));
  R(2315, 'ако 255>0, тогаш 256=0', !(u(255) > 0) || u(256) === 0);
  R(2316, 'ако 256>0, тогаш 255=0', !(u(256) > 0) || u(255) === 0);
  R(2317, '269=255', u(269) === u(255));
  R(2318, '270=256', u(270) === u(256));
  R(2333, 'ако 246>0, тогаш 247=0', !(u(246) > 0) || u(247) === 0);
  R(2335, 'ако 250>0, тогаш 251=0', !(u(250) > 0) || u(251) === 0);
  R(2337, 'ако 214+215+216>0 тогаш 257>0', !(u(214) + u(215) + u(216) > 0) || u(257) > 0);
  R(2338, 'ако 257>0, тогаш 214+215+216>0', !(u(257) > 0) || u(214) + u(215) + u(216) > 0);
  R(2340, '258 (месеци на работење) од 1 до 12', u(258) >= 1 && u(258) <= 12);
  R(2347, 'ако 250>0 тогаш 246>0', !(u(250) > 0) || u(246) > 0);
  R(2349, 'ако 255>0 тогаш 250>0', !(u(255) > 0) || u(250) > 0);
  if (u(257) > 0 && u(214) > 0) {
    const avg = u(214) / u(257) / Math.max(1, u(258));
    if (avg < 24000 || avg > 43000) out.push(['2342/2343', `Просечна нето плата ${fi(avg)} ден. – ЦРМ очекува помеѓу 24.000 и 43.000 (предупредување)`, 'warn']);
  }
  const LE = (no: number, a: number, L: number[], f: (x: number) => number, t: string) =>
    R(no, `${a}<=${L.map((x) => String(x).padStart(3, '0')).join('+')} ${t}`, d(a) <= sum(f, L));
  const bsLe: [number, number, number[]][] = [
    [2600, 604, [3]], [2601, 605, [4]], [2602, 606, [4]], [2603, 607, [4]], [2604, 608, [4]], [2605, 611, [12]], [2606, 612, [12]],
    [2607, 613, [12]], [2608, 614, [13]], [2609, 615, [13]], [2610, 616, [16]], [2611, 617, [16]], [2612, 618, [19]], [2613, 619, [19]],
    [2614, 620, [19]], [2615, 621, [19]], [2616, 622, [19]], [2617, 623, [18]], [2618, 624, [18]],
    [2619, 625, [24, 25, 32, 33, 34, 46, 47, 56, 57, 58]], [2620, 626, [6, 17, 30, 46, 47, 48]], [2621, 628, [34, 46, 47, 51, 62]],
    [2622, 629, [34, 35, 47, 49, 51, 62]], [2623, 630, [6, 17, 30, 34, 35, 46, 47, 49, 50, 51, 57, 62]], [2624, 631, [66]],
    [2625, 632, [66]], [2626, 633, [66]], [2627, 634, [86, 87, 88, 89, 90, 96, 104, 107]], [2628, 635, [96, 97, 98, 108]],
    [2629, 636, [96, 97, 98, 108]], [2630, 637, [92, 93, 96, 106, 107, 108, 109]], [2631, 638, [92, 93, 94, 99, 101, 107, 108, 109]],
    [2632, 639, [92, 93, 94, 96, 97, 98, 99, 100, 101, 107, 108, 109]], [2711, 627, [30, 46, 47, 48]],
  ];
  bsLe.forEach(([no, a, L]) => LE(no, a, L, b, 'БС'));
  R(2633, '640=641+642', d(640) === d(641) + d(642));
  const buLe: [number, number, number][] = [
    [2634, 640, 202], [2635, 641, 202], [2636, 642, 202], [2637, 643, 202], [2638, 644, 202], [2639, 645, 202], [2640, 646, 206],
    [2641, 647, 202], [2642, 648, 202], [2643, 649, 202],
    ...[650, 651, 652, 653, 654, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665].map((a, i): [number, number, number] => [2644 + i, a, 203]),
    ...[668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679].map((a, i): [number, number, number] => [2660 + i, a, 208]),
    ...[680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690].map((a, i): [number, number, number] => [2672 + i, a, 211]),
    ...[692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706].map((a, i): [number, number, number] => [2683 + i, a, 217]),
    [2698, 708, 212], [2699, 709, 212], [2700, 710, 212], [2701, 711, 212], [2702, 712, 212], [2703, 713, 212], [2704, 714, 212],
    [2705, 715, 217], [2706, 716, 217], [2707, 717, 212], [2708, 718, 222], [2709, 719, 222],
  ];
  buLe.forEach(([no, a, x]) => LE(no, a, [x], u, 'БУ'));
  R(2710, '720=242 БУ', d(720) === u(242));
  R(2712, '722>0 (ако има вработени)', !(u(257) > 0) || d(722) > 0);
  return out;
}

/* ---------------- XML export ---------------- */

const xe = (v: unknown) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export interface CrmXmlInput {
  year: number;
  current: Pick<ZsResult, 'V'>;
  /** previous year (only used with `opt.prev`) */
  previous?: Pick<ZsResult, 'V'> | null;
  rules: readonly ZsRule[];
  /** form-38 values (`deVals`) */
  de38: Readonly<Record<number, number>>;
  /** form-35 rows (`f35Rows`) — ignored when `f35Raw` has entries */
  f35: readonly { aop: number | null; v: number }[];
  /** form-35 amounts imported from an accepted XML (`firm.f35Raw[year]`, AOP → amount) */
  f35Raw?: Readonly<Record<string, number>> | null;
  /** ЕМБС */
  embs?: string;
  /** `firm.crmPeriod` (0–4, default 1) */
  period?: number;
}

/** `<AnnualAccount>` for ЦРМ e-submission: Operation 450, forms 35–38, AATypeID 122, DocTypeID 110 (legacy `crmXml`). */
export function crmXml(inp: CrmXmlInput, opt: { prev?: boolean; zeros?: boolean } = {}): string {
  const { year, rules: R } = inp;
  const C = inp.current;
  const P = inp.previous ?? { V: {} };
  const De = inp.de38;
  const le = String(inp.embs || '').replace(/\D/g, '');
  const xa = (n: string, v: unknown) => (v == null ? '' : ` ${n}="${Math.round(+(v as number) || 0)}"`);
  const pid = (n: string | number) => {
    const s = String(+n);
    return s.length < 3 ? s.padStart(3, '0') : s;
  };
  const aop = (fm: number, id: string | number, cur: number, pre: number | null) =>
    `<AOP ID="${pid(id)}" xsi:type="aop-form-${fm}"${xa('Current', cur)}${pre != null ? xa('Previous', pre) : ''}/>`;
  const aops = (rep: string, fm: number) =>
    R.filter((x) => x.r === rep)
      .map((x) => {
        const k = rep + x.aop;
        const cur = Math.round(C.V[k] || 0);
        const pre = Math.round(P.V[k] || 0);
        if (!cur && !(opt.prev && pre) && !opt.zeros) return '';
        return aop(fm, x.aop, cur, opt.prev ? pre : null);
      })
      .filter(Boolean)
      .join('');
  const de = DE38.map(([n]) => (Math.round(De[n] || 0) ? aop(38, n, Math.round(De[n]!), null) : '')).filter(Boolean).join('');
  const raw35 = inp.f35Raw || null;
  const f35 =
    raw35 && Object.keys(raw35).length
      ? Object.entries(raw35)
          .map(([id, v]) => aop(35, id, v, null))
          .join('')
      : inp.f35
          .filter((r) => r.aop)
          .map((r) => aop(35, r.aop!, r.v, null))
          .join('');
  const wm = Math.min(12, Math.max(1, Math.round(C.V.bu258 || 12)));
  const period = Math.max(0, Math.min(4, +(inp.period ?? 1)));
  return `<?xml version="1.0" encoding="utf-8"?>
<AnnualAccount xmlns="http://e-submit.crm.com.mk/aaol" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" AATypeID="122" DocTypeID="110" LEID="${xe(le)}" UnitID="" Year="${year}" StatChangeTypeID="1" Period="${period}" WorkingMonths="${wm}">
	<Operation ID="450">${
    f35
      ? `
		<Form ID="35" xsi:type="form-35">
			${f35}</Form>`
      : ''
  }
		<Form ID="36" xsi:type="form-36">
			${aops('bs', 36)}</Form>
		<Form ID="37" xsi:type="form-37">
			${aops('bu', 37)}</Form>
		<Form ID="38" xsi:type="form-38">
			${de}</Form>
	</Operation>
	<Statement>Изјавувам, под морална, материјална и кривична одговорност, дека податоците во годишната сметка се точни и вистинити.</Statement>
</AnnualAccount>`;
}

/* ---------------- XML import ---------------- */

export interface CrmParsed {
  year: number;
  period: number;
  /** bs/bu AOP → current amount (forms 36/37) */
  cur: Record<string, number>;
  prev: Record<string, number>;
  /** form 38 */
  d38: Record<string, number>;
  d38p: Record<string, number>;
  /** form 35 AOP → amount */
  f35: Record<string, number>;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[2] ?? m[3] ?? '') : null;
};

/**
 * Parse an accepted ЦРМ annual-account XML (pure part of legacy `crmXmlImport`; the DOMParser is replaced by a small
 * tag scanner — the format is flat: AnnualAccount > Operation > Form > AOP).
 */
export function parseCrmXml(text: string): CrmParsed {
  const t = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  const rootM = /<(?:[\w.-]+:)?AnnualAccount\b([^>]*)>/.exec(t);
  if (!rootM) throw new Error(/<\?xml|<[A-Za-z]/.test(t) ? 'не е годишна сметка од ЦРМ' : 'не е валиден XML');
  const root = rootM[1]!;
  const year = +(attr(root, 'Year') ?? NaN);
  const cur: Record<string, number> = {};
  const prev: Record<string, number> = {};
  const d38: Record<string, number> = {};
  const d38p: Record<string, number> = {};
  const f35: Record<string, number> = {};
  const formRe = /<(?:[\w.-]+:)?Form\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?Form>)/g;
  for (const F of t.matchAll(formRe)) {
    const id = attr(F[1]!, 'ID');
    const body = F[3] ?? '';
    for (const A of body.matchAll(/<(?:[\w.-]+:)?AOP\b([^>]*?)\/?>/g)) {
      const a = String(+(attr(A[1]!, 'ID') ?? NaN));
      const c = attr(A[1]!, 'Current');
      const p = attr(A[1]!, 'Previous');
      if (id === '36' || id === '37') {
        const k = (id === '36' ? 'bs' : 'bu') + a.padStart(3, '0');
        if (c != null) cur[k] = Math.round(+c);
        if (p != null) prev[k] = Math.round(+p);
      } else if (id === '38') {
        if (c != null) d38[a] = Math.round(+c);
        if (p != null) d38p[a] = Math.round(+p);
      } else if (id === '35') {
        if (c != null) f35[a] = Math.round(+c);
      }
    }
  }
  if (!Object.keys(cur).length) throw new Error('нема АОП износи');
  return { year, period: +(attr(root, 'Period') ?? 1), cur, prev, d38, d38p, f35 };
}

export interface CrmFirmState {
  zsMan?: Record<string, Record<string, number>>;
  deMan?: Record<string, Record<string, number>>;
  f35Raw?: Record<string, Record<string, number>>;
  nkdAop?: Record<string, number>;
  nkd?: string;
  activity?: string;
  /** new: what the last XML import replaced, so it can be undone exactly */
  crmImp?: Record<string, CrmImportUndo>;
}
export interface CrmImportUndo {
  zsMan: Record<string, number> | null;
  /** present only when the import touched the previous year; null = that year did not exist */
  zsManPrev?: Record<string, number> | null;
  deMan: Record<string, number> | null;
  deManPrev?: Record<string, number> | null;
  f35Raw: Record<string, number> | null;
}

const isFormulaRule = (x: ZsRule) => {
  const g = String(x.f || '').trim().replace(/^[PN]:/, '');
  return !!g && /^[\d+\-\s]+$/.test(g);
};

/**
 * Firm patch for an imported XML (legacy `crmXmlImport`): every non-formula AOP missing from the XML is set to 0,
 * the previous-year column fills `zsMan[Y-1]` only when that year has no ledger, and a single form-35 AOP is
 * remembered for the firm's activity.
 * Fix C1: legacy replaced `zsMan[Y]`/`deMan[Y]` wholesale and `crmXClr` then deleted the whole year, wiping amounts
 * that were typed by hand before the import. The patch now records what it replaced in `crmImp[Y]` so
 * `clearCrmImport` restores it.
 */
export function crmImportPatch(f: CrmFirmState, P: CrmParsed, rules: readonly ZsRule[], prevYearHasLedger: boolean): Partial<CrmFirmState> & { crmPeriod: number } {
  const Y = P.year;
  const cur = { ...P.cur };
  const d38 = { ...P.d38 };
  for (const x of rules) {
    const k = x.r + x.aop;
    if ((x.r === 'bs' || x.r === 'bu') && !isFormulaRule(x) && cur[k] == null) cur[k] = 0;
  }
  for (const [n] of DE38) if (d38[n] == null) d38[n] = 0;
  const ZM = { ...(f.zsMan || {}) };
  const undo: CrmImportUndo = {
    zsMan: ZM[Y] ? { ...ZM[Y] } : null,
    deMan: f.deMan?.[Y] ? { ...f.deMan[Y] } : null,
    f35Raw: f.f35Raw?.[Y] ? { ...f.f35Raw[Y] } : null,
  };
  ZM[Y] = { ...cur };
  if (Object.keys(P.prev).length && !prevYearHasLedger) {
    undo.zsManPrev = ZM[Y - 1] ? { ...ZM[Y - 1] } : null;
    ZM[Y - 1] = { ...(ZM[Y - 1] || {}), ...P.prev };
  }
  const DM = { ...(f.deMan || {}) };
  DM[Y] = { ...d38 };
  if (Object.keys(P.d38p).length) {
    undo.deManPrev = DM[Y - 1] ? { ...DM[Y - 1] } : null;
    DM[Y - 1] = { ...(DM[Y - 1] || {}), ...P.d38p };
  }
  const patch: Partial<CrmFirmState> & { crmPeriod: number } = {
    zsMan: ZM,
    deMan: DM,
    f35Raw: { ...(f.f35Raw || {}), [Y]: P.f35 },
    crmPeriod: P.period,
    crmImp: { ...(f.crmImp || {}), [Y]: undo },
  };
  const ids = Object.keys(P.f35);
  const nk = nkd5(f.nkd || f.activity || '');
  if (ids.length === 1 && nk) patch.nkdAop = { ...(f.nkdAop || {}), [nk]: +ids[0]! };
  return patch;
}

/** Undo an XML import for `year` (legacy `crmXClr`, fixed: restores what the import replaced instead of deleting the year). */
export function clearCrmImport(f: CrmFirmState, year: number): Partial<CrmFirmState> {
  const u = f.crmImp?.[year];
  const ZM = { ...(f.zsMan || {}) };
  const DM = { ...(f.deMan || {}) };
  const FR = { ...(f.f35Raw || {}) };
  const set = (o: Record<string, Record<string, number>>, k: number, v: Record<string, number> | null | undefined) => {
    if (v) o[k] = v;
    else delete o[k];
  };
  set(ZM, year, u?.zsMan);
  set(DM, year, u?.deMan);
  set(FR, year, u?.f35Raw);
  if (u && u.zsManPrev !== undefined) set(ZM, year - 1, u.zsManPrev);
  if (u && u.deManPrev !== undefined) set(DM, year - 1, u.deManPrev);
  const imp = { ...(f.crmImp || {}) };
  delete imp[year];
  return { zsMan: ZM, deMan: DM, f35Raw: FR, crmImp: imp };
}
