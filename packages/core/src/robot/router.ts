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

/**
 * Lower-case, collapse spaces, strip trailing punctuation. Albanian „ë“ / „ç“ are folded to „e“ / „c“, so a question
 * typed with or without them routes the same.
 */
export const normQ = (q: string): string => String(q ?? '').toLowerCase().replace(/ë/g, 'e').replace(/ç/g, 'c').replace(/[„“"?!]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (s: string, re: RegExp) => re.test(s);

/** A konto code in the question (3–6 digits, not a year). */
function kontoIn(s: string): string | null {
  for (const m of s.matchAll(/(?<![\d.,])(\d{3,6})(?![\d.,])/g)) {
    const k = m[1]!;
    if (/^(19|20)\d\d$/.test(k) && k.length === 4 && !/конто|сметка|kont|llogari/.test(s)) continue;
    return k;
  }
  return null;
}

/** „оваа недела“ / „7 дена“ / „овој месец“ (Albanian „këtë javë“ / „7 ditë“ / „këtë muaj“) → days ahead (default 14). */
function daysIn(s: string): number {
  const m = /(\d{1,3})\s*(дена|ден|days?|dite|dit)/.exec(s);
  if (m) return Math.max(1, Math.min(120, Number(m[1])));
  if (/недела|седмица|(^|\s)jav(e|en|es)(\s|$)/.test(s)) return 7;
  if (/месец|(^|\s)muaj/.test(s)) return 31;
  if (/денес|(^|\s)sot(\s|$)/.test(s)) return 1;
  return 14;
}

/** A month `YYYY-MM` written as „03/2026“, „2026-03“ or a Macedonian / Albanian month name (year = `year`). */
const MONTHS = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const MONTHS_SQ = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nentor', 'dhjetor'];
export function monthIn(s: string, year: number): string | null {
  let m = /(\d{4})-(0[1-9]|1[0-2])/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  m = /\b(0?[1-9]|1[0-2])[/.](\d{4})\b/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  let i = MONTHS.findIndex((p) => new RegExp(`(^|\\s)${p}`).test(s));
  if (i < 0) i = MONTHS_SQ.findIndex((p) => new RegExp(`(^|\\s)${p}(i|in|it)?(\\s|$)`).test(s));
  return i >= 0 ? `${year}-${String(i + 1).padStart(2, '0')}` : null;
}

/* ---------------- Albanian ---------------- */

/** Albanian words of the office staff's questions (after `normQ`: ë → e, ç → c). */
const SQ_WORDS = /(^|\s)(afat\w*|kontrollo\w*|gabim\w*|saldo\w*|gjendj\w*|kontos|arka|arke\w*|xhirollogari\w*|bank(a|e|es|en|at|ave)|sa para|tvsh\w*|pag(a|at|ave)|rrog\w*|magazin\w*|stok\w*|kartel\w*|gjej\w*|kerko\w*|bruto bilanc\w*|neni\w*|pse|shpjego\w*|analizo\w*|krahaso\w*|pergatit\w*|bej\w*|kontoje|firm(en|es)|kompani\w*|per|kete|cfare|si|eshte|jane|kemi)(\s|$)/;

/** The question is in Albanian: Latin script (no Cyrillic) with „ë“ / „ç“ or an Albanian word. */
export function robotIsAlbanian(q: string): boolean {
  const raw = String(q ?? '');
  if (/[а-шѓќљњџѕјА-ШЃЌЉЊЏЅЈ]/.test(raw) || !/[a-z]/i.test(raw)) return false;
  return /[ëçËÇ]/.test(raw) || SQ_WORDS.test(normQ(raw));
}

/** Short Albanian heading per free tool (the tool output itself stays Macedonian). */
const SQ_HEAD: Record<RouteTool, string> = {
  deadlines: 'Afatet', health_check: 'Kontrolli i firmës', account_balance: 'Saldoja e kontos', cash_bank: 'Arka dhe xhirollogaria',
  vat_summary: 'TVSH', payroll_summary: 'Pagat', stock_summary: 'Magazina', partner_card: 'Kartela e partnerit',
  find_documents: 'Dokumentet e gjetura', trial_balance: 'Bruto bilanci', law_search: 'Ligji',
};
export const robotSqHeading = (tool: RouteTool | string): string =>
  `${SQ_HEAD[tool as RouteTool] ?? 'Përgjigje'} – përgjigje nga programi pa AI (teksti më poshtë është në maqedonisht):`;

/** Albanian questions that need reasoning go to the agent. */
const SQ_AGENT = /(^|\s)(pse|shpjego\w*|analiz\w*|krahas\w*|pergatit\w*|bej\w*|ben[ei]|kontoje|kontabilizo\w*|propozo\w*|sugjero\w*|si (te|ta|duhet)|cfare duhet|a eshte|a jane)(\s|$)/;

/** Text after an Albanian keyword without the leading article / preposition („kartela e Makpetrol“ → „makpetrol“). */
const afterSq = (s: string, re: RegExp): string => { const m = re.exec(s); return m ? s.slice(m.index + m[0].length).replace(/^(e|i|per|te|se|nga)\s+/, '').trim() : ''; };

function routeAlbanian(s: string, q0: string, year: number): RouteHit | null {
  if (has(s, /kontrollo (firm|kompani)\w*|(^|\s)gabim(et|e)?(\s|$)/)) return { tool: 'health_check', input: {} };
  if (has(s, /(^|\s)afat(i|et|in|eve)?(\s|$)/)) return { tool: 'deadlines', input: { days: daysIn(s) } };
  if (has(s, /(^|\s)nen(i|in|it)\s*\d/)) return { tool: 'law_search', input: { q: q0.trim().replace(/nen(i|in|it)\s*(\d)/gi, 'чл. $2') } };
  if (has(s, /bruto bilanc/)) {
    const k = kontoIn(s);
    return { tool: 'trial_balance', input: k ? { konto: k } : { level: '3' } };
  }
  if (has(s, /^(kartela analitike|kartelen|kartela|ios)\s+(e|i|per|te|se)\s+\S/)) {
    const p = afterSq(s, /^(kartela analitike|kartelen|kartela|ios)\s+/);
    if (p.length >= 2) return { tool: 'partner_card', input: { partner: p } };
  }
  if (has(s, /^(gjej|gjeje|kerko|kerkoj)\s+\S/)) {
    const t = afterSq(s, /^(gjej|gjeje|kerko|kerkoj)\s+/).replace(/^(faturen|faturat|fature|fatura|urdhrin|urdhrat|dokumentin|dokumentet|dokument)\s+/, '');
    if (t.length >= 2) return { tool: 'find_documents', input: { text: t } };
  }
  if (has(s, /(^|\s)(arka|arke|arkes|arken|xhirollogari\w*|banka|banke|bankes|banken|bankat|bankave)(\s|$)|sa para (kemi|ka|jane)|para (ne|te) gatshme/)) return { tool: 'cash_bank', input: {} };
  if (has(s, /(^|\s)(saldo|saldoja|saldon|gjendja)(\s|$)/)) {
    const k = kontoIn(s);
    if (k && (has(s, /kont|llogari/) || has(s, /^(saldo|saldoja|saldon)( e)? \d{3,6}$/))) return { tool: 'account_balance', input: { konto: k } };
  }
  if (has(s, /^tvsh(-?04| 04)?( per| e)?( kete| ket| kesaj| te kesaj| aktuale)?( periudhe| periudha| periudhen| muaj| muajin| tremujor| tremujori| tremujorin)?$/)) return { tool: 'vat_summary', input: {} };
  if (has(s, /^(paga|pagat|pagave|rroga|rrogat|llogaritja e pagave)( (per|e|te) .*)?$/)) {
    const m = monthIn(s, year);
    return { tool: 'payroll_summary', input: m ? { month: m } : {} };
  }
  if (has(s, /magazin|(^|\s)stok(u|ut|un)?(\s|$)/)) return { tool: 'stock_summary', input: {} };
  return null;
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
  // Albanian (Latin script, no Cyrillic): its own keywords, same tools
  if (!/[а-шѓќљњџѕј]/.test(s) && /[a-z]/.test(s)) {
    if (has(s, SQ_AGENT)) return null;
    const sq = routeAlbanian(s, q0, year);
    if (sq) return sq;
  }

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
