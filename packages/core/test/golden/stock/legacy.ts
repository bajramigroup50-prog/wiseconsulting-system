/**
 * Golden-test harness: extracts the legacy stock functions from `legacy/index.html` by their declaration line
 * (brace-balanced, so multi-line bodies come along) and evaluates them in a Node `vm` context with a stubbed `S`
 * state, `firm()`, `save()`, `ledger()`, `today()`.
 *
 * `variant: 'shipped'` loads the effective `stockAt` (index.html 13858, `(itemId, wh, date, before)`) — what the
 * running app does, including the argument-order bug. `variant: 'intended'` loads the older `stockAt` (4914,
 * `(id, date, wh)`) that the ~22 callers were written for, which is the behaviour the port must reproduce.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML_PATH = fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url));
let LINES: string[] | null = null;
const lines = (): string[] => (LINES ??= readFileSync(HTML_PATH, 'utf8').split('\n'));

/** Take the statement starting on the line that matches `anchor` (first/last match), brace-balanced across lines. */
export function grab(anchor: RegExp, which: 'first' | 'last' = 'first'): string {
  const L = lines();
  const hits: number[] = [];
  L.forEach((l, i) => {
    if (anchor.test(l)) hits.push(i);
  });
  if (!hits.length) throw new Error('legacy anchor not found: ' + anchor);
  const start = which === 'first' ? hits[0]! : hits[hits.length - 1]!;
  let bal = 0;
  const out: string[] = [];
  for (let i = start; i < L.length; i++) {
    const l = L[i]!;
    out.push(l);
    for (const ch of l) {
      if (ch === '{') bal++;
      else if (ch === '}') bal--;
    }
    if (bal <= 0) break;
  }
  return out.join('\n');
}

const SOURCES = (variant: 'shipped' | 'intended'): string[] => [
  grab(/^const r2=n=>Math\.round/),
  grab(/^const r4=n=>/),
  grab(/^const fmt=n=>/),
  grab(/^const fq=n=>/),
  grab(/^const dmy=d=>/),
  grab(/^const SCH0=/),
  grab(/^const SCH_OLD=/),
  grab(/^const sch=k=>/),
  grab(/^const STOCK_K=/),
  grab(/^const COGS_K=/),
  grab(/^const posL=/),
  grab(/^const retailOn=w=>/),
  grab(/^function locs\(\)/),
  grab(/^const whOf=/),
  grab(/^const kindOf=/),
  grab(/^const cbRows=/),
  grab(/^function stock\(itemId,wh\)/),
  grab(/^async function postOut\(/),
  grab(/^const trk=/),
  grab(/^const retailP=/),
  grab(/^function priceAt\(/),
  variant === 'shipped' ? grab(/^function stockAt\(itemId,wh,date,before\)/) : grab(/^function stockAt\(id,date,wh\)/),
  grab(/^const COSTS=/),
  grab(/^function costVat\(/),
  grab(/^function costsOf\(/),
  grab(/^const stVal=/),
  grab(/^function allocAuto\(/),
  grab(/^function allocCosts\(/),
  grab(/^function purRound\(/),
  grab(/^function calcRows\(/),
  grab(/^const fkN=/),
  grab(/^function fkAlloc\(/),
  grab(/^function fkIssuePlan\(/),
  grab(/^function fkSpread\(/),
  grab(/^function kdfiRows\(/, 'last'),
  grab(/^function kdfiDay\(/, 'last'),
  grab(/^function dfiDays\(/),
  grab(/^function dfiControl\(/),
  grab(/^const dDiffD=/),
  grab(/^async function reaverage\(/),
  grab(/^function prnKonta\(/),
  grab(/^function prnLines\(/),
  grab(/^function akNewPrice\(/),
  // the stock-line part of purPersist (index.html 4388): allocation, whole-denar values, difference on the largest line
  'function __purStock(p){const AL=allocCosts(p);' +
    /const AL=allocCosts\(p\);(p\.stock=.*?)p\.lines=purchaseEntries/.exec(grab(/^async function purPersist\(/))![1] +
    'return p.stock}',
  // the levelling block inside ledger() (index.html 3461), wrapped so it can be called with an `add` collector
  'function __nivLedger(add){\n' + grab(/^\s*S\.data\.docs\.filter\(x=>x\.type==='nivel'&&\(retailOn/) + '\n}',
];

export interface LegacyFixture {
  moves?: any[];
  items?: any[];
  docs?: any[];
  codes?: any[];
  production?: any[];
  sales?: any[];
  firm?: any;
  gsch?: any;
  today?: string;
  ledger?: any[];
  year?: string;
}

export interface Legacy {
  S: any;
  saved: [string, any][];
  fn: Record<string, (...a: any[]) => any>;
}

/** Fresh legacy context loaded with the fixture (deep-copied). */
export function loadLegacy(fx: LegacyFixture, variant: 'shipped' | 'intended' = 'shipped'): Legacy {
  const clone = <T>(x: T): T => (x === undefined ? x : structuredClone(x));
  const S: any = {
    data: {
      moves: clone(fx.moves) ?? [],
      items: clone(fx.items) ?? [],
      docs: clone(fx.docs) ?? [],
      codes: clone(fx.codes) ?? [],
      production: clone(fx.production) ?? [],
      sales: clone(fx.sales) ?? [],
    },
    gsch: clone(fx.gsch) ?? { sch: {} },
    bulk: true,
    year: fx.year ?? '2026',
  };
  const saved: [string, any][] = [];
  const ctx: any = {
    S,
    console,
    firm: () => fx.firm ?? { ddv: true, sch: {} },
    item: (id: string) => S.data.items.find((i: any) => i.id === id),
    save: async (c: string, obj: any) => {
      saved.push([c, structuredClone(obj)]);
      const arr = S.data[c];
      if (arr && obj.id) {
        const i = arr.findIndex((x: any) => x.id === obj.id);
        if (i >= 0) arr[i] = obj;
        else arr.push(obj);
      }
      return obj.id || 'new';
    },
    toast: () => {},
    render: () => {},
    today: () => fx.today ?? '2026-12-31',
    ledger: () => clone(fx.ledger) ?? [],
    posKDef: () => String((fx.firm ?? {}).posK || '1200001'),
    locName: (id: string) => String(id || 'main'),
    rangeOf: (p: string) => [S[p + 'From'], S[p + 'To']],
  };
  vm.createContext(ctx);
  const names = [
    'r2', 'r4', 'fmt', 'fq', 'dmy', 'sch', 'posL', 'retailOn', 'rk', 'stockK', 'locs', 'kindOf', 'stock', 'postOut', 'retailP',
    'priceAt', 'stockAt', 'costVat', 'costsOf', 'stVal', 'allocAuto', 'allocCosts', 'purRound', 'calcRows', 'fkN', 'fkAlloc',
    'fkIssuePlan', 'fkSpread', 'kdfiRows', 'kdfiDay', 'dfiDays', 'dfiControl', 'reaverage', 'prnKonta', 'prnLines', 'akNewPrice',
    '__nivLedger', '__purStock',
  ];
  const code = SOURCES(variant).join('\n') + `\n;globalThis.__L={${names.join(',')}};`;
  vm.runInContext(code, ctx, { filename: 'legacy-stock.js' });
  return { S, saved, fn: ctx.__L };
}

/** Legacy `{k,d,p}` lines → port lines. */
export const toPortLines = (L: any[] = []) => L.map(({ k, d, p, ...r }) => ({ ...r, account: String(k), debit: d, credit: p }));
/** Legacy moves → port moves (lines converted). */
export const toPortMoves = (M: any[] = []) => M.map((m) => ({ ...m, ...(m.lines ? { lines: toPortLines(m.lines) } : {}) }));
/** Legacy `codes` rows (cb warehouse/store) → port locations. */
export const toPortLocations = (codes: any[] = []) =>
  codes.filter((c) => c.cb === 'warehouse' || c.cb === 'store').map((c) => ({ ...c, kind: c.cb }));
