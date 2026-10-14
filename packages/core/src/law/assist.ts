/**
 * ⚖ Правен асистент (AI) — pure parts: the case kinds, the prompt (articles from the store + the firm's summary
 * facts), parsing the model's JSON answer and the NO-INVENTED-ARTICLE guard: every citation must name an article that
 * exists in the store and its quote must come from that article's stored text (otherwise the stored text replaces it,
 * or the citation moves to „треба да се провери“). Plus the free (no AI) comparison tables.
 */
import { articleParas, lawAbbr, lawSearchNorm, type DiffSeg } from './texts';

export type LawCaseKind = 'ask' | 'law' | 'ver' | 'treat';
export const LAW_CASE_KIND: Record<LawCaseKind, string> = {
  ask: '❓ Правно прашање',
  law: '⚖ Закон наспроти закон',
  ver: '🕓 Верзија наспроти верзија',
  treat: '📒 Нашиот третман наспроти законот',
};

/** One stored article given to the model (and shown to the user). */
export interface CtxArticle {
  /** `law_articles.id` */
  id: string;
  law: string;
  no: string;
  heading: string | null;
  body: string;
  /** Version date of the consolidated text and its source. */
  asOf: string | null;
  effectiveFrom?: string | null;
  sourceUrl: string | null;
}

/** Summary facts of the firm for the period (no individual personal data). */
export interface LawFacts {
  firm: { name: string; edb?: string | null; vat: boolean; vatPeriod?: string | null };
  period: { from: string; to: string };
  sales?: { count: number; base: number; vat: number; byRate: Record<string, number>; advances: { count: number; base: number; vat: number } };
  purchases?: { count: number; base: number; vat: number; cash: { count: number; total: number }; art32: number; noDed: number; imp: number };
  payroll?: { months: number; gross: number; net: number; contr: number; tax: number; emps: number };
  cashOut?: { count: number; total: number; over: number };
  /** Preliminary tax review findings (lawrep rules with their article). */
  review?: { law: string; art: string; t: string; s: string; txt: string }[];
  /** Largest documents of the period (number, date, total). */
  docs?: { kind: string; no: string; date: string; total: number }[];
}

export interface LawChangeCtx { title: string; what: string | null; from: string | null; to: string | null; date: string | null; urls: readonly string[] }

export interface LawCite { law: string; art: string; para?: string | null; quote?: string | null }
export interface LawTable { cols: string[]; rows: string[][] }
export interface LawAnswer {
  lang: 'mk' | 'sq';
  short: string;
  reasoning: { text: string; cites: LawCite[] }[];
  exceptions: string[];
  evidence: string[];
  verify: string[];
  table: LawTable | null;
  conclusion: string;
}

/** Question in Albanian (Latin letters, ë / ç or common words) → answer in Albanian. */
export function lawLang(q: string): 'mk' | 'sq' {
  const cyr = (q.match(/[Ѐ-ӿ]/g) ?? []).length, lat = (q.match(/[a-zëç]/gi) ?? []).length;
  return lat > cyr && /[ëç]|\b(dhe|nuk|duhet|firma|tatim|neni|ligj)/i.test(q) ? 'sq' : lat > cyr * 2 ? 'sq' : 'mk';
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Facts → short text lines (the prompt and the memo use the same lines). */
export function factLines(F: LawFacts): string[] {
  const L: string[] = [`Фирма: ${F.firm.name}${F.firm.edb ? ' (ЕДБ ' + F.firm.edb + ')' : ''}; ${F.firm.vat ? 'ДДВ обврзник' + (F.firm.vatPeriod ? ` (${F.firm.vatPeriod === 'month' ? 'месечно' : 'квартално'})` : '') : 'не е ДДВ обврзник'}`, `Период: ${F.period.from} – ${F.period.to}`];
  if (F.sales) L.push(`Излезни фактури: ${F.sales.count}, основа ${fmt(F.sales.base)}, ДДВ ${fmt(F.sales.vat)}; основа по стапка: ${Object.entries(F.sales.byRate).map(([r, v]) => `${r}% = ${fmt(v)}`).join(', ') || '—'}; аванси: ${F.sales.advances.count} (основа ${fmt(F.sales.advances.base)}, ДДВ ${fmt(F.sales.advances.vat)})`);
  if (F.purchases) L.push(`Влезни фактури: ${F.purchases.count}, основа ${fmt(F.purchases.base)}, ДДВ ${fmt(F.purchases.vat)}; платени во готово: ${F.purchases.cash.count} (${fmt(F.purchases.cash.total)}); чл. 32-а: ${F.purchases.art32}; без право на одбивка: ${F.purchases.noDed}; увоз: ${F.purchases.imp}`);
  if (F.payroll) L.push(`Плати: ${F.payroll.months} месеци, бруто ${fmt(F.payroll.gross)}, нето ${fmt(F.payroll.net)}, придонеси ${fmt(F.payroll.contr)}, данок ${fmt(F.payroll.tax)}, вработени (макс.) ${F.payroll.emps}`);
  if (F.cashOut) L.push(`Готовински исплати од благајна: ${F.cashOut.count} (${fmt(F.cashOut.total)}); над лимитот: ${F.cashOut.over}`);
  if (F.docs?.length) L.push('Најголеми документи: ' + F.docs.map((d) => `${d.kind} ${d.no} од ${d.date} = ${fmt(d.total)}`).join('; '));
  if (F.review?.length) L.push('Даночен преглед (автоматски правила):\n' + F.review.map((r) => `- [${r.s}] ${lawAbbr(r.law)} ${r.art} – ${r.t}: ${r.txt}`).join('\n'));
  return L;
}

const artLabel = (a: Pick<CtxArticle, 'law' | 'no'>) => `${lawAbbr(a.law)} чл. ${a.no}`;
export const citeLabel = (c: LawCite) => `${lawAbbr(c.law)} чл. ${c.art}${c.para ? ` ст. ${c.para}` : ''}`;

export interface LawPromptIn {
  kind: LawCaseKind;
  question: string;
  today: string;
  articles: readonly CtxArticle[];
  facts?: LawFacts | null;
  changes?: readonly LawChangeCtx[];
  /** law ↔ law: the two laws compared; ver: the diff text. */
  laws?: readonly string[];
  extra?: string;
  maxArticleChars?: number;
}

/** The prompt. The model may cite ONLY the articles listed under ЧЛЕНОВИ (by their key). */
export function lawAssistPrompt(p: LawPromptIn): string {
  const lang = lawLang(p.question);
  const max = p.maxArticleChars ?? 2500;
  const arts = p.articles.map((a) => `### [${a.law}|${a.no}] ${artLabel(a)}${a.heading ? ' – ' + a.heading : ''} (верзија ${a.asOf ?? 'непознат датум'}${a.effectiveFrom ? ', важи од ' + a.effectiveFrom : ''}${a.sourceUrl ? ', извор ' + a.sourceUrl : ''})\n${cut(a.body, max)}`).join('\n\n');
  const task: Record<LawCaseKind, string> = {
    ask: 'Одговори на правното прашање.',
    law: `СПОРЕДИ ги прописите ${(p.laws ?? []).map(lawAbbr).join(' и ')} за темата од прашањето: во "table" стави колони ["Аспект", ${(p.laws ?? []).map((l) => `"${lawAbbr(l)}"`).join(', ')}, "Разлика"], по еден ред за секој аспект (рок, обврска, исклучок, казна…), со цитат на членот во секоја ќелија.`,
    ver: 'Објасни ја разликата меѓу двете верзии на членот (измената е дадена подолу), од кога важи секоја и која верзија се применува за наведениот датум/период. "table": ["Аспект","Претходна верзија","Нова верзија"].',
    treat: 'СПОРЕДИ како фирмата/канцеларијата го евидентирала прометот (ФАКТИ) со правилото во членовите. "table": ["Ставка","Правило (член)","Нашиот третман","Отстапување"], по еден ред за секое отстапување или проверена ставка; ако нема отстапување напиши „нема“.',
  };
  return `Ти си правен асистент на сметководствена канцеларија во Северна Македонија. Денес е ${p.today}. ${task[p.kind]}
ЈАЗИК НА ОДГОВОРОТ: ${lang === 'sq' ? 'албански (shqip)' : 'македонски'}.

СТРОГИ ПРАВИЛА:
1. Цитирај САМО членови од делот ЧЛЕНОВИ подолу, со клучот од заградата: {"law":"<клуч>","art":"<број>","para":"<став или null>","quote":"<буквален извадок од тој член>"}. Цитатот мора да е БУКВАЛНО копиран од текстот на членот.
2. НИКОГАШ не измислувај членови, ставови, рокови, стапки или броеви на Службен весник. Ако потребниот текст го нема во ЧЛЕНОВИ, напиши го во "verify" како „треба да се провери: …“.
3. Користи ги фактите на фирмата само како збирни податоци; не заклучувај повеќе од она што го покажуваат.
4. Ако одговорот зависи од датум, наведи која верзија на членот важи за тој датум.

Одговори САМО со JSON:
{"short":"краток одговор (1–3 реченици)","reasoning":[{"text":"правно образложение","cites":[{"law":"","art":"","para":null,"quote":""}]}],"exceptions":["исклучоци"],"evidence":["документи/докази што се потребни"],"verify":["треба да се провери: …"],"table":{"cols":[],"rows":[[]]} или null,"conclusion":"заклучок"}

ПРАШАЊЕ: ${p.question}
${p.extra ? '\n' + p.extra + '\n' : ''}${p.facts ? '\nФАКТИ ОД КНИГИТЕ (збирно):\n' + factLines(p.facts).join('\n') + '\n' : ''}${p.changes?.length ? '\nЗАКОНСКИ ПРОМЕНИ (од роботот):\n' + p.changes.map((c, i) => `[П${i + 1}] ${c.date ?? ''} ${c.title}${c.what ? ' – ' + c.what : ''}${c.from ? ' · важи од ' + c.from : ''}${c.to ? ' до ' + c.to : ''}`).join('\n') + '\n' : ''}
ЧЛЕНОВИ (од базата на синхронизирани закони):
${arts || '(нема пронајдени членови – сè оди во "verify")'}`;
}

/** Extract the JSON object from the model's text (code fences / text around it tolerated). */
export function parseJsonLoose(text: string): unknown {
  const s = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

const strs = (v: unknown, n = 20): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n) : []);

/** Model JSON → `LawAnswer` shape (no validation of citations yet). A non-JSON reply becomes the short answer. */
export function lawAnswerShape(raw: unknown, text: string, lang: 'mk' | 'sq'): LawAnswer {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reasoning = Array.isArray(o.reasoning) ? (o.reasoning as unknown[]).map((r) => {
    const x = (r && typeof r === 'object' ? r : { text: String(r ?? '') }) as Record<string, unknown>;
    const cites = Array.isArray(x.cites) ? (x.cites as Record<string, unknown>[]).filter((c) => c && typeof c === 'object').map((c) => ({
      law: String(c.law ?? '').trim(), art: String(c.art ?? '').trim(), para: c.para == null || c.para === '' ? null : String(c.para).trim(), quote: c.quote == null ? null : String(c.quote),
    })) : [];
    return { text: String(x.text ?? '').trim(), cites };
  }).filter((r) => r.text || r.cites.length) : [];
  const t = o.table as { cols?: unknown; rows?: unknown } | null | undefined;
  const table = t && Array.isArray(t.cols) && Array.isArray(t.rows) && t.cols.length
    ? { cols: t.cols.map(String), rows: (t.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? ''))) } : null;
  return {
    lang, short: String(o.short ?? '').trim() || (raw ? '' : text.trim().slice(0, 4000)), reasoning, exceptions: strs(o.exceptions), evidence: strs(o.evidence),
    verify: strs(o.verify), table, conclusion: String(o.conclusion ?? '').trim(),
  };
}

export interface GuardResult {
  answer: LawAnswer;
  /** Citations of articles that are not in the store (moved to `verify`). */
  removed: string[];
  /** Quotes that were not in the stored text (replaced with the stored paragraph). */
  fixed: string[];
  /** Article numbers mentioned in the text that are not in the store. */
  stray: string[];
}

const nq = (s: string) => lawSearchNorm(s);

/**
 * The no-invented-article guard. `known(law, art)` returns the stored article (any version) or null.
 * - unknown article → citation removed, „треба да се провери: …“ added;
 * - quote not found in the stored text → replaced by the stored paragraph (or the article's beginning);
 * - an unknown law key → removed;
 * - „чл. N“ mentioned in the free text without a stored article of that number in any cited law → listed in `verify`.
 */
export function guardCitations(A: LawAnswer, known: (law: string, art: string) => CtxArticle | null): GuardResult {
  const removed: string[] = [], fixed: string[] = [], stray: string[] = [];
  const verify = [...A.verify];
  const tv = A.lang === 'sq' ? 'duhet të verifikohet' : 'треба да се провери';
  const reasoning = A.reasoning.map((r) => {
    const cites: LawCite[] = [];
    for (const c of r.cites) {
      const art = known(c.law, c.art);
      if (!art) { removed.push(citeLabel(c)); verify.push(`${tv}: ${citeLabel(c)} – членот го нема во базата на синхронизирани закони.`); continue; }
      const paras = articleParas(art.body);
      const para = c.para ? paras.find((p) => p.no === String(c.para)) ?? null : null;
      const hay = nq(para ? para.text : art.body);
      const q = (c.quote ?? '').trim();
      let quote = q;
      if (!q || !hay.includes(nq(q)) || nq(q).length < 8) {
        quote = cut((para ?? paras[0]!).text, 600);
        if (q) fixed.push(citeLabel(c));
      }
      cites.push({ law: art.law, art: art.no, para: para ? para.no : null, quote });
    }
    return { text: r.text, cites };
  });
  // article numbers in the prose: „чл. 53“ must exist in one of the cited / given laws
  const laws = new Set(reasoning.flatMap((r) => r.cites.map((c) => c.law)));
  const prose = [A.short, A.conclusion, ...reasoning.map((r) => r.text), ...A.exceptions].join('\n');
  for (const m of prose.matchAll(/(?:чл(?:ен)?\.?|neni)\s*(\d{1,4}(?:-[а-шa-z])?)/gi)) {
    const no = m[1]!.toLowerCase();
    if ([...laws].some((l) => known(l, no))) continue;
    if (!laws.size && known('*', no)) continue;
    if (!stray.includes(no)) stray.push(no);
  }
  for (const s of stray) verify.push(`${tv}: чл. ${s} спомнат во образложението не е потврден во базата.`);
  return { answer: { ...A, reasoning, verify: [...new Set(verify)] }, removed, fixed, stray };
}

/* ---------------- free comparisons (no AI) ---------------- */

/** Law ↔ law: the best matching articles of each law side by side (by search rank). */
export function lawVsLawTable(a: { law: string; arts: readonly CtxArticle[] }, b: { law: string; arts: readonly CtxArticle[] }, n = 6): LawTable {
  const rows: string[][] = [];
  for (let i = 0; i < Math.min(n, Math.max(a.arts.length, b.arts.length)); i++) {
    const x = a.arts[i], y = b.arts[i];
    rows.push([x ? `чл. ${x.no}${x.heading ? ' – ' + x.heading : ''}\n${cut(x.body, 700)}` : '—', y ? `чл. ${y.no}${y.heading ? ' – ' + y.heading : ''}\n${cut(y.body, 700)}` : '—']);
  }
  return { cols: [lawAbbr(a.law), lawAbbr(b.law)], rows };
}

/** Version ↔ version: rows of the changed parts (deleted text | added text). */
export function diffTable(D: readonly DiffSeg[]): LawTable {
  const rows: string[][] = [];
  let del = '', add = '';
  const flush = () => { if (del.trim() || add.trim()) rows.push([del.trim() || '—', add.trim() || '—']); del = ''; add = ''; };
  for (const d of D) {
    if (d.t === 'eq') { if (d.s.trim()) flush(); continue; }
    if (d.t === 'del') del += d.s; else add += d.s;
  }
  flush();
  return { cols: ['Претходна верзија (избришано)', 'Нова верзија (додадено)'], rows };
}

const ST: Record<string, string> = { bad: '⛔ отстапување', warn: '⚠ да се провери', ok: '✓ во ред', info: 'ℹ информација' };

/** Our treatment ↔ the law (free): the tax-review rules' results for the firm and the period facts. */
export function treatmentTable(F: LawFacts): LawTable {
  const rows: string[][] = (F.review ?? []).map((r) => [r.t, `${lawAbbr(r.law)} ${r.art}`, r.txt, ST[r.s] ?? r.s]);
  if (F.sales) {
    const rates = Object.keys(F.sales.byRate);
    const bad = rates.filter((r) => !['18', '10', '5', '0'].includes(r));
    rows.push(['ДДВ стапки на излезни фактури', 'ЗДДВ (стапки 18 / 10 / 5 / 0 %)', rates.map((r) => `${r}%`).join(', ') || 'нема промет', bad.length ? `⛔ непозната стапка ${bad.join(', ')}%` : '✓ во ред']);
    if (F.sales.advances.count) rows.push(['ДДВ на примени аванси', 'ЗДДВ (настанување на обврска при наплата на аванс)', `${F.sales.advances.count} авансни фактури, ДДВ ${fmt(F.sales.advances.vat)}`, F.sales.advances.vat > 0 || !F.firm.vat ? '✓ пресметан' : '⚠ аванс без ДДВ']);
    if (!F.firm.vat && F.sales.vat > 0) rows.push(['ДДВ искажан од фирма што не е обврзник', 'ЗДДВ', `ДДВ ${fmt(F.sales.vat)}`, '⛔ отстапување']);
  }
  if (F.purchases?.cash.count) rows.push(['Плаќања во готово (влезни фактури)', 'ЗРГП / Закон за платежни услуги', `${F.purchases.cash.count} фактури, ${fmt(F.purchases.cash.total)}`, '⚠ да се провери лимитот']);
  if (F.cashOut?.over) rows.push(['Готовински исплати над лимитот', 'Закон за платежни услуги (благајнички максимум)', `${F.cashOut.over} од ${F.cashOut.count}`, '⛔ отстапување']);
  return { cols: ['Ставка', 'Правило (член)', 'Нашиот третман', 'Отстапување'], rows };
}
