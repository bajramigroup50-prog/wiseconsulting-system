'use strict';
// VAT tax-group letters of the fiscal device — COPY of packages/core/src/retail/vat-groups.ts (the desktop app is plain
// CommonJS and cannot import @wise/core). packages/core/test/retail/vat-groups.test.ts asserts both stay equal.
//
// Правилник за техничките и функционалните карактеристики на фискалните системи на опрема, чл. 26 ст. 1
// (Сл. весник на РСМ 315/2020 and 60/2022): А = 18 %, Б = 5 %, В = 10 %, Г = ослободено / 0 % (and every sale of a
// firm that is not a VAT payer). Before the amendment exempt sales were in В (old programming В 0 %, Г 10 %).
// The web page always sends the letters of the LEGAL mapping; a device programmed differently („Даночни групи на
// апаратот“ in the device settings) gets them remapped by rate here.

const VAT_GROUP_LETTERS = Object.freeze(['А', 'Б', 'В', 'Г']);
const FISCAL_VAT_RATES = Object.freeze([18, 10, 5, 0]);
const FISCAL_VAT_GROUPS = Object.freeze({ А: 18, Б: 5, В: 10, Г: 0 });
const FISCAL_VAT_GROUPS_OLD = Object.freeze({ А: 18, Б: 5, В: 0, Г: 10 });
const LATIN = { A: 'А', B: 'Б', V: 'В', G: 'Г', А: 'А', Б: 'Б', В: 'В', Г: 'Г' };

const groupLetter = (s) => LATIN[String(s == null ? '' : s).trim().toUpperCase()] || null;
const toNum = (v) => (typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace('%', '').replace(',', '.').trim()));

/** Validates a device mapping (letter → 18 / 10 / 5 / 0, no rate twice); throws Error with a Macedonian message. */
function cleanVatGroups(x) {
  if (x == null || x === '') return FISCAL_VAT_GROUPS;
  if (typeof x !== 'object') throw new Error('Даночните групи на апаратот не се исправни.');
  const out = { ...FISCAL_VAT_GROUPS };
  for (const [k, v] of Object.entries(x)) {
    const L = groupLetter(k);
    if (!L) throw new Error(`Непозната даночна група „${k}“.`);
    const n = toNum(v);
    const r = Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
    if (!FISCAL_VAT_RATES.includes(r)) throw new Error(`Даночна група ${L}: стапката мора да е 18, 10, 5 или 0 %.`);
    out[L] = r;
  }
  const seen = new Map();
  for (const L of VAT_GROUP_LETTERS) {
    if (seen.has(out[L])) throw new Error(`Групите ${seen.get(out[L])} и ${L} имаат иста стапка ${out[L]} %.`);
    seen.set(out[L], L);
  }
  return Object.freeze(out);
}

/** VAT rate → letter of a device programmed with `groups` (unknown rate → the 0 % group). */
function vatGroupFor(rate, groups = FISCAL_VAT_GROUPS) {
  const r = Number(rate);
  return VAT_GROUP_LETTERS.find((L) => groups[L] === r) || VAT_GROUP_LETTERS.find((L) => groups[L] === 0) || 'Г';
}

/** Letter of the legal mapping → letter of the device (same VAT rate). */
const remapGroup = (L, groups) => vatGroupFor(FISCAL_VAT_GROUPS[L], groups);

const isLegal = (g) => VAT_GROUP_LETTERS.every((L) => g[L] === FISCAL_VAT_GROUPS[L]);

/** Rates read from the device / its X report vs the expected mapping: one line per group that differs. */
function checkVatGroups(printed, expected = FISCAL_VAT_GROUPS, only) {
  const W = [];
  for (const [k, v] of Object.entries(printed || {})) {
    const L = groupLetter(k);
    if (!L || v == null || v === '' || (only && !only.includes(L))) continue;
    const n = toNum(v);
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n - expected[L]) > 0.001) W.push(`Група ${L}: на извештајот ${n} %, очекувано ${expected[L]} %.`);
  }
  return W;
}

const VAT_GROUPS_HINT = 'Поправете ги „Даночни групи на апаратот“ (Фискална каса → ⚙️ Фискален апарат) според X извештајот — инаку сметките одат во погрешна ДДВ група.';

module.exports = {
  VAT_GROUP_LETTERS, FISCAL_VAT_RATES, FISCAL_VAT_GROUPS, FISCAL_VAT_GROUPS_OLD, VAT_GROUPS_HINT,
  groupLetter, cleanVatGroups, vatGroupFor, remapGroup, checkVatGroups, isLegal,
};
