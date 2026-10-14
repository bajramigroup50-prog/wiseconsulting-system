/**
 * 🤖 WISE Робот — free-first keyword router. A question that one deterministic tool answers completely („салдо на
 * конто 1200“, „рокови оваа недела“, „провери ја фирмата“) is routed here to that tool WITHOUT the model (no AI cost).
 * Conservative on purpose: anything ambiguous returns null and goes to the agent (when AI is available).
 *
 * The router never decides the firm or the year — the caller passes the authenticated firm/year to the tool.
 */

export type RouteTool =
  | 'account_balance' | 'trial_balance' | 'cash_bank' | 'vat_summary' | 'payroll_summary' | 'stock_summary'
  | 'deadlines' | 'health_check' | 'law_search' | 'partner_card' | 'find_documents';

export interface RouteHit { tool: RouteTool; input: Record<string, unknown> }

/** Lower-case, collapse spaces, strip trailing punctuation. */
export const normQ = (q: string): string => String(q ?? '').toLowerCase().replace(/[„“"?!]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (s: string, re: RegExp) => re.test(s);

/** A konto code in the question (3–6 digits, not a year). */
function kontoIn(s: string): string | null {
  for (const m of s.matchAll(/(?<![\d.,])(\d{3,6})(?![\d.,])/g)) {
    const k = m[1]!;
    if (/^(19|20)\d\d$/.test(k) && k.length === 4 && !/конто|сметка/.test(s)) continue;
    return k;
  }
  return null;
}

/** „оваа недела“ / „7 дена“ / „овој месец“ → days ahead (default 14). */
function daysIn(s: string): number {
  const m = /(\d{1,3})\s*(дена|ден|days?)/.exec(s);
  if (m) return Math.max(1, Math.min(120, Number(m[1])));
  if (/недела|седмица/.test(s)) return 7;
  if (/месец/.test(s)) return 31;
  if (/денес/.test(s)) return 1;
  return 14;
}

/** A month `YYYY-MM` written as „03/2026“, „2026-03“ or a Macedonian month name (year = `year`). */
const MONTHS = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];
export function monthIn(s: string, year: number): string | null {
  let m = /(\d{4})-(0[1-9]|1[0-2])/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  m = /\b(0?[1-9]|1[0-2])[/.](\d{4})\b/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  const i = MONTHS.findIndex((p) => new RegExp(`(^|\\s)${p}`).test(s));
  return i >= 0 ? `${year}-${String(i + 1).padStart(2, '0')}` : null;
}

/** Text after a keyword („картица на Македонски Телеком“ → „македонски телеком“). */
const after = (s: string, re: RegExp): string => { const m = re.exec(s); return m ? s.slice(m.index + m[0].length).replace(/^(на|за|од)\s+/, '').trim() : ''; };

/**
 * Route a question to one deterministic tool, or null (→ agent). `year` = the working year (only used to read a
 * month name).
 */
export function routeQuestion(q0: string, year: number): RouteHit | null {
  const s = normQ(q0);
  if (!s || s.length > 160) return null;
  // questions that need reasoning / several sources go to the agent
  if (has(s, /зошто|објасни|анализ|спореди|предлож|што треба|како да|дали е|подготви|направи|книжи|состави/)) return null;

  if (has(s, /провери ја фирмата|провери фирма|контрола на фирмата|здравје на фирмата|проблеми во фирмата|грешки во книж/)) return { tool: 'health_check', input: {} };
  if (has(s, /(^|\s)рок(ови|от|овите)?(\s|$)|достасуваат обврски|deadline/) && !has(s, /плаќ.*фактур/)) return { tool: 'deadlines', input: { days: daysIn(s) } };
  if (has(s, /(^|\s)(чл\.?|член)\s*\d/)) return { tool: 'law_search', input: { q: q0.trim() } };
  if (has(s, /бруто биланс/)) {
    const k = kontoIn(s);
    return { tool: 'trial_balance', input: k ? { konto: k } : { level: '3' } };
  }
  if (has(s, /благајн|жиро сметк|банк(а|и|арск)|парични средства|готовина/) && has(s, /салдо|состојба|колку|пари|минус/)) return { tool: 'cash_bank', input: {} };
  if (has(s, /салдо|состојба|промет|картица/) && has(s, /конто|сметка/) ) {
    const k = kontoIn(s);
    if (k) return { tool: 'account_balance', input: { konto: k } };
  }
  if (has(s, /^салдо (на )?\d{3,6}$/)) return { tool: 'account_balance', input: { konto: kontoIn(s)! } };
  if (has(s, /^(ддв|ддв-04|ддв 04)( за)?( овој| тековен| последен)?( период| квартал| месец)?$/)) return { tool: 'vat_summary', input: {} };
  if (has(s, /^(плата|плати|пресметка на плата)( за .*)?$/)) {
    const m = monthIn(s, year);
    return { tool: 'payroll_summary', input: m ? { month: m } : {} };
  }
  if (has(s, /лагер|залиха|залихи|минус залих|негативн(а|и) залих/)) return { tool: 'stock_summary', input: {} };
  if (has(s, /^(иос|картица|аналитичка картица)\s+(на|за)\s+\S/)) {
    const p = after(s, /^(иос|картица|аналитичка картица)\s+/);
    if (p.length >= 2) return { tool: 'partner_card', input: { partner: p } };
  }
  if (has(s, /^(најди|барај|пребарај)\s+\S/)) {
    const t = after(s, /^(најди|барај|пребарај)\s+/).replace(/^(фактура|фактури|налог|налози|документ|документи)\s+/, '');
    if (t.length >= 2) return { tool: 'find_documents', input: { text: t } };
  }
  return null;
}

/** Suggested starter questions (Macedonian). The first ones are answered free by the router. */
export const ROBOT_STARTERS: readonly string[] = [
  'Провери ја фирмата',
  'Рокови оваа недела',
  'Салдо на конто 1200',
  'Состојба на благајна и жиро сметка',
  'ДДВ за овој период',
  'Лагер – вредност и минус залихи',
  'Кои купувачи доцнат со плаќање и треба опомена?',
  'Што вели законот за готовинско плаќање над 1.000 €?',
];
