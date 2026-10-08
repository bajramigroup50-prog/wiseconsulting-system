/**
 * Construction (legacy 10043–10108, 11821–11839): bill of quantities (предмер), situations (cumulative executed
 * quantities → this situation = cumulative − previous), project result, invoice lines.
 *
 * Config (legacy `firm.cons`, FIX 10.4 item 7: `settings.industry.cons`): labour cost per hour, revenue konto, VAT rate.
 */
import { num, r2, r4, type ModuleInvoiceLine } from './common';

export interface ConsConfig {
  /** Labour cost per hour (diary). */
  hr: number;
  /** Revenue konto ('' = posting scheme `revService`). */
  revK: string;
  /** FIX (LEGACY-MAP 10.4 item 5): `csInv` hard-coded 18%. */
  rate: number;
}
export const CONS_DEFAULTS: ConsConfig = { hr: 350, revK: '', rate: 18 };
export const consConfig = (o: Partial<ConsConfig> | null | undefined): ConsConfig => ({ ...CONS_DEFAULTS, ...(o ?? {}) });

export interface BoqLine { pos?: string; desc: string; unit?: string; qty: number | string; price: number | string }
export interface Situation { id?: string | null; no?: string; date: string; cum: Readonly<Record<string, number | string>> }

/** Legacy `boqVal`: contracted value without VAT. */
export const boqValue = (boq: readonly BoqLine[]): number => r2(boq.reduce((s, l) => s + num(l.qty) * num(l.price), 0));

/**
 * Legacy `sitPrev`: highest cumulative quantity per BOQ line of the earlier situations (ordered by date, then number).
 * The situation itself (by id) and everything after it are excluded.
 */
export function situationPrevious(all: readonly Situation[], s: Situation): Record<string, number> {
  const prev: Record<string, number> = {};
  for (const x of all) {
    if (s.id && x.id === s.id) break;
    if (!s.id && String(x.date) > String(s.date)) continue;
    for (const [i, q] of Object.entries(x.cum ?? {})) prev[i] = Math.max(prev[i] ?? 0, num(q));
  }
  return prev;
}

/** Order situations like legacy `csits` (date, then number). */
export const sortSituations = <T extends Situation>(L: readonly T[]): T[] =>
  [...L].sort((a, b) => String(a.date).localeCompare(String(b.date)) || num(a.no) - num(b.no));

/** Legacy `sitCalc`: per BOQ line cumulative / previous / this situation, this situation's and cumulative value, % done. */
export function situationCalc(boq: readonly BoqLine[], all: readonly Situation[], s: Situation) {
  const prev = situationPrevious(sortSituations(all), s);
  let cur = 0, cum = 0;
  const L = boq.map((l, i) => {
    const c = num(s.cum?.[i]);
    const p = prev[i] ?? 0;
    const d = r4(c - p);
    cur += d * num(l.price);
    cum += c * num(l.price);
    return { ...l, i, c, p, d, amt: r2(d * num(l.price)), over: c > num(l.qty) * 1.0001 };
  });
  const v = boqValue(boq);
  return { L, cur: r2(cur), cum: r2(cum), pct: v ? r2((cum / v) * 100) : 0 };
}

/** Invoice lines of a situation (legacy `csInv` 10099): executed quantities of this situation at the BOQ prices (net). */
export function situationInvoiceLines(calc: ReturnType<typeof situationCalc>, cfg: ConsConfig): ModuleInvoiceLine[] {
  return calc.L.filter((l) => Math.abs(l.d) > 1e-9).map((l) => ({
    name: `Поз. ${l.pos ?? ''} ${l.desc}`.replace(/\s+/g, ' ').trim(), unit: l.unit || null, qty: l.d, price: num(l.price), rate: num(cfg.rate), account: cfg.revK || null,
  }));
}

/** Diary labour and machine cost (legacy `projCosts` lab / mach). */
export function diaryCost(d: { workers?: readonly { hrs?: number | string; rate?: number | string }[]; mach?: readonly { hrs?: number | string; rate?: number | string }[] }, cfg: ConsConfig) {
  const lab = r2((d.workers ?? []).reduce((s, w) => s + num(w.hrs) * (num(w.rate) || num(cfg.hr)), 0));
  const mach = r2((d.mach ?? []).reduce((s, x) => s + num(x.hrs) * num(x.rate), 0));
  return { lab, mach };
}

/** Paste from Excel (legacy `boqPaste`): tab-separated pos, desc, unit, qty, price; `1.234,50` style numbers. */
export function parseBoqPaste(text: string): BoqLine[] {
  const n = (v: string | undefined) => Number(String(v ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  return text.split(/\r?\n/).map((row) => row.split('\t')).filter((c) => c.length >= 4 && c[1]?.trim())
    .map((c) => ({ pos: c[0]!.trim(), desc: c[1]!.trim(), unit: (c[2] ?? '').trim(), qty: n(c[3]), price: n(c[4]) }));
}
