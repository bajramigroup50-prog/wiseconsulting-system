/**
 * One-off extractor: Phase 2 reference data from legacy/index.html → src/seed/data/*.json.
 * The JSON files are committed; re-run only if the legacy source changes:
 *
 *   pnpm --filter @wise/db exec tsx src/seed/extract-legacy.ts
 *
 * Each literal is evaluated in a `vm` sandbox from its line range (docs/LEGACY-MAP.md "Reference data").
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseKontoSrc } from '@wise/core';

const L = readFileSync(fileURLToPath(new URL('../../../../legacy/index.html', import.meta.url)), 'utf8').split('\n');
const out = fileURLToPath(new URL('./data/', import.meta.url));
mkdirSync(out, { recursive: true });

const slice = (a: number, b: number, start: string) => {
  const t = L.slice(a - 1, b).join('\n');
  if (!t.startsWith(start)) throw new Error(`line ${a} should start with ${start}`);
  return t;
};
const evalConst = (src: string, name: string): unknown => vm.runInNewContext(`${src}\n;${name}`);
/** One row per line: compact and diff-friendly. */
const rows = (a: unknown[]) => '[\n' + a.map((r) => JSON.stringify(r)).join(',\n') + '\n]';
const write = (f: string, v: unknown) => {
  const body = Array.isArray(v) ? rows(v)
    : '{\n' + Object.entries(v as object).map(([k, x]) => JSON.stringify(k) + ': ' + (Array.isArray(x) ? rows(x) : JSON.stringify(x))).join(',\n') + '\n}';
  writeFileSync(out + f, body + '\n');
  console.log(f);
};

/* KONTO_SRC 308–3166 (2,859 accounts). FIX: typo in the first line "тргвоски" → "трговски" (LEGACY-MAP R.1). */
const konto = parseKontoSrc(String(evalConst(slice(308, 3166, 'const KONTO_SRC=`'), 'KONTO_SRC')))
  .map(([k, n]) => [k, n.replace('тргвоски', 'трговски')] as [string, string]);
if (konto.length !== 2859 || new Set(konto.map(([k]) => k)).size !== konto.length) throw new Error('unexpected KONTO_SRC shape');
write('accounts.json', konto);

/* Cities — inside ACT.cbSeedCity 7145: [code, city, postal code, municipality]. */
const cityLine = slice(7145, 7145, '  async cbSeedCity(){');
const cities = vm.runInNewContext(cityLine.slice(cityLine.indexOf('const C=') + 8, cityLine.indexOf('];') + 1)) as string[][];
write('cities.json', cities);

/* Currencies — FX_DEF 6491 (default NBRM mid rates as of FX_DATE0 6490). */
const fxDate = String(evalConst(slice(6490, 6490, 'const FX_DATE0='), 'FX_DATE0'));
const fx = evalConst(slice(6491, 6491, 'const FX_DEF='), 'FX_DEF') as [string, string, number][];
write('currencies.json', { date: fxDate, rows: fx });
