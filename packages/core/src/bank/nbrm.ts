/**
 * „💱 Курсна листа НБРМ“ — the official middle rates of the National Bank (Народна банка на Република Северна
 * Македонија), free web service `KLServiceNOV` (checked live in October 2026):
 *
 *   GET https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=dd.MM.yyyy&EndDate=dd.MM.yyyy&format=json
 *
 * Answer: one object per currency and day — `{ rBr, datum: "2026-10-09T00:00:00", valuta: "978", oznaka: "EUR",
 * nomin: 1, sreden: 61.6866, nazivMak: "евро", … }` (the XML variant has the same fields capitalised: `<Oznaka>`,
 * `<Sreden>`, `<Nomin>`, `<Datum>`). The service also returns Saturdays / Sundays (the Friday list repeated); days
 * it does not return (holidays, the future) are covered by `fxRate`, which takes the last rate on or before a date.
 *
 * The rate stored is MKD for ONE unit: `sreden / nomin` (6 decimals, the `fx_rates.rate` scale).
 */

export const NBRM_BASE = 'https://www.nbrm.mk/KLServiceNOV/GetExchangeRate';

const dmyDot = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** URL of the JSON list for `[from, to]` (`YYYY-MM-DD`). */
export const nbrmUrl = (from: string, to: string): string => `${NBRM_BASE}?StartDate=${dmyDot(from)}&EndDate=${dmyDot(to)}&format=json`;

export interface NbrmRate { date: string; cur: string; rate: number; name?: string }

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

function row(o: Record<string, unknown>): NbrmRate | null {
  const g = (k: string) => o[k] ?? o[k[0]!.toUpperCase() + k.slice(1)];
  const cur = String(g('oznaka') ?? '').trim().toUpperCase();
  const date = String(g('datum') ?? '').slice(0, 10);
  const mid = num(g('sreden'));
  const nom = num(g('nomin') ?? 1) || 1;
  if (!/^[A-Z]{3}$/.test(cur) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(mid > 0)) return null;
  const name = g('nazivMak');
  return { date, cur, rate: Math.round((mid / nom) * 1e6) / 1e6, ...(name ? { name: String(name) } : {}) };
}

/**
 * Parse the service's answer (JSON array, or the XML `ArrayOfGetExchangeRate`). Rows without a currency code, a
 * date or a positive middle rate are skipped; the result is sorted by date, then currency, one row per pair.
 */
export function parseNbrm(text: string): NbrmRate[] {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  let objs: Record<string, unknown>[] = [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t) as unknown;
    objs = (Array.isArray(j) ? j : Array.isArray((j as { d?: unknown }).d) ? (j as { d: unknown[] }).d : []) as Record<string, unknown>[];
  } else if (t.startsWith('<') && /<ArrayOfGetExchangeRate[\s>]/.test(t)) {
    for (const m of t.matchAll(/<GetExchangeRate>([\s\S]*?)<\/GetExchangeRate>/g)) {
      const o: Record<string, unknown> = {};
      for (const f of m[1]!.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) o[f[1]!.charAt(0).toLowerCase() + f[1]!.slice(1)] = f[2];
      objs.push(o);
    }
  } else throw new Error('НБРМ: непознат одговор од сервисот.');
  const M = new Map<string, NbrmRate>();
  for (const o of objs) { const r = o && typeof o === 'object' ? row(o) : null; if (r) M.set(`${r.date}|${r.cur}`, r); }
  return [...M.values()].sort((a, b) => a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur));
}

/** Split `[from, to]` into chunks of at most `days` days (the service is asked one chunk at a time). */
export function nbrmChunks(from: string, to: string, days = 31): [string, string][] {
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const out: [string, string][] = [];
  for (let a = at(from); a <= at(to); a += days * 864e5) out.push([iso(a), iso(Math.min(at(to), a + (days - 1) * 864e5))]);
  return out;
}

/** Longest backfill accepted at once (two years). */
export const NBRM_MAX_DAYS = 731;
