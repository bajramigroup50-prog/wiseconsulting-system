/**
 * Golden-test harness: loads the effective legacy posting / VAT functions from `legacy/index.html`
 * into a Node `vm` context with a stubbed global state `S`, so legacy and new code can run on the
 * same fixtures.
 *
 * Each snippet is located by the text a line *starts* with, then the whole statement is taken by
 * bracket matching (strings, template literals, comments and regex literals are skipped). Snippets
 * are concatenated in file order, so later wrappers / reassignments (the monkey-patches) apply on
 * top of earlier definitions exactly as in the browser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { r2 } from '../../../src/money';
import type { JournalLine } from '../../../src/posting';

const LEGACY = fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url));

/** Line starts of every legacy definition the posting/VAT code depends on (final versions incl. patches). */
const MARKERS = [
  // helpers & state lookups
  'const r2=', 'const firm=', 'const partner=', 'const item=', 'const dmy=', 'function locs(', 'const kindOf=', 'const cbRows=', 'const bzD=', 'const passK=',
  // VAT accounts and schemes
  'const RATES=', 'const VAT_OUT0=', 'const VAT_IMP0=', 'const VAT_IN0=', 'const ART32_TXT=', 'const SCH0=', 'const schOn=', 'const SCH_OLD=', 'const sch=',
  'const STOCK_K=', 'const COGS_K=', 'const REV_K=', 'const posL=', 'const retailOn=',
  // invoices / purchases
  'function calcLines(', 'function advDeduct(', 'const REV_RATE=', 'function revByRate(', 'function invoiceEntries(', 'function purchaseEntries(',
  'function vatKset(', 'function roundL(', 'function purchaseEntries0(', 'function purTotal(',
  'const COSTS=', 'function costVat(', 'function costsOf(', 'const stVal=', 'function allocAuto(', 'function allocCosts(', 'function purRound(',
  'function calcRows(', 'function stType(', 'const retailP=',
  // bank / cash / retail
  'function banks(', 'const bankOf=', 'const isFx=', 'function bankEntries(', 'function saleEntries(',
  'const BLG_CAT=', 'const BLG_CTRY=', 'const BLG_CUR=', 'const BLG_FX0=', 'function blgRegs(', 'const blgReg=', 'const blgKonto=', 'function blgCalc(', 'function blgEntries(',
  'function scrCalc(', 'function scrEntries(', 'function kompTot(', 'function kompEntries(',
  'function fiskEntries(', 'function posKDef(', 'const POS_NAME=', 'function posPid(',
  '{const _f=fiskEntries;fiskEntries=function(z){const L=_f(z)', 'const FK_SC=', '{const _f=fiskEntries;fiskEntries=function(z){const fk=',
  '{const _be=bankEntries;',
  // VAT
  'function periodOf(', 'function ddvFor(', 'const DDV04=', 'function ddv04(', 'function perRange(',
  'function dkOut(', 'function dkIn(', 'const DK_COLS=', 'function dkSum(',
  // travel margin + patches
  'const TU=', 'const TA_OWN=', 'const tarrs=', 'const tbTot=', 'const tbPaid=', 'const tbPax=', 'function taOwn(', 'function taCost(', 'function taCalc(',
  'function tuMarginFor(', '{const _df=ddvFor;', '{const _pe=purchaseEntries0;',
];

/** Index of the char after the statement that starts at `start` (end of the line where all brackets close). */
function statementEnd(src: string, start: number): number {
  let depth = 0;
  let i = start;
  const tpl: number[] = []; // depth at which each open template literal's `${` began
  let prevSig = '';
  const regexOk = () => prevSig === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig) || /\b(return|typeof|in|of|case)$/.test(src.slice(Math.max(0, i - 10), i).trimEnd());
  const skipString = (q: string) => {
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') i++;
      i++;
    }
    i++;
  };
  const skipTemplate = (): boolean => {
    // returns true when we stopped at `${` (entering code), false at closing backtick
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return false; }
      if (c === '$' && src[i + 1] === '{') { i += 2; return true; }
      i++;
    }
    return false;
  };
  for (;;) {
    if (i >= src.length) return i;
    const c = src[i]!;
    if (c === '\n') {
      if (depth === 0 && tpl.length === 0 && i > start) return i;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { skipString(c); prevSig = 'a'; continue; }
    if (c === '`') {
      i++;
      if (skipTemplate()) { tpl.push(depth); depth++; prevSig = '{'; }
      else prevSig = 'a';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && regexOk()) {
      i++;
      let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] ?? '')) i++;
      prevSig = 'a';
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (c === '}' && tpl.length && depth === tpl[tpl.length - 1]) {
        tpl.pop();
        i++;
        if (skipTemplate()) { tpl.push(depth); depth++; prevSig = '{'; }
        else prevSig = 'a';
        continue;
      }
    }
    if (!/\s/.test(c)) prevSig = /[\w$)\]]/.test(c) ? 'a' : c;
    i++;
  }
}

function extract(src: string): string {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const found: { pos: number; text: string; marker: string }[] = [];
  for (const m of MARKERS) {
    const pos = lineStarts.find((p) => src.startsWith(m, p));
    if (pos === undefined) throw new Error(`legacy marker not found: ${m}`);
    found.push({ pos, marker: m, text: src.slice(pos, statementEnd(src, pos)) });
  }
  found.sort((a, b) => a.pos - b.pos);
  return found.map((f) => f.text).join('\n');
}

const PRELUDE = `
var S={firms:[],fid:'F',data:{},gsch:null,year:2026,fk:null};
function ACC(){return S.__acc||new Proxy({},{get:()=>({mk:''})})}
function today(){return '2026-10-08'}
`;
const EPILOGUE = `
globalThis.__L={invoiceEntries,purchaseEntries,bankEntries:b=>bankEntries(b),saleEntries,blgEntries,blgCalc,scrEntries,scrCalc,kompEntries,
  fiskEntries:z=>fiskEntries(z),ddvFor:(a,b)=>ddvFor(a,b),ddv04,dkOut,dkIn,dkSum,calcLines,advDeduct,calcRows,taCalc,tuMarginFor,periodOf,perRange,
  sch,VAT_OUT:r=>VAT_OUT[r],VAT_IN:r=>VAT_IN[r],VAT_IMP:r=>VAT_IMP[r]};
`;

export interface LegacyState {
  /** Legacy firm record (ddv, sch, vatIn/vatOut/vatImp/vatInKonto, banks, blg, posK, posP, tour…). */
  firm?: Record<string, unknown>;
  /** Legacy `S.data` collections. */
  data?: Record<string, unknown[]>;
  /** Global `appsettings/schemes`. */
  gsch?: Record<string, unknown> | null;
}

type Fn = (...a: any[]) => any;
export interface Legacy {
  /** Run `fn` against the legacy functions with the given state loaded. */
  run<T>(state: LegacyState, fn: (L: Record<string, Fn>) => T): T;
  source: string;
}

let cached: Legacy | undefined;

export function loadLegacy(): Legacy {
  if (cached) return cached;
  const html = readFileSync(LEGACY, 'utf8').replace(/\r\n/g, '\n');
  // FIX (LEGACY-MAP 4.4 #14) applied to the reference too: legacy `blgCalc` rounded to whole denars
  // (`Math.round`); the port rounds to the cent. Everything else in the cash posting is compared as-is.
  const fixed = extract(html).replace(/^function blgCalc\(x\)\{.*$/m, (l) => {
    const r = l.replace(/Math\.round\(/g, 'r2(').replace('base:mkd-vat', 'base:r2(mkd-vat)');
    if (r === l) throw new Error('blgCalc FIX #14 patch did not apply');
    return r;
  });
  const source = PRELUDE + fixed + EPILOGUE;
  const context = vm.createContext({ console });
  vm.runInContext(source, context, { filename: 'legacy-posting-vat.js' });
  const S = vm.runInContext('S', context) as { firms: unknown[]; data: Record<string, unknown[]>; gsch: unknown };
  const L = (context as { __L: Record<string, Fn> }).__L;
  const COLS = ['codes', 'employees', 'partners', 'items', 'invoices', 'purchases', 'bank', 'sales', 'journal', 'payroll', 'moves', 'production', 'assets', 'docs'];
  cached = {
    source,
    run(state, fn) {
      S.firms = [{ id: 'F', ...(state.firm ?? {}) }];
      const data: Record<string, unknown[]> = {};
      for (const c of COLS) data[c] = [];
      // Deep copy so legacy mutations never leak into fixtures.
      S.data = JSON.parse(JSON.stringify({ ...data, ...(state.data ?? {}) }));
      S.gsch = state.gsch ? JSON.parse(JSON.stringify(state.gsch)) : null;
      return fn(L);
    },
  };
  return cached;
}

/** Legacy ledger line `{k,d,p,partner,note|desc,vb,dd|dp,doc}` → new `JournalLine` (zero lines dropped). */
export function normLegacy(lines: any[], opts: { cur?: string } = {}): JournalLine[] {
  return lines
    .filter((l) => (+l.d || 0) || (+l.p || 0))
    .map((l) => {
      const j: JournalLine = { account: String(l.k), debit: r2(+l.d || 0), credit: r2(+l.p || 0) };
      if (l.partner) j.partnerId = String(l.partner);
      const fx = l.dd !== '' && l.dd != null ? +l.dd : l.dp !== '' && l.dp != null ? +l.dp : undefined;
      if (fx != null) {
        if (opts.cur) j.cur = opts.cur;
        j.amtCur = fx;
      }
      const note = l.note || l.desc;
      if (note) j.note = note;
      if (l.vb != null && l.vb !== '') j.vatBase = r2(+l.vb);
      if (l.doc) j.doc = String(l.doc);
      return j;
    });
}

/** Strip `-0` and key order noise for deep equality of plain objects. */
export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x, (_k, v) => (Object.is(v, -0) ? 0 : v)));
