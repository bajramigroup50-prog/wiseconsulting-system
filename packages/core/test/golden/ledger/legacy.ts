/**
 * Golden-test loader for the Phase 2 ledger functions of legacy/index.html.
 *
 * Extracts the *effective* (final) definitions by line range — see docs/LEGACY-MAP.md §2.1 — and evaluates
 * them in a `vm` context together with small stubs for the legacy globals they touch (`S`, `firm()`, `ledger()`,
 * `save()`, …). Each range is checked against the expected first characters so a drift in the legacy file
 * fails loudly instead of testing the wrong code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = readFileSync(fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url)), 'utf8').split('\n');

/** [from, to, expected start] — inclusive 1-based line numbers. */
const PARTS: [number, number, string][] = [
  [3267, 3267, 'const r2='],
  [4209, 4209, 'const dmy='],
  [4745, 4745, 'function parseAmount('],
  [3478, 3483 + 27, 'const NAL_DEF='], // NAL_DEF, nalCode, bankNalCode, nalMode, nalPer, nalogMap (3483–3510)
  [3600, 3601, 'function balances('],
  [3605, 3605, 'function periodOf('],
  [5915, 5915, 'function perRange('],
  [6648, 6653, 'const CLS='], // CLS, BB_LV, bbRows
  [6679, 6681, 'function kkData('],
  [6732, 6753, 'async function closeYear('], // closeYear + openYear
  [10620, 10622, 'const obDig='],
  [10624, 10624, 'const obNum='],
  [10626, 10644, 'async function obSheet('],
  [10659, 10662, 'function obDropSums('],
  [10670, 10685, 'async function importOpen('],
  [12386, 12389, 'const obResK='],
];

function code(): string {
  return PARTS.map(([a, b, start]) => {
    const text = SRC.slice(a - 1, b).join('\n');
    if (!text.startsWith(start)) throw new Error(`legacy/index.html drifted: line ${a} should start with "${start}"`);
    return text;
  }).join('\n');
}

/** Legacy ledger line shape (`ledger()` 3448). */
export interface LLine {
  k: string; d: number; p: number; date: string; partner?: string;
  src?: string; docId?: string; label?: string; kind?: string;
}

export interface LegacyEnv {
  year: number;
  lines: LLine[];
  firm?: Record<string, unknown>;
  data?: Partial<Record<'partners' | 'invoices' | 'purchases' | 'sales' | 'journal' | 'docs' | 'moves' | 'bank', Record<string, unknown>[]>>;
  /** Extra `S` fields (kkK, kkFrom, …). */
  state?: Record<string, unknown>;
}

export interface Legacy {
  ctx: Record<string, any>;
  saved: { c: string; obj: any; opts: any }[];
  fn: Record<string, (...a: any[]) => any>;
}

/** Build a fresh legacy sandbox whose `ledger()` returns `env.lines` (for `env.year`). */
export function loadLegacy(env: LegacyEnv): Legacy {
  const saved: Legacy['saved'] = [];
  const F = { id: 'f1', banks: [], ...(env.firm ?? {}) } as Record<string, any>;
  const data = { partners: [], invoices: [], purchases: [], sales: [], journal: [], docs: [], moves: [], bank: [], ...(env.data ?? {}) };
  const S: Record<string, any> = { year: env.year, data, draft: null, ...(env.state ?? {}) };
  const ctx: Record<string, any> = {
    S,
    console,
    firm: () => F,
    ledger: (opt: { excl?: string[] } = {}) =>
      env.lines.filter((l) => !(l.kind && (opt.excl ?? []).includes(l.kind))).map((l) => ({ ...l }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    ACC: () => ({}),
    kName: (k: string) => k,
    partner: (id: string) => data.partners.find((p: any) => p.id === id),
    banks: () => F.banks,
    bankOf: (a: string) => F.banks.find((b: any) => b.id === (a || 'main')) ?? F.banks[0] ?? { name: '' },
    whOf: () => '',
    locName: () => '',
    blgReg: () => ({ konto: '1020', name: 'Благајна' }),
    save: async (c: string, obj: any, opts: any) => { saved.push({ c, obj, opts }); return obj.id ?? 'new'; },
    toast: () => {},
    render: () => {},
    fmt: (n: number) => String(n),
    dbData: () => ({ V: {} }),
    isPdf: () => false,
    document: { getElementById: () => null },
  };
  vm.createContext(ctx);
  const names = ['r2', 'dmy', 'parseAmount', 'NAL_DEF', 'nalCode', 'bankNalCode', 'nalPer', 'nalogMap', 'balances', 'sumPref',
    'CLS', 'bbRows', 'kkData', 'closeYear', 'openYear', 'obDig', 'obN', 'obMatch', 'obSheet', 'obDropSums', 'importOpen',
    'obResK', 'obResLines'];
  const fn = vm.runInContext(`${code()}\n;({${names.join(',')}})`, ctx, { filename: 'legacy/index.html' }) as Legacy['fn'];
  return { ctx, saved, fn };
}

/** A minimal File-like object for `obSheet` / `importOpen` (CSV path). */
export const csvFile = (text: string, name = 'bb.csv') => ({ name, type: 'text/csv', text: async () => text });
