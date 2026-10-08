/**
 * Loads the legacy bank parsing & matching code from `legacy/index.html` into a Node `vm` context.
 *
 * Snippets are located by the exact text a line starts with (not by line number) and loaded in file
 * order, so the monkey-patch chain is the one the shipped app runs. Everything the snippets touch
 * outside bank code (`S`, `firm`, `save`, `sch`, `paidFor` base, `toast`, …) is stubbed here.
 *
 * Stubs that matter for the comparison:
 * - base `save`: writes the row into `S.data.bank` immediately (legacy waited for a snapshot
 *   listener); `save('partners')` creates `new1`, `new2`, …
 * - base `paidFor` (3602): bank `ref`/`settle` sums + the fixture's `paidOther`; the legacy refs
 *   patch (12481) and virtual-advance patch (12538) are loaded on top. `S._noVirt` is set to true
 *   by default — FIX #7 (see bank-match.ts); tests that want the legacy virtual behaviour clear it.
 * - `DOMParser`: a shim over `parseXml` from src/bank/xml.ts (no DOM in Node). The XML *reader* is
 *   therefore covered by its own unit tests; the golden test covers legacy's field mapping.
 * - save wrapper 12645 (learn `osnovK` from every save) is not loaded — autoMatch must not learn from
 *   its own bookings (documented in bank-match.ts `learnOsnov`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseXml, type XmlElement } from '../../../src/bank/xml';

const LEGACY = fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url));
let LINES: string[] | null = null;
const lines = () => (LINES ??= readFileSync(LEGACY, 'utf8').split('\n'));

/** Find the single line starting with `prefix` (after leading spaces) and return `count` lines from it. */
export function grab(prefix: string, count = 1): { at: number; code: string } {
  const L = lines();
  const hits: number[] = [];
  for (let i = 0; i < L.length; i++) if (L[i]!.replace(/^\s+/, '').startsWith(prefix)) hits.push(i);
  if (hits.length !== 1) throw new Error(`legacy snippet "${prefix}" found ${hits.length}× (expected 1)`);
  const at = hits[0]!;
  return { at, code: L.slice(at, at + count).join('\n') };
}

/* ---------------------------------------------------------------- DOMParser shim */

function domEl(x: XmlElement, cache: WeakMap<XmlElement, unknown>): unknown {
  if (cache.has(x)) return cache.get(x);
  const desc = (pred: (e: XmlElement) => boolean) => {
    const out: unknown[] = [];
    const walk = (e: XmlElement) => { for (const c of e.children) { if (pred(c)) out.push(domEl(c, cache)); walk(c); } };
    walk(x);
    return out;
  };
  const text = (e: XmlElement): string => e.nodes.map((n) => (typeof n === 'string' ? n : text(n))).join('');
  const el = {
    localName: x.local,
    tagName: x.name,
    get children() { return x.children.map((c) => domEl(c, cache)); },
    get textContent() { return text(x); },
    getAttribute: (k: string) => (k in x.attrs ? x.attrs[k] : null),
    getElementsByTagName: (n: string) => desc((e) => e.name === n),
    getElementsByTagNameNS: (_ns: string, n: string) => desc((e) => e.local === n),
  };
  cache.set(x, el);
  return el;
}

class DOMParserShim {
  parseFromString(s: string) {
    const root = parseXml(s);
    const cache = new WeakMap<XmlElement, unknown>();
    if (!root) return { querySelector: (q: string) => (q === 'parsererror' ? {} : null), getElementsByTagName: () => [], getElementsByTagNameNS: () => [] };
    const r = domEl(root, cache) as { getElementsByTagName: (n: string) => unknown[]; getElementsByTagNameNS: (a: string, n: string) => unknown[] };
    return {
      querySelector: () => null,
      getElementsByTagName: (n: string) => [...(root.name === n ? [r] : []), ...r.getElementsByTagName(n)],
      getElementsByTagNameNS: (a: string, n: string) => [...(root.local === n ? [r] : []), ...r.getElementsByTagNameNS(a, n)],
    };
  }
}

/* ---------------------------------------------------------------- snippets */

/** [prefix, number of lines] — loaded sorted by position in the file. */
const SNIPPETS: [string, number][] = [
  ['const r2=n=>', 1],
  ['const inYear=d=>', 1],
  ['const partner=id=>S.data.partners.find', 1],
  ['function banks(){const f=firm()', 6], // banks, bankOf, bankKontos, acctOf, CURS, isFx
  ['function bankEntries(b){', 8],
  ['const izvKey=(a,d)=>', 1],
  ['async function ensureIzvNos(acct,dates,given){', 4],
  ['function bankParty(x){', 4],
  ['const sInv=()=>', 1],
  ['function parseAmount(s){', 1],
  ['function parseDate(s){', 1],
  ['function findHeader(rows){', 1],
  ['async function importRows(rows){', 15],
  ['function parseMT940(txt){', 13],
  ['const bKey=b=>', 1],
  ['async function saveBank(b){', 1],
  ['async function autoMatch(){', 20],
  ['function counterparty(desc){', 1],
  ['const FX_DEF=', 1],
  ['function fxRows(){', 5],
  ['const obDig=s=>', 1],
  ['const obN=s=>', 1],
  ['function obMatch(name,code){', 1],
  ['var BANK_FEE=', 1],
  ['const BKPK_RE=', 1],
  ['const bkEffK=b=>', 1],
  ['const bkName=b=>', 1],
  ['function bankCpName(desc){', 1],
  ['function bkRefPartner(b){', 1],
  ['const bkJunk=b=>', 1],
  ['var _bkSave0=save;', 8], // + save wrapper 12421
  ['const bmSeg=s=>', 1],
  ['function bmKey(num){', 3],
  ['function bmNums(t){', 4],
  ['function bmEq(d,k,weakOk){', 1],
  ['{const _pf=paidFor;paidFor=function(type,id){let s=_pf(type,id);for(const b of S.data.bank){if(!b.refs', 1],
  ['function bmSubset(P,amt){', 2],
  ['async function bmRun(){', 16],
  ['{const _am=autoMatch;autoMatch=async function(){let r={n:0};try{r=await bmRun()}', 2],
  ['{const _sv=save;save=async function(c,obj,opts){if(c===\'bank\'&&obj&&obj.refs', 1],
  ['const bkUnl=()=>', 1],
  ['function bmOpenFor(b){', 2],
  ['async function bmLink(b,pick,type){', 3],
  ['let _bvC=null;', 1],
  ['function bkVirt(){', 9],
  ['{const _pf=paidFor;paidFor=function(type,id){const s=_pf(type,id);if(S._noVirt)return s;', 3], // + render/save cache resets
  ['for(const fn of [\'bmRun\',\'bmOpenFor\',\'bankTargets\']){', 2],
  ['{const _p=parseMT940;parseMT940=function(txt){const R=_p(txt);for(const st of R){', 3],
  ['const BK_LAT=', 1],
  ['const bkLat=s=>', 1],
  ['const bkCore=s=>', 1],
  ['function bkOwn(b){', 3],
  ['const bkOwnK=b=>', 1],
  ['{const _sv=save;save=async function(c,obj,opts){if(c===\'bank\'&&obj&&!obj.konto&&!obj.ref&&!(obj.split&&obj.split.length)&&bkOwn(obj))', 1],
  ['function trResid(){', 2],
  ['async function bmRunFx(){', 13],
  ['{const _p=parseMT940;parseMT940=function(txt){const R=_p(txt);S._mtLast=R;', 1],
  ['const xNum=v=>', 1],
  ['const xDate=v=>', 1],
  ['function parseBankXml(txt){', 20],
  ['{const _am=autoMatch;autoMatch=async function(){const f=firm()||{};const M=f.osnovK', 3],
  ['let _impAsk=null;', 1],
  ['{const _am=autoMatch;autoMatch=async function(){if(_impAsk)', 1],
  ['const KB_RE=', 1],
  ['function parseKB(txt){', 7],
  ['{const _p=parseMT940;parseMT940=function(txt){const R=_p(txt);try{const blocks', 4],
  ['const CONV_RE=', 1],
  ['function convFxKonto(b){', 2],
  ['const isConv=b=>', 1],
  ['{const _sv=save;save=async function(c,obj,opts){if(c===\'bank\'&&obj&&!obj.konto&&!obj.ref&&!(obj.split&&obj.split.length)&&isConv(obj))', 1],
  ['{const _be=bankEntries;bankEntries=function(b){if(b&&b.conv', 1],
  ['async function convPair(){', 4],
  ['{const _am=autoMatch;autoMatch=async function(){let n=0;for(const b of S.data.bank.filter(b=>!b.ref&&!b.konto&&+b.amount&&!isFx(b.acct))){', 3],
  ['function posKDef(){', 1],
  ['const POS_NAME=', 1],
  ['function posPid(){', 1],
  ['async function posEnsure(){', 1],
  ['const POS_RE=', 1],
  ['const posIs=b=>', 1],
  ['{const _sv=save;save=async function(c,obj,opts){if(c===\'bank\'&&obj&&!obj.konto&&!obj.ref&&!(obj.split&&obj.split.length)&&!obj.own&&posIs(obj))', 1],
  ['{const _am=autoMatch;autoMatch=async function(){let n=0;for(const b of S.data.bank.filter(b=>!b.ref&&!b.pos', 2],
  ['const ppDig=v=>', 1],
  ['function ppIban(acc){', 1],
  ['const ppIbanOn=d=>', 1],
  ['function ppAccTxt(acc,d,forceIban){', 1],
];

const STUBS = `
var window = globalThis;
var S = { year: 2026, data: { bank: [], invoices: [], purchases: [], partners: [], payroll: [], docs: [], journal: [] }, firm: {}, log: [], nNew: 0, _noVirt: true, db: null, gfx: { rows: [] } };
S.db = { doc: (p) => ({ update: async (o) => { S.updates.push(o); Object.assign(S.firm, o); } }) };
S.updates = [];
function firm() { return S.firm; }
function toast() {}
function render() {}
function uid() { return 'u' + (++S.nNew); }
function today() { return S.today || '2026-10-08'; }
function setTimeout() {}
function sch(k) { return ({ ddvPay: '23008', ddvClaim: '1308', pay_net: '2401', customer: '1200', supplier: '2200' })[k] || ''; }
function invTotal(i) { return i.total; }
function purTotal(p) { return p.total; }
function cbRows() { return S.cb || []; }
function impMsg(t, batch, dates) { S.impMsg = { t, dates }; }
async function setIzvNos(map) { S.izvNos = map; S.firm.izv = { ...(S.firm.izv || {}), ...map }; }
function fxItem(nb) { return nb; }
function payMatch(amt, date) { const m = (S.pay || []).find((x) => Math.abs(x.amount - amt) < 1 && (!date || date >= x.month + '-01')); return m ? { month: m.month, konto: m.konto } : null; }
function paidFor(type, id) {
  if (type === 'purchase') { const pp = S.data.purchases.find((x) => x.id === id); if (pp && pp.cash) return purTotal(pp); }
  const doc = (type === 'invoice' ? S.data.invoices : S.data.purchases).find((x) => x.id === id);
  return r2(S.data.bank.filter((b) => b.ref && b.ref.type === type && b.ref.id === id).reduce((s, b) => s + (b.settle != null ? +b.settle : Math.abs(+b.amount || 0)), 0) + ((doc && doc.paidOther) || 0));
}
async function save(c, obj, opts) {
  if (c === 'bank') { const i = S.data.bank.findIndex((x) => x.id === obj.id); if (i >= 0) S.data.bank[i] = obj; else S.data.bank.push(obj); S.log.push(obj); return obj.id || true; }
  if (c === 'partners') { const id = 'new' + (++S.nNew); S.data.partners.push({ ...obj, id }); return id; }
  if (c === 'journal') { S.journal = (S.journal || []).concat([obj]); return true; }
  return true;
}
async function bankFindPartner(b) { const nm = typeof b === 'string' ? '' : bkName(b); if (!nm || nm.length < 3) return ''; const pid = obMatch(nm, ''); if (pid) return pid; const id = await _bkSave0('partners', { name: nm, active: true }, { force: true }); return id || ''; }
function ledger() { return S.ledger || []; }
`;

export interface Legacy {
  ctx: vm.Context;
  S: any;
  run: <T = unknown>(code: string) => T;
}

/** Fresh legacy context. */
export function loadLegacy(): Legacy {
  const parts = SNIPPETS.map(([p, n]) => grab(p, n)).sort((a, b) => a.at - b.at);
  // overlapping ranges would load code twice
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const prevEnd = prev.at + prev.code.split('\n').length;
    if (parts[i]!.at < prevEnd) throw new Error('overlapping legacy snippets at line ' + (parts[i]!.at + 1));
  }
  const sandbox: Record<string, unknown> = { DOMParser: DOMParserShim, console: { warn() {}, log() {} } };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(STUBS + '\n' + parts.map((p) => p.code).join('\n'), ctx, { filename: 'legacy-bank.js' });
  const run = <T,>(code: string) => vm.runInContext(code, ctx) as T;
  return { ctx, S: run('S'), run };
}

/** JSON round-trip out of the vm realm (so `toEqual` compares plain objects). */
export const plain = <T,>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
