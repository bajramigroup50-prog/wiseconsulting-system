/**
 * Golden-test harness: loads the year-end functions of legacy/index.html into a Node `vm` context with stubs for
 * the claude.ai runtime (`S`, `firm()`, `ledger()`, `save`, …) and runs them on a fixture.
 *
 * Only the line ranges listed below are evaluated, in file order, so monkey-patch chains (zsCompute 7620 → 10940 →
 * 17099, zcFindings 11196 → 16884) are reproduced exactly. Each range is checked against its expected first line so a
 * shifted legacy file fails loudly instead of testing the wrong code.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const LEGACY = fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url));

/** [from, to, expected start of the first line] */
const RANGES: [number, number, string][] = [
  [308, 3167, 'const KONTO_SRC='], // chart of accounts + KONTO
  [3266, 3269, 'const h='], // h, r2, r4, fmt
  [3326, 3326, 'const xe='],
  [3378, 3378, 'function banks()'],
  [3381, 3381, 'const acctOf='],
  [3406, 3406, 'const whOf='],
  [3600, 3601, 'function balances('],
  [3626, 3664, 'const POS_BS=['], // POS_BS, POS_IS, statements
  [4209, 4209, 'const dmy='],
  [5861, 5872, 'function depFor('],
  [5916, 5916, 'const fi='],
  [6732, 6753, 'async function closeYear()'], // closeYear, openYear
  [7411, 7637, 'const ZS_DEF=['], // ZS_DEF, ZS_FIX, zsRules, zsCompute (base)
  [7645, 7645, 'const zsV='],
  [7652, 7654, 'function spData()'],
  [10412, 10460, 'const NPO_ACC='], // NPO_*, npoMode, npoCompute, npoDb
  [10496, 10498, 'const DLD_ND='], // DLD_ND, tpData
  [10748, 10843, 'const DB_F=['], // DB_F, DB_MIG, dbData (hoisted winner), dbEdb
  [10939, 10944, 'const _zcOrig=zsCompute;'], // manual zsMan wrapper, zmHasLedger
  [10976, 11042, 'const DE38='], // DE38, DE38_AUTO, deAuto, deVals, NKD35, nkd5, NKD21, nkd21Aop, f35Rows, crmRules, crmXml
  [11196, 11221, 'function zcFindings('], // zcFindings (base), zcOpen
  [12386, 12389, 'const obResK='], // obResK, obResLines
  [16882, 16884, 'function izvYearEnd('], // izvYearEnd + zcFindings wrapper
  [17099, 17102, '{const _zc=zsCompute;'], // rounding wrapper ("АОП без дени")
  [17105, 17108, 'function vpData()'],
];

/** ACT handlers that are object-literal members in legacy; wrapped into `__ACT`. */
const ACT_RANGES: [number, number, string][] = [
  [7238, 7239, 'async runDep()'],
  [10486, 10490, 'async npoClose()'],
];

let SOURCE: string | null = null;
function source(): string {
  if (SOURCE) return SOURCE;
  const L = fs.readFileSync(LEGACY, 'utf8').split('\n');
  const take = ([a, b, start]: [number, number, string]) => {
    const first = L[a - 1]!.trim();
    if (!first.startsWith(start)) throw new Error(`legacy line ${a} should start with "${start}" but is "${first.slice(0, 60)}"`);
    return L.slice(a - 1, b).join('\n');
  };
  const STUBS = `
var __firm={};var __saved=[];var __deleted=[];var __today='2026-01-31';
var S={year:0,data:{},fx:{},nd:null};
function firm(){return __firm}
function ledger(opt){opt=opt||{};const ex=opt.excl||[];const out=[];for(const j of S.data.journal||[]){if(!String(j.date).startsWith(String(S.year)))continue;if(ex.includes(j.kind))continue;for(const l of j.lines||[])out.push(Object.assign({},l,{kind:j.kind,date:l.date||j.date,src:l.src||(j.kind==='open'?'Почетна':'Налог')}))}return out}
function ACC(){const o={};KONTO.forEach(k=>o[k[0]]={mk:k[1]});for(const [k,v] of Object.entries((firm()||{}).accounts||{}))if(v)o[k]={mk:v.mk||k};return o}
const kName=k=>{const a=ACC()[k];return a?a.mk:k};
function payTotals(p){return p.T}
const partner=id=>(S.data.partners||[]).find(p=>p.id===id);
const item=id=>(S.data.items||[]).find(i=>i.id===id);
function locName(id){return 'Магацин '+id}
function today(){return __today}
async function save(c,obj){__saved.push({c,obj});(S.data[c]=S.data[c]||[]).push(obj);return true}
async function del(c,id){__deleted.push({c,id});return true}
async function askConfirm(){return true}
function toast(){} function render(){}
`;
  SOURCE = STUBS + '\n' + RANGES.map(take).join('\n') + '\nvar __ACT={\n' + ACT_RANGES.map(take).join('\n') + '\n};\n';
  return SOURCE;
}

export interface LegacyJournal {
  id: string;
  kind: string;
  date: string;
  lines: { k: string; d: number; p: number; partner?: string; date?: string; src?: string }[];
  tax?: number;
  [k: string]: unknown;
}

export interface LegacyWorld {
  year: number;
  firm: Record<string, unknown>;
  data: Record<string, unknown[]> & { journal: LegacyJournal[] };
  today?: string;
  nd?: number | null;
}

/** A fresh legacy runtime bound to `world` (the world's arrays are used by reference). */
export function legacyRuntime(world: LegacyWorld) {
  const ctx = vm.createContext({ console });
  vm.runInContext(source(), ctx, { filename: 'legacy/index.html (year-end subset)' });
  const run = <T>(code: string): T => vm.runInContext(code, ctx) as T;
  const S = run<{ year: number; data: Record<string, unknown>; nd: number | null }>('S');
  S.year = world.year;
  S.data = world.data;
  S.nd = world.nd ?? null;
  ctx.__firmIn = world.firm;
  run('__firm=__firmIn');
  ctx.__todayIn = world.today ?? '2026-01-31';
  run('__today=__todayIn');
  // results cross the realm boundary: clone them into this realm so toEqual compares plain objects
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const call = <T>(fn: string, ...args: unknown[]): T => {
    ctx.__args = args;
    return clone(run<T>(`${fn}(...__args)`));
  };
  const callAsync = async (fn: string, ...args: unknown[]) => {
    ctx.__args = args;
    await run<Promise<unknown>>(`${fn}(...__args)`);
    return clone(run<{ c: string; obj: LegacyJournal }[]>('__saved'));
  };
  return {
    call,
    callAsync,
    /** evaluate any expression in the legacy realm (cloned) */
    get: <T>(expr: string): T => clone(run<T>(expr)),
    setYear: (y: number) => {
      S.year = y;
    },
  };
}

/** The legacy chart of accounts (`KONTO`) as konto → name. */
export function legacyAccountNames(): Record<string, string> {
  const rt = legacyRuntime({ year: 2025, firm: {}, data: { journal: [] } });
  return Object.fromEntries(rt.get<[string, string][]>('KONTO'));
}
