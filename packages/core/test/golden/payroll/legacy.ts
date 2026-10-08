/**
 * Golden-test harness: loads the payroll functions of `legacy/index.html` into a Node `vm`
 * context with stubbed app state (`S`, `firm()`), so the port can be compared with the
 * final effective legacy code on the same fixtures.
 *
 * Chunks are located by their declaration line (not by line number), so the harness keeps
 * working if unrelated parts of the legacy file move. Each chunk is the FINAL effective version
 * per docs/LEGACY-MAP.md (e.g. the `mpinTxt` wrapper at 14734 and the `payDraft` v486 wrapper).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../../../../../legacy/index.html', import.meta.url), 'utf8');
const LINES = HTML.split(/\r?\n/);

/** Lines from the first match of `start` through the first following line matching `end` (inclusive). */
function block(start: RegExp, end?: RegExp): string {
  const i = LINES.findIndex((l) => start.test(l));
  if (i < 0) throw new Error('legacy chunk not found: ' + start);
  if (!end) return LINES[i]!;
  let j = i;
  while (j < LINES.length && !end.test(LINES[j]!)) j++;
  if (j >= LINES.length) throw new Error('legacy chunk end not found: ' + end);
  return LINES.slice(i, j + 1).join('\n');
}

const CODE = [
  block(/^const SCH0=\{/, /^const sch=k=>/),
  block(/^const r2=n=>/),
  block(/^const dmy=d=>/),
  // HTYPES … PAY_DEF … grossFromNet, empCalc, payrollEntries2, calendar, stazFor, payTotals, payMatch, leaveStats
  block(/^const HTYPES=\[/, /^ {2}const right=\+e\.leaveDays/),
  block(/^function g4n\(/),
  // CP1251, toCp1251, MPIN_SAMPLE, mpinTpl, mpinParse, mpinTxt (base), mpinOfficial, mpinParamDiff
  block(/^const CP1251=\{/, /^function mpinParamDiff\(/),
  // mpinRows, payDraft (base), PCAT, PXTRA, catOf, workHoursBetween
  block(/^function mpinRows\(/, /^function workHoursBetween\(/),
  block(/^const PSIF0=\[/, /^function PSIF\(\)/),
  block(/^const MPIN_OPS=\[/, /^const mpOpsN=/),
  // mpinEmpCodes + the final mpinTxt wrapper (code inference, opsMiss)
  block(/^function mpinEmpCodes\(/, /^ {2}try\{const X=_mt\.apply/),
  // v486 payDraft wrapper
  block(/^\{const _pdr=payDraft;payDraft=function/),
].join('\n');

const EXPORTS = [
  'SCH0', 'SCH_OLD', 'sch', 'schOn', 'r2', 'dmy', 'HTYPES', 'HT_ADD', 'fixRegular', 'monthHours', 'PAY_DEF', 'payRows', 'paramsFor',
  'grossFromNet', 'g4n', 'empCalc', 'payrollEntries2', 'orthEaster', 'BAJRAM', 'mkHolidays', 'monthSplit', 'stazFor', 'payTotals', 'payMatch',
  'CP1251', 'toCp1251', 'MPIN_SAMPLE', 'mpinTpl', 'mpinParse', 'mpinTxt', 'mpinOfficial', 'mpinParamDiff', 'mpinRows', 'payDraft',
  'PCAT', 'PXTRA', 'catOf', 'workHoursBetween', 'PSIF0', 'PSIF', 'MPIN_OPS', 'MPIN_FZO', 'MPIN_SKOPJE', 'mpOpsFrom', 'mpFzoFrom',
  'mpinEmpCodes', 'S',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Legacy = Record<string, any> & {
  /** Set the current firm (`firm()`), office scheme, employees, payroll docs and parameter overrides. */
  setState(st: { firm?: any; gsch?: any; employees?: any[]; payroll?: any[]; payUser?: any[] }): void;
};

/** A fresh legacy sandbox (state is per instance). */
export function loadLegacy(): Legacy {
  const prelude = `
    const S={fid:'f1',firms:[],data:{employees:[],payroll:[],codes:[]},gsch:{sch:{}},payUser:[]};
    const firm=()=>S.firms.find(f=>f.id===S.fid);
  `;
  const ctx = vm.createContext({ console });
  const api = vm.runInContext(prelude + '\n' + CODE + '\n;({' + EXPORTS.join(',') + '})', ctx, { filename: 'legacy-payroll.js' }) as Legacy;
  api.setState = (st) => {
    const S = api.S;
    if (st.firm !== undefined) S.firms = st.firm ? [{ id: 'f1', ...st.firm }] : [];
    if (st.gsch !== undefined) S.gsch = { sch: st.gsch || {} };
    if (st.employees) S.data.employees = st.employees;
    if (st.payroll) S.data.payroll = st.payroll;
    if (st.payUser) S.payUser = st.payUser;
  };
  return api;
}

/** Detach a value from the vm realm (plain JSON) so `toEqual` compares data only. */
export const plain = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
