/**
 * „🗂 Целосен извештај за фирма“ (office OWNER only) — the pure part: the report's shape, the section statuses
 * (✓ во ред / ⚠ внимание / ✗ проблем), the free deterministic conclusion, the HTML (screen, print / server PDF and
 * Word), and the optional „💲 AI анализа“ (payload without names / ЕДБ / personal data, the prompt, and the check that
 * tags every article the model cites outside the given context „[треба да се провери]“).
 *
 * Every number comes from the books through the existing domain functions (`@wise/db` `computeFirmReport`); nothing
 * here computes an amount — it only orders, labels and renders what it is given.
 */
import { lawRefsOf, refKey, tagUnverified, VERIFY_TAG } from '../compliance/kontrola-docs';
import { dmy, fmtMk } from './dates';

/* ====================================================================================================== */
/* shape                                                                                                  */
/* ====================================================================================================== */

export type FrSev = 'bad' | 'warn' | 'info';
export type FrStatus = 'ok' | 'warn' | 'bad' | 'na';
export interface FrLink { label: string; href: string }
/** A stored law article (`law_articles`, the version valid on the report date). */
export interface FrLawText { ref: string; heading: string | null; body: string; asOf: string | null; sourceUrl: string | null }
export interface FrFinding {
  sev: FrSev;
  /** Which control found it (`FR_SRC`). */
  src: string;
  area: string;
  txt: string;
  /** Law and article, as the rule provides it. */
  law?: string | null;
  /** View that fixes it (`/ddv`, `/vlez?q=…`). */
  go?: string | null;
  lawText?: FrLawText[];
}

export const FR_SECTIONS = [
  ['osnovni', 'Основни податоци'],
  ['prihodi', 'Приходи и расходи'],
  ['finansii', 'Финансиска состојба'],
  ['ddv', 'ДДВ'],
  ['plati', 'Плати и МПИН'],
  ['zalihi', 'Залихи и основни средства'],
  ['rokovi', 'Рокови'],
  ['zakon', 'Законска усогласеност и контроли'],
  ['dokumenti', 'Документи и активност'],
  ['ai', 'AI трошок'],
] as const;
export type FrKey = (typeof FR_SECTIONS)[number][0];

export interface FrSection<T = unknown> {
  key: FrKey;
  status: FrStatus;
  /** Short line next to the badge. */
  note?: string;
  issues: FrFinding[];
  links: FrLink[];
  data: T | null;
  /** The section could not be computed (the others still are). */
  error?: string;
}

export const FR_SRC: Readonly<Record<string, string>> = {
  lawrep: 'Даночен преглед според законите', cmp: 'Законска усогласеност', autop: 'Автопилот', books: 'Проверка на книгите',
  aml: 'Перење пари (УФР)', kontroli: 'Контроли и решенија', yearend: 'Контрола на завршна сметка', errors: 'Грешки во програмата',
  ddv: 'ДДВ', plati: 'Плати', rokovi: 'Рокови', zalihi: 'Залихи', finansii: 'Финансии', osnovni: 'Податоци', dokumenti: 'Документи', prihodi: 'Резултат',
};

/* ---------------- section data ---------------- */

export interface FrBasic {
  name: string; edb: string | null; embs: string | null; address: string | null; city: string | null; legalForm: string | null; legalFormName: string;
  vat: 'month' | 'quarter' | 'none'; activity: string | null; active: boolean; phone: string | null; email: string | null;
  responsible: string | null; assigned: string[];
  contract: { number: string; date: string; start: string | null; end: string | null; status: string; fee: number; feeMode: string; feeNet: number; feeGross: number } | null;
  fees: { unpaid: number; unpaidTotal: number } | null;
  dossier: { category: string; title: string | null; validTo: string | null; days: number | null; lvl: 'bad' | 'warn' | 'good' | 'info' | null }[];
  dossierCount: number;
}
export interface FrMonth { m: string; rev: number; exp: number; res: number; cumRev: number; cumExp: number; cumRes: number; prevRev: number; prevExp: number; prevRes: number }
export interface FrIncome {
  months: FrMonth[];
  tot: { rev: number; exp: number; res: number };
  prev: { rev: number; exp: number; res: number };
  chg: { rev: number | null; exp: number | null; res: number | null };
  topCustomers: { name: string; v: number }[];
  topSuppliers: { name: string; v: number }[];
}
export interface FrBucket { label: string; v: number; n: number }
export interface FrOpen { total: number; overdue: number; buckets: FrBucket[]; top: { name: string; v: number; n: number; overdue: number }[] }
export interface FrFinance {
  asOf: string; bank: number; cash: number; accounts: { konto: string; name: string; saldo: number }[];
  cashNeg: { firstNeg: string | null; minB: number; minD: string | null; negDays: number };
  recv: FrOpen; pay: FrOpen;
  loans: { rows: { dir: string; partner: string; amount: number; bal: number; over: boolean; noSig: boolean; date: string }[]; given: number; received: number; unlinked: number };
}
export interface FrVatPeriod {
  period: string; from: string; to: string; due: string; outV: number; inV: number; net: number;
  out: { rate: number; base: number; vat: number }[]; in: { rate: number; base: number; vat: number }[];
  closed: boolean; filed: boolean; ledgerNet: number; match: boolean; diff: number; late: boolean;
}
export interface FrVat { registered: boolean; kind: 'month' | 'quarter' | null; periods: FrVatPeriod[] }
export interface FrPayMonth { month: string; status: string | null; locked: boolean; gross: number; net: number; contr: number; tax: number; emps: number; mpin: { no: string | null; status: string | null; accepted: boolean } | null; due: string; late: boolean }
export interface FrPayroll { months: FrPayMonth[]; employees: number; gross: number; net: number; contr: number; tax: number }
export interface FrStock {
  stock: { date: string; items: number; value: number; negative: { code: string; name: string; qty: number }[] };
  assets: { count: number; active: number; cost: number; depYear: number; depRun: boolean; runTotal: number };
}
export interface FrDl { date: string; what: string; law?: string | null; href: string; done: boolean; auto: boolean; overdue: boolean; verified?: boolean }
export interface FrDeadlines { from: string; to: string; upcoming: FrDl[]; overdue: FrDl[]; done: FrDl[] }
export interface FrLegal {
  findings: FrFinding[];
  counts: Record<string, { bad: number; warn: number }>;
  lawrep: { bad: number; warn: number; exp: number } | null;
  kontroli: { auth: string; doc: string; docNo: string | null; status: string; due: string | null; state: string | null; remedy: string | null; law: string | null }[];
  aml: { level: string | null; lastReview: string | null; nextReview: string | null; reports: number } | null;
  yearend: { open: number; all: number } | null;
  failed: string[];
}
export interface FrDocs {
  months: { m: string; inv: number; pur: number; jour: number; stmt: number }[];
  inbox: { open: number; oldest: string | null };
  pendingClient: number;
  workers: { name: string; role: string; n: number; first: string; last: string }[];
}
export interface FrAiCost { months: { m: string; usd: number; calls: number }[]; total: number; calls: number; byPurpose: { purpose: string; usd: number; calls: number }[] }

export interface FirmReport {
  firm: { id: string; name: string };
  year: number;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  today: string;
  generatedAt: string;
  sections: {
    osnovni: FrSection<FrBasic>; prihodi: FrSection<FrIncome>; finansii: FrSection<FrFinance>; ddv: FrSection<FrVat>; plati: FrSection<FrPayroll>;
    zalihi: FrSection<FrStock>; rokovi: FrSection<FrDeadlines>; zakon: FrSection<FrLegal>; dokumenti: FrSection<FrDocs>; ai: FrSection<FrAiCost>;
  };
}

/* ====================================================================================================== */
/* statuses and the conclusion                                                                            */
/* ====================================================================================================== */

export const FR_BADGE: Readonly<Record<FrStatus, [string, string]>> = {
  ok: ['✓ во ред', 'good'], warn: ['⚠ внимание', 'warn'], bad: ['✗ проблем', 'bad'], na: ['— нема податоци', 'info'],
};
const SEV_ORD: Readonly<Record<FrSev, number>> = { bad: 0, warn: 1, info: 2 };

/** Section status from its findings: any problem → ✗, any warning → ⚠, otherwise ✓ (`empty` → „нема податоци“). */
export function frStatus(issues: readonly Pick<FrFinding, 'sev'>[], empty = false): FrStatus {
  if (issues.some((i) => i.sev === 'bad')) return 'bad';
  if (issues.some((i) => i.sev === 'warn')) return 'warn';
  return empty ? 'na' : 'ok';
}

/** Change in % (1 decimal), null without a base (the dashboard's `pct`). */
export const frPct = (a: number, b: number): number | null => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

export interface FrConclusionItem { sev: FrSev; section: FrKey; area: string; txt: string; law?: string | null; go?: string | null }

/**
 * The free conclusion: every problem of every section ordered by severity (✗ before ⚠ before ℹ), the same text once,
 * each with the screen that fixes it. Sections that failed are listed as „не е пресметано“ problems too.
 */
export function frConclusion(R: Pick<FirmReport, 'sections'>): { items: FrConclusionItem[]; bad: number; warn: number; info: number; failed: string[] } {
  const items: FrConclusionItem[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const [key, title] of FR_SECTIONS) {
    const s = R.sections[key] as FrSection | undefined;
    if (!s) continue;
    if (s.error) failed.push(`${title}: ${s.error}`);
    for (const i of s.issues) {
      const k = `${i.sev}|${i.txt}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ sev: i.sev, section: key, area: i.area, txt: i.txt, law: i.law ?? null, go: i.go ?? s.links[0]?.href ?? null });
    }
  }
  const ord = (k: FrKey) => FR_SECTIONS.findIndex(([x]) => x === k);
  items.sort((a, b) => SEV_ORD[a.sev] - SEV_ORD[b.sev] || ord(a.section) - ord(b.section));
  return { items, bad: items.filter((i) => i.sev === 'bad').length, warn: items.filter((i) => i.sev === 'warn').length, info: items.filter((i) => i.sev === 'info').length, failed };
}

/** The overall status: the worst section. */
export function frOverall(R: Pick<FirmReport, 'sections'>): FrStatus {
  const S = FR_SECTIONS.map(([k]) => (R.sections[k] as FrSection | undefined)?.status ?? 'na');
  return S.includes('bad') ? 'bad' : S.includes('warn') ? 'warn' : S.every((s) => s === 'na') ? 'na' : 'ok';
}

/* ====================================================================================================== */
/* HTML (screen / print + server PDF / Word)                                                              */
/* ====================================================================================================== */

export type FrMode = 'screen' | 'print' | 'word';
export interface FrAiView { status: 'queued' | 'done' | 'error'; text?: string | null; error?: string | null; model?: string | null; at?: string | null; unverified?: string[]; costUsd?: number | null }
export interface FrHtmlOpts {
  mode: FrMode;
  /** Menu label of a view id (`NAV_LBL`) for the „поправи во …“ links. */
  label?: (view: string) => string | undefined;
  ai?: FrAiView | null;
  by?: string | null;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const den = (n: number) => fmtMk(n);
const MON = ['Јануари', 'Февруари', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
export const frMonthName = (m: string) => `${MON[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const pctTxt = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${String(p).replace('.', ',')}%`);
const SEV_MARK: Readonly<Record<FrSev, [string, string]>> = { bad: ['✗', 'bad'], warn: ['⚠', 'warn'], info: ['ℹ', 'info'] };

/** View id of a link (`/ddv?p=…` → `ddv`). */
const viewOf = (href: string) => href.replace(/^\//, '').split(/[?#/]/)[0] ?? '';

export function firmReportHtml(R: FirmReport, o: FrHtmlOpts): string {
  const W = o.mode === 'word', P = o.mode === 'print', S = o.mode === 'screen';
  const lbl = (href: string) => o.label?.(viewOf(href)) ?? viewOf(href);
  const link = (href: string | null | undefined, text?: string) => (!href || !S ? '' : ` <a class="btn sm" data-go="1" href="${esc(href)}">${esc(text ?? `→ ${lbl(href)}`)}</a>`);
  const badge = (s: FrStatus) => (W ? `[${FR_BADGE[s][0]}]` : `<span class="pill ${FR_BADGE[s][1]}">${FR_BADGE[s][0]}</span>`);
  const sevB = (s: FrSev) => (W ? SEV_MARK[s][0] : `<span class="pill ${SEV_MARK[s][1]}">${SEV_MARK[s][0]}</span>`);
  /** A table; in Word every row is one paragraph with the cells separated by „ | “ (htmlDocx keeps paragraphs only). */
  const tbl = (head: readonly string[], rows: readonly (readonly (string | number)[])[], num: readonly number[] = [], foot?: readonly (string | number)[]) => {
    if (!rows.length) return W ? '<p>—</p>' : '<p class="mini">—</p>';
    const cell = (v: string | number, i: number) => (typeof v === 'number' ? den(v) : v) + (W && i < head.length - 1 ? ' | ' : '');
    if (W) return `<p><b>${head.map((h, i) => esc(h) + (i < head.length - 1 ? ' | ' : '')).join('')}</b></p>${rows.map((r) => `<p>${r.map((v, i) => cell(typeof v === 'number' ? v : v, i)).join('')}</p>`).join('')}${foot ? `<p><b>${foot.map((v, i) => cell(v, i)).join('')}</b></p>` : ''}`;
    const td = (v: string | number, i: number, tag = 'td') => `<${tag}${num.includes(i) ? ' class="n"' : ''}>${typeof v === 'number' ? den(v) : v}</${tag}>`;
    return `<div class="tw"><table class="dense"><thead><tr>${head.map((h, i) => `<th${num.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => td(v, i)).join('')}</tr>`).join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => td(v, i, 'th')).join('')}</tr></tfoot>` : ''}</table></div>`;
  };
  const kv = (rows: readonly (readonly [string, string])[]) => (W ? rows.map(([k, v]) => `<p><b>${esc(k)}:</b> ${v}</p>`).join('')
    : `<div class="tw"><table class="dense"><tbody>${rows.map(([k, v]) => `<tr><th style="text-align:left;width:34%">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`);
  const h3 = (t: string) => (W ? `<p><b>${esc(t)}</b></p>` : `<h3 style="margin:10px 0 4px;font-size:13px">${esc(t)}</h3>`);
  const p = (t: string) => `<p class="mini" style="margin:4px 0">${t}</p>`;
  const lawBlock = (L: readonly FrLawText[] | undefined) => {
    if (!L?.length || W || P) return '';
    return L.map((a) => `<details class="frlaw" style="margin:2px 0 4px 18px"><summary class="mini">📖 Текст на ${esc(a.ref)}${a.asOf ? ` (верзија ${dmy(a.asOf)})` : ''}</summary><div class="mini" style="white-space:pre-wrap;border-left:3px solid #d0d5dd;padding:4px 8px;max-height:320px;overflow:auto">${a.heading ? `<b>${esc(a.heading)}</b>\n` : ''}${esc(a.body)}</div></details>`).join('');
  };
  const findings = (F: readonly FrFinding[]) => (F.length
    ? (W ? F.map((f) => `<p>${sevB(f.sev)} ${esc(f.area)}: ${esc(f.txt)}${f.law ? ` [${esc(f.law)}]` : ''}</p>`).join('')
      : `<ul class="frf" style="margin:4px 0;padding-left:18px">${F.map((f) => `<li style="margin:3px 0">${sevB(f.sev)} <b>${esc(f.area)}</b>: ${esc(f.txt)}${f.law ? ` <span class="mini" style="color:#475467">— <i>${esc(f.law)}</i></span>` : ''}${link(f.go)}${lawBlock(f.lawText)}</li>`).join('')}</ul>`)
    : p('Нема пронајдени проблеми.'));

  const sec = (n: number, key: FrKey, body: (d: never) => string) => {
    const s = R.sections[key] as FrSection;
    const title = FR_SECTIONS.find(([k]) => k === key)![1];
    const inner = s.error
      ? (W ? `<p>Не е пресметано: ${esc(s.error)}</p>` : `<div class="callout bad">Овој дел не е пресметан: ${esc(s.error)}</div>`)
      : `${s.data != null ? body(s.data as never) : ''}${s.issues.length ? h3('Наоди') + findings(s.issues) : ''}${S && s.links.length ? `<p class="noprint" style="margin:6px 0 0">${s.links.map((l) => link(l.href, `→ ${l.label}`)).join(' ')}</p>` : ''}`;
    if (W) return `<h2>${n}. ${esc(title)} ${badge(s.status)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ''}${inner}`;
    return `<details class="card frs" id="fr-${key}"${S && s.status === 'ok' && key !== 'osnovni' ? '' : ' open'} style="margin:8px 0;padding:8px 12px">
<summary style="cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:14px">${n}. ${esc(title)}</b> ${badge(s.status)}${s.note ? `<span class="mini" style="color:#475467">${esc(s.note)}</span>` : ''}</summary>
<div style="margin-top:6px">${inner}</div></details>`;
  };

  /* ---------------- sections ---------------- */
  const vatLbl = { month: 'ДДВ обврзник – месечен', quarter: 'ДДВ обврзник – тримесечен', none: 'не е регистриран за ДДВ' } as const;
  const s1 = (d: FrBasic) => kv([
    ['Назив', `<b>${esc(d.name)}</b>${d.active ? '' : ' (неактивна)'}`], ['ЕДБ', esc(d.edb ?? '—')], ['ЕМБС', esc(d.embs ?? '—')],
    ['Адреса', esc([d.address, d.city].filter(Boolean).join(', ') || '—')], ['Правна форма', esc(d.legalFormName || d.legalForm || '—')],
    ['ДДВ статус', vatLbl[d.vat]], ['Дејност', esc(d.activity ?? '—')], ['Контакт', esc([d.phone, d.email].filter(Boolean).join(' · ') || '—')],
    ['Одговорен колега', esc(d.responsible ?? '—') + (d.assigned.length ? ` <span class="mini">(доделени: ${esc(d.assigned.join(', '))})</span>` : '')],
    ['Договор со канцеларијата', d.contract ? `${esc(d.contract.number)} од ${dmy(d.contract.date)} · ${esc(d.contract.status)}${d.contract.end ? ` · важи до ${dmy(d.contract.end)}` : ' · неопределено'}` : 'нема договор'],
    ['Надомест', d.contract ? `${den(d.contract.feeNet)} ден. без ДДВ (${den(d.contract.feeGross)} со ДДВ) месечно` : '—'],
    ['Неплатени фактури за надомест', d.fees ? (d.fees.unpaid ? `${d.fees.unpaid} фактури, ${den(d.fees.unpaidTotal)} ден.` : 'нема') : '—'],
  ]) + h3(`Документи во досието (${d.dossierCount})`) + tbl(['Категорија', 'Документ', 'Важи до', 'Состојба'],
    d.dossier.map((x) => [esc(x.category), esc(x.title ?? ''), x.validTo ? dmy(x.validTo) : '—', x.days == null ? '' : x.days < 0 ? `истечен пред ${-x.days} дена` : `уште ${x.days} дена`]));

  const s2 = (d: FrIncome) => kv([
    ['Приходи', `<b>${den(d.tot.rev)}</b> ден. (лани ${den(d.prev.rev)}, ${pctTxt(d.chg.rev)})`],
    ['Расходи', `<b>${den(d.tot.exp)}</b> ден. (лани ${den(d.prev.exp)}, ${pctTxt(d.chg.exp)})`],
    ['Резултат', `<b>${den(d.tot.res)}</b> ден. ${d.tot.res >= 0 ? '(добивка)' : '(загуба)'} (лани ${den(d.prev.res)}, ${pctTxt(d.chg.res)})`],
  ]) + h3('По месеци и кумулативно') + tbl(['Месец', 'Приходи', 'Расходи', 'Резултат', 'Кумул. приходи', 'Кумул. расходи', 'Кумул. резултат', 'Резултат лани'],
    d.months.map((m) => [frMonthName(m.m), m.rev, m.exp, m.res, m.cumRev, m.cumExp, m.cumRes, m.prevRes]), [1, 2, 3, 4, 5, 6, 7],
    ['Вкупно', d.tot.rev, d.tot.exp, d.tot.res, '', '', '', d.prev.res])
    + h3('Најголеми купувачи (промет без ДДВ)') + tbl(['Купувач', 'Износ'], d.topCustomers.map((x) => [esc(x.name), x.v]), [1])
    + h3('Најголеми добавувачи (набавки без ДДВ)') + tbl(['Добавувач', 'Износ'], d.topSuppliers.map((x) => [esc(x.name), x.v]), [1]);

  const open = (t: string, d: FrOpen, who: string) => h3(`${t}: ${den(d.total)} ден. (доспеано ${den(d.overdue)})`)
    + tbl(['Старост (по рок на плаќање)', 'Износ', 'Документи'], d.buckets.map((b) => [esc(b.label), b.v, String(b.n)]), [1])
    + tbl([who, 'Отворено', 'Доспеано', 'Документи'], d.top.map((x) => [esc(x.name), x.v, x.overdue, String(x.n)]), [1, 2]);
  const s3 = (d: FrFinance) => kv([
    ['Жиро сметки (100x)', `<b>${den(d.bank)}</b> ден. на ${dmy(d.asOf)}`], ['Благајна (102x)', `<b>${den(d.cash)}</b> ден.`],
    ['Благајна во минус', d.cashNeg.firstNeg ? `${d.cashNeg.negDays} дена; прв ден ${dmy(d.cashNeg.firstNeg)}, најниско ${den(d.cashNeg.minB)} ден. на ${dmy(d.cashNeg.minD)}` : 'не била во минус'],
  ]) + tbl(['Конто', 'Назив', 'Салдо'], d.accounts.map((a) => [esc(a.konto), esc(a.name), a.saldo]), [2])
    + open('Побарувања од купувачи', d.recv, 'Најголеми должници') + open('Обврски кон добавувачи', d.pay, 'Најголеми доверители')
    + h3(`Позајмици: дадени ${den(d.loans.given)} ден., примени ${den(d.loans.received)} ден.${d.loans.unlinked ? ` · ${d.loans.unlinked} движења без договор` : ''}`)
    + tbl(['Вид', 'Комитент', 'Датум', 'Износ', 'Салдо', 'Забелешка'], d.loans.rows.map((l) => [l.dir === 'given' ? 'дадена' : 'примена', esc(l.partner), dmy(l.date), l.amount, l.bal, [l.over ? 'рокот истечен' : '', l.noSig ? 'без потпишан договор' : ''].filter(Boolean).join(', ')]), [3, 4]);

  const rates = (L: FrVatPeriod['out']) => L.map((x) => `${x.rate}%: ${den(x.base)} / ${den(x.vat)}`).join('; ') || '—';
  const s4 = (d: FrVat) => (!d.registered ? p('Фирмата не е ДДВ обврзник – нема ДДВ-04.')
    : tbl(['Период', 'Рок', 'Излезен ДДВ', 'Влезен ДДВ', 'Обврска / (поврат)', 'Затворен', 'Поднесен', 'Книги = гл. книга'],
      d.periods.map((v) => [esc(v.period), dmy(v.due), v.outV, v.inV, v.net, v.closed ? '✓' : v.late ? '✗ не' : 'не', v.filed ? '✓' : 'не', v.match ? '✓' : `✗ разлика ${den(v.diff)}`]), [2, 3, 4])
      + h3('По стапки (основа / ДДВ)') + tbl(['Период', 'Излезен', 'Влезен'], d.periods.map((v) => [esc(v.period), rates(v.out), rates(v.in)])));

  const s5 = (d: FrPayroll) => p(`Вработени (активни): <b>${d.employees}</b>`)
    + tbl(['Месец', 'Бруто', 'Нето', 'Придонеси', 'Данок', 'Вработени', 'Пресметка', 'МПИН'],
      d.months.map((m) => [frMonthName(m.month), m.gross, m.net, m.contr, m.tax, String(m.emps || ''), m.status === 'posted' ? 'книжена' : m.status === 'draft' ? 'нацрт' : m.late ? '✗ нема' : '—',
        m.mpin ? `${m.mpin.accepted ? '✓ прифатен' : esc(m.mpin.status ?? 'внесен')}${m.mpin.no ? ` бр. ${esc(m.mpin.no)}` : ''}` : m.late ? '✗ нема' : '—']), [1, 2, 3, 4],
      ['Вкупно', d.gross, d.net, d.contr, d.tax, '', '', '']);

  const s6 = (d: FrStock) => kv([
    ['Залиха на ' + dmy(d.stock.date), `${d.stock.items} артикли, набавна вредност <b>${den(d.stock.value)}</b> ден.`],
    ['Минус залиха', d.stock.negative.length ? `${d.stock.negative.length} артикли` : 'нема'],
    ['Основни средства', `${d.assets.count} (активни ${d.assets.active}), набавна вредност ${den(d.assets.cost)} ден.`],
    ['Амортизација за годината', `${den(d.assets.depYear)} ден. — ${d.assets.depRun ? `книжена (${den(d.assets.runTotal)} ден.)` : 'не е книжена'}`],
  ]) + (d.stock.negative.length ? h3('Артикли со минус залиха') + tbl(['Шифра', 'Артикл', 'Количина'], d.stock.negative.map((x) => [esc(x.code), esc(x.name), String(x.qty)])) : '');

  const dl = (L: readonly FrDl[]) => tbl(['Рок', 'Обврска', 'Состојба', 'Основ'], L.map((x) => [dmy(x.date), esc(x.what) + (S ? link(x.href) : ''),
    x.done ? (x.auto ? '✓ завршено (автоматски)' : '✓ завршено (рачно)') : x.overdue ? '✗ пропуштен' : 'отворен', esc(x.law ?? '') + (x.verified === false ? ' (за проверка)' : '')]));
  const s7 = (d: FrDeadlines) => p(`Од ${dmy(d.from)} до ${dmy(d.to)}`) + h3(`Пропуштени (${d.overdue.length})`) + dl(d.overdue)
    + h3(`Претстојни (${d.upcoming.length})`) + dl(d.upcoming) + h3(`Завршени (${d.done.length})`) + dl(d.done);

  const s8 = (d: FrLegal) => {
    const by = Object.entries(d.counts).filter(([, c]) => c.bad || c.warn).map(([k, c]) => `${FR_SRC[k] ?? k}: ${c.bad} ✗ / ${c.warn} ⚠`);
    return p(by.length ? by.join(' · ') : 'Контролите не најдоа проблеми.')
      + (d.lawrep ? p(`Даночен преглед според законите (ЗДДВ, ЗДД, ЗПДД, ЗДП): ${d.lawrep.bad} ✗, ${d.lawrep.warn} ⚠${d.lawrep.exp ? `, проценета изложеност ${den(d.lawrep.exp)} ден.` : ''}`) : '')
      + (d.yearend ? p(`Контрола на завршна сметка ${R.year}: ${d.yearend.open} отворени од ${d.yearend.all} наоди`) : '')
      + (d.aml ? p(`УФР / перење пари: ниво на ризик ${esc(d.aml.level ?? '—')}, последен преглед ${d.aml.lastReview ? dmy(d.aml.lastReview) : '—'}, следен ${d.aml.nextReview ? dmy(d.aml.nextReview) : '—'}; пријави: ${d.aml.reports}`) : p('УФР / перење пари: нема досие за клиентот.'))
      + (d.kontroli.length ? h3('Отворени контроли и решенија') + tbl(['Орган / акт', 'Број', 'Статус', 'Правен лек', 'Рок', 'Основ'],
        d.kontroli.map((k) => [esc(`${k.auth} – ${k.doc}`), esc(k.docNo ?? ''), esc(k.status), esc(k.remedy ?? '—'), k.due ? dmy(k.due) + (k.state === 'late' ? ' ✗' : k.state === 'soon' ? ' ⚠' : '') : '—', esc(k.law ?? '')])) : '')
      + (d.failed.length ? (W ? `<p>Не успеа: ${esc(d.failed.join('; '))}</p>` : `<div class="callout warn">Не успеа: ${esc(d.failed.join('; '))}</div>`) : '');
  };

  const s9 = (d: FrDocs) => p(`Пристигнато од клиентот, необработено: <b>${d.inbox.open}</b>${d.inbox.oldest ? ` (најстаро од ${dmy(d.inbox.oldest)})` : ''}; ставки на клиентот што чекаат одобрување: <b>${d.pendingClient}</b>`)
    + tbl(['Месец', 'Излезни фактури', 'Влезни фактури', 'Налози', 'Изводи'], d.months.map((m) => [frMonthName(m.m), String(m.inv), String(m.pur), String(m.jour), String(m.stmt)]))
    + h3('Кој работел на фирмата (дневник на активности)') + tbl(['Колега', 'Улога', 'Активности', 'Прва', 'Последна'], d.workers.map((w) => [esc(w.name), esc(w.role), String(w.n), dmy(w.first), dmy(w.last)]));

  const s10 = (d: FrAiCost) => p(`Вкупно ${R.year}: <b>$${d.total.toFixed(2)}</b> (${d.calls} повици)`)
    + tbl(['Месец', 'Трошок (USD)', 'Повици'], d.months.map((m) => [frMonthName(m.m), `$${m.usd.toFixed(2)}`, String(m.calls)]))
    + tbl(['Намена', 'Трошок (USD)', 'Повици'], d.byPurpose.map((x) => [esc(x.purpose), `$${x.usd.toFixed(2)}`, String(x.calls)]));

  /* ---------------- conclusion + AI ---------------- */
  const C = frConclusion(R);
  const concl = (W ? `<h2>11. Заклучок</h2>` : `<div class="card frs" id="fr-zaklucok" style="margin:8px 0;padding:8px 12px"><h2 style="font-size:15px;margin:0 0 6px">11. Заклучок</h2>`)
    + p(`Вкупно ${C.bad} проблеми (✗), ${C.warn} предупредувања (⚠)${C.info ? `, ${C.info} информации` : ''}. Подредени по сериозност, со екранот каде се средува.`)
    + (C.items.length ? (W ? C.items.map((i, n) => `<p>${n + 1}. ${sevB(i.sev)} ${esc(i.area)}: ${esc(i.txt)}${i.law ? ` [${esc(i.law)}]` : ''}${i.go ? ` → ${esc(lbl(i.go))}` : ''}</p>`).join('')
      : `<ol style="margin:4px 0;padding-left:22px">${C.items.map((i) => `<li style="margin:3px 0">${sevB(i.sev)} <b>${esc(i.area)}</b>: ${esc(i.txt)}${i.law ? ` <span class="mini">— <i>${esc(i.law)}</i></span>` : ''}${i.go ? (S ? link(i.go) : ` <span class="mini">→ ${esc(lbl(i.go))}</span>`) : ''}</li>`).join('')}</ol>`)
      : p('✓ Нема пронајдени проблеми.'))
    + (C.failed.length ? p(`Не се пресметани: ${esc(C.failed.join('; '))}`) : '')
    + (W ? '' : '</div>');
  const ai = o.ai;
  const aiHtml = !ai ? '' : ai.status === 'done' && ai.text
    ? (W ? `<h2>🤖 AI анализа (генерирана од AI – не е проверена)</h2>${ai.text.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join('')}<p>${esc(aiNote(ai))}</p>`
      : `<div class="card" id="fr-ai" style="margin:8px 0;padding:8px 12px;border:2px dashed #7f56d9;background:#f9f5ff"><h2 style="font-size:15px;margin:0 0 6px">🤖 AI анализа <span class="pill warn">генерирана од AI – не е проверена</span></h2><div style="white-space:pre-wrap">${esc(ai.text)}</div><p class="mini" style="margin:6px 0 0;color:#475467">${esc(aiNote(ai))}</p></div>`)
    : S ? `<div class="callout ${ai.status === 'error' ? 'bad' : ''}" id="fr-ai">${ai.status === 'queued' ? '💲 AI ја пишува анализата… (освежете за неколку секунди)' : `AI анализата не успеа: ${esc(ai.error ?? '')}`}</div>` : '';

  /* ---------------- appendix: law texts (print / Word) ---------------- */
  const LT = new Map<string, FrLawText>();
  for (const [k] of FR_SECTIONS) for (const f of (R.sections[k] as FrSection).issues) for (const a of f.lawText ?? []) LT.set(a.ref, a);
  const appx = (W || P) && LT.size ? `${W ? '<h2>Прилог: текстови на цитираните членови</h2>' : '<h3 style="margin:14px 0 4px">Прилог: текстови на цитираните членови</h3>'}${[...LT.values()].map((a) => `<p><b>${esc(a.ref)}${a.asOf ? ` (верзија ${dmy(a.asOf)})` : ''}</b>${a.heading ? ` – ${esc(a.heading)}` : ''}</p><p class="mini" style="white-space:pre-wrap">${esc(a.body.length > 2500 ? a.body.slice(0, 2500) + '…' : a.body)}</p>`).join('')}` : '';

  const ov = frOverall(R);
  const head = W
    ? `<h1>ЦЕЛОСЕН ИЗВЕШТАЈ ЗА ФИРМА</h1><p style="text-align:center"><b>${esc(R.firm.name)}</b></p><p style="text-align:center">Година ${R.year}, период ${dmy(R.from)} – ${dmy(R.to)} · споредба со ${dmy(R.prevFrom)} – ${dmy(R.prevTo)} · изработено ${dmy(R.generatedAt)}${o.by ? ` · ${esc(o.by)}` : ''}</p><p>Вкупна оценка: ${badge(ov)}</p>`
    : `<div style="text-align:center;margin:0 0 8px"><div style="font-size:16px;font-weight:700">ЦЕЛОСЕН ИЗВЕШТАЈ ЗА ФИРМА</div><div style="font-size:14px;font-weight:700">${esc(R.firm.name)}</div><div class="mini">Година ${R.year}, период ${dmy(R.from)} – ${dmy(R.to)} · споредба со ${dmy(R.prevFrom)} – ${dmy(R.prevTo)} · изработено ${dmy(R.generatedAt)}${o.by ? ` · ${esc(o.by)}` : ''} · ДОВЕРЛИВО – само за сопственикот на канцеларијата</div></div>
<div class="tw"><table class="dense"><tbody><tr>${FR_SECTIONS.map(([k, t], i) => `<td style="text-align:center;font-size:11px">${S ? `<a href="#fr-${k}">${i + 1}. ${esc(t)}</a>` : `${i + 1}. ${esc(t)}`}<br>${badge((R.sections[k] as FrSection).status)}</td>`).join('')}</tr></tbody></table></div>`;

  return `<div class="frep">${head}${sec(1, 'osnovni', s1)}${sec(2, 'prihodi', s2)}${sec(3, 'finansii', s3)}${sec(4, 'ddv', s4)}${sec(5, 'plati', s5)}${sec(6, 'zalihi', s6)}${sec(7, 'rokovi', s7)}${sec(8, 'zakon', s8)}${sec(9, 'dokumenti', s9)}${sec(10, 'ai', s10)}${concl}${aiHtml}${appx}
${W ? '<p>Сите износи се во денари, од прокнижените документи во програмата. AI делот (ако го има) е генериран од AI и не е проверен.</p>' : '<p class="mini" style="color:#475467;margin-top:10px">Сите износи се во денари, од прокнижените документи во програмата (без проценки). Наодите и членовите се од постоечките контроли на програмата.</p>'}</div>`;
}

const aiNote = (ai: FrAiView) => `Модел: ${ai.model ?? '—'}${ai.at ? ` · ${dmy(ai.at)}` : ''}${ai.costUsd != null ? ` · $${ai.costUsd.toFixed(4)}` : ''}. Испратени се само бројки и наоди (без имиња, ЕДБ и лични податоци).${ai.unverified?.length ? ` Членови надвор од дадениот контекст (${VERIFY_TAG}): ${ai.unverified.join(', ')}.` : ''}`;

/* ====================================================================================================== */
/* „💲 AI анализа“                                                                                         */
/* ====================================================================================================== */

export const FIRM_REPORT_AI_JOB = 'firm-report.ai';
/** `app_settings` key of the AI analysis of a firm and year (no migration: one small JSON per firm / year). */
export const firmReportAiKey = (firmId: string, year: number) => `firmIzvAi:${firmId}:${year}`;

export interface FrAiPayload {
  year: number;
  period: { from: string; to: string };
  status: Record<string, FrStatus>;
  numbers: Record<string, unknown>;
  findings: { sev: FrSev; area: string; law: string | null; txt: string }[];
  /** The stored law texts of the cited articles (the only articles the model may cite as verified). */
  laws: { ref: string; asOf: string | null; text: string }[];
}

const RE_DIGITS = /\d[\d\s.-]{5,}\d/g;
const RE_MAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const RE_IBAN = /\bMK\d{2}[\dA-Z ]{10,}/gi;

/** Remove names (firm, partners, people) and identifiers (ЕДБ, ЕМБС, accounts, e-mail, phone) from a text. */
export function frScrub(t: string, names: readonly string[]): string {
  let s = String(t ?? '');
  // longest first (a partner „Алфа Трејд ДОО“ before „Алфа“)
  for (const n of [...new Set(names.map((x) => String(x ?? '').trim()).filter((x) => x.length >= 3))].sort((a, b) => b.length - a.length)) {
    s = s.split(n).join('[…]');
    const lo = n.toLowerCase();
    if (s.toLowerCase().includes(lo)) s = s.replace(new RegExp(lo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[…]');
  }
  // amounts in the findings stay („1.234,56“ has commas / ≤ 6 digits groups); long digit runs are identifiers
  const keep = (m: string) => /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(m) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(m) || /^\d{4}-\d{2}-\d{2}$/.test(m);
  return s.replace(RE_MAIL, '[е-пошта]').replace(RE_IBAN, '[сметка]').replace(RE_DIGITS, (m) => (keep(m.trim()) ? m : '[број]'));
}

/**
 * What the AI gets: the report's numbers and its findings (texts scrubbed of every given name and of identifiers),
 * plus the stored law texts. No firm name, no ЕДБ / ЕМБС / address, no partner / employee / colleague names, no
 * document numbers.
 */
export function frAiPayload(R: FirmReport, names: readonly string[]): FrAiPayload {
  const N = [R.firm.name, ...names];
  const S = R.sections;
  const d = <K extends FrKey>(k: K) => S[k].data as FirmReport['sections'][K]['data'];
  const inc = d('prihodi'), fin = d('finansii'), vat = d('ddv'), pay = d('plati'), st = d('zalihi'), dl = d('rokovi'), dc = d('dokumenti');
  const b = d('osnovni');
  const numbers: Record<string, unknown> = {
    legalForm: b?.legalForm ?? null, vatStatus: b?.vat ?? null, activeEmployees: pay?.employees ?? null,
    income: inc ? { revenue: inc.tot.rev, expenses: inc.tot.exp, result: inc.tot.res, lastYearSamePeriod: inc.prev, changePct: inc.chg, byMonth: inc.months.map((m) => ({ m: m.m, rev: m.rev, exp: m.exp, res: m.res })) } : null,
    money: fin ? { bank: fin.bank, cash: fin.cash, cashNegativeDays: fin.cashNeg.negDays, cashMin: fin.cashNeg.minB } : null,
    receivables: fin ? { total: fin.recv.total, overdue: fin.recv.overdue, ageing: fin.recv.buckets.map((x) => ({ age: x.label, amount: x.v, docs: x.n })), largestDebtorsAmounts: fin.recv.top.map((x) => x.v) } : null,
    payables: fin ? { total: fin.pay.total, overdue: fin.pay.overdue, ageing: fin.pay.buckets.map((x) => ({ age: x.label, amount: x.v, docs: x.n })) } : null,
    loans: fin ? { given: fin.loans.given, received: fin.loans.received, overdueContracts: fin.loans.rows.filter((r) => r.over).length } : null,
    vat: vat?.registered ? vat.periods.map((v) => ({ period: v.period, output: v.outV, input: v.inV, payable: v.net, closed: v.closed, filed: v.filed, booksMatchLedger: v.match, difference: v.diff, late: v.late })) : 'not registered',
    payroll: pay ? pay.months.map((m) => ({ month: m.month, gross: m.gross, net: m.net, contributions: m.contr, tax: m.tax, employees: m.emps, posted: m.status === 'posted', mpinAccepted: !!m.mpin?.accepted, missing: m.late })) : null,
    stock: st ? { value: st.stock.value, items: st.stock.items, negativeItems: st.stock.negative.length, fixedAssets: st.assets.count, depreciationYear: st.assets.depYear, depreciationPosted: st.assets.depRun } : null,
    deadlines: dl ? { overdue: dl.overdue.map((x) => ({ due: x.date, what: frScrub(x.what, N) })), upcoming: dl.upcoming.slice(0, 15).map((x) => ({ due: x.date, what: frScrub(x.what, N) })), done: dl.done.length } : null,
    documents: dc ? { inboxOpen: dc.inbox.open, pendingClient: dc.pendingClient, byMonth: dc.months } : null,
  };
  const findings: FrAiPayload['findings'] = [];
  const laws = new Map<string, FrAiPayload['laws'][number]>();
  for (const [k] of FR_SECTIONS) for (const f of S[k].issues) {
    findings.push({ sev: f.sev, area: frScrub(f.area, N), law: f.law ?? null, txt: frScrub(f.txt, N).slice(0, 500) });
    for (const a of f.lawText ?? []) if (!laws.has(a.ref)) laws.set(a.ref, { ref: a.ref, asOf: a.asOf, text: frScrub(a.body, N).slice(0, 1500) });
  }
  return {
    year: R.year, period: { from: R.from, to: R.to },
    status: Object.fromEntries(FR_SECTIONS.map(([k]) => [k, S[k].status])), numbers, findings: findings.slice(0, 80), laws: [...laws.values()].slice(0, 25),
  };
}

/** The prompt (Macedonian): a short professional analysis for the office owner, only from the given numbers / findings. */
export function frAiPrompt(x: FrAiPayload): string {
  return [
    'Ти си искусен овластен сметководител и даночен советник во Северна Македонија. Сопственикот на сметководствената канцеларија бара анализа на една клиентска фирма.',
    'Напиши анализа на македонски јазик (кирилица), обичен текст без markdown и без табели, најмногу 350 зборови, во делови:',
    '1) Општа оценка (2–3 реченици); 2) Најголеми ризици по редослед на сериозност; 3) Што да се направи веднаш (конкретни чекори); 4) Препораки за следниот период.',
    'Користи САМО бројките и наодите подолу (износи во денари). Не измислувај бројки, имиња, рокови или членови.',
    `Членови на закони смееш да цитираш само ако се во НАОДИТЕ (полето law) или во ЗАКОНИ подолу. Ако се повикаш на друг член, веднаш по него напиши „${VERIFY_TAG}“.`,
    'Не наведувај имиња на фирми, лица или ЕДБ (ги нема во податоците).',
    '',
    `ГОДИНА: ${x.year}; ПЕРИОД: ${x.period.from} – ${x.period.to}`,
    `СОСТОЈБА ПО ДЕЛОВИ: ${JSON.stringify(x.status)}`,
    `БРОЈКИ: ${JSON.stringify(x.numbers)}`,
    `НАОДИ: ${JSON.stringify(x.findings)}`,
    `ЗАКОНИ (зачувани текстови): ${x.laws.length ? JSON.stringify(x.laws) : '(нема)'}`,
  ].join('\n');
}

/** The article references that are in the given context (findings' law field + the stored texts). */
export function frAiContextRefs(x: Pick<FrAiPayload, 'findings' | 'laws'>): Set<string> {
  return new Set([...x.findings.flatMap((f) => (f.law ? lawRefsOf(f.law) : [])), ...x.laws.flatMap((l) => lawRefsOf(l.ref))].map(refKey));
}

/** Check the model's text: every article it cites that is not in the given context gets „[треба да се провери]“. */
export function frAiCheck(text: string, x: Pick<FrAiPayload, 'findings' | 'laws'>): { text: string; unverified: string[] } {
  const found = new Set<string>();
  const out = String(text ?? '').split('\n').map((l) => tagUnverified(l, frAiContextRefs(x), found)).join('\n').trim();
  return { text: out, unverified: [...found] };
}
