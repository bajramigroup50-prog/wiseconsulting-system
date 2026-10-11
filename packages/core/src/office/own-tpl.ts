/**
 * Own Word templates wired into the program's documents (legacy `tplActive` / `tplRun` and the wrappers 16103–16128):
 * when an active own template exists for a document, its Word and PDF come from the template instead of the built-in.
 * Context values per document (legacy `tplVars(ctx)` branches `d`, `e`/`c`, `x`, `k`, `P`, `A`).
 */
import { dmy } from './dates';
import { personName, type Founder } from './formation';

export interface ActiveTpl { id: string; kind: string; name: string; version: number }

/** Legacy `tplActive(keys)`: the first key with an active own template (keys in priority order). */
export function tplPick<T extends { kind: string; active: boolean }>(keys: readonly string[], all: readonly T[]): T | null {
  for (const k of keys) { const t = all.find((x) => x.active && x.kind === k); if (t) return t; }
  return null;
}

type Vals = Record<string, string | number | null | undefined>;
const d = (v: string | null | undefined) => (v ? dmy(v) : '');

/** Formation case (legacy `osnData`) → ОСНОВАЧ…, УПРАВИТЕЛ…, НАЗИВ…, ГЛАВНИНА…, ПОЛНОМОШНИК… */
export function tplOsnVars(c: {
  name: string; form?: string | null; data: Record<string, string | undefined>; founders: readonly Record<string, unknown>[]; managers: readonly Record<string, unknown>[];
  capEur?: number;
}, agent: { name?: string | null; city?: string | null } = {}): Vals {
  const D = c.data;
  const F = c.founders as unknown as (Founder & { contrib?: number | string })[];
  const Mg = c.managers as unknown as Founder[];
  const f = F[0] ?? ({ kind: 'ФЛ', name: '' } as Founder), g = Mg[0]?.name ? Mg[0]! : f;
  const fio = (p: Founder) => personName(p) || '________';
  const cit = (p: Founder) => { const x = String(p.cit ?? '').trim(); return !x || /македон/i.test(x) ? 'Р.С.Македонија' : x; };
  const addr = (p: Founder) => [p.address, p.city].filter(Boolean).join(', ');
  const per = (p: Founder) => p.kind === 'ПЛ'
    ? `${fio(p)} со ЕМБС ${p.embg || '________'} со седиште на ${addr(p) || '________'}`
    : `${fio(p)} државјанин на ${cit(p)} со ЕМБГ ${p.embg || '________'} со постојано место на живеење на ${addr(p) || '________'}`;
  const town = D.city || 'Скопје', nm = String(c.name || '').trim(), form = c.form || D.form || 'ДООЕЛ';
  const short = D.short || `${nm}${nm.includes(form) ? '' : ' ' + form} ${town}`;
  const full = `Друштво за трговија и услуги ${short}`;
  const seat = [[D.street, D.no].filter(Boolean).join(' '), D.muni, town].filter(Boolean).join(' ');
  const tot = c.capEur || F.reduce((a, p) => a + (Number(p.contrib) || 0), 0) || Number(D.capital) || 0;
  const amt = tot ? tot.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const kind = /непар|ствар|kind/i.test(D.capType ?? '') ? 'непаричен' : 'паричен';
  return {
    ОСНОВАЧ: F.length ? fio(f) : '', ОСНОВАЧ_ПОДАТОЦИ: F.length ? per(f) : '', ОСНОВАЧ_ЕМБГ: f.embg, ОСНОВАЧ_АДРЕСА: addr(f), ОСНОВАЧ_ДРЖАВЈАНСТВО: F.length ? f.cit || 'Р.С.Македонија' : '',
    УПРАВИТЕЛ: g.name ? fio(g) : '', УПРАВИТЕЛ_ПОДАТОЦИ: g.name ? per(g) : '', УПРАВИТЕЛ_ЕМБГ: g.embg, УПРАВИТЕЛ_АДРЕСА: addr(g),
    НАЗИВ: c.name, НАЗИВ_ЦЕЛОСЕН: full, НАЗИВ_СКРАТЕН: short, ФОРМА: form, СЕДИШТЕ: seat, ГРАД: town, ДАТУМ_ИЗЈАВА: d(D.docDate),
    ДЕЈНОСТ: D.nkd || D.activity ? `${D.nkd || '____'} - ${D.activity || '________'}` : '',
    ГЛАВНИНА: amt ? `Основната главнина на друштвото е ${kind} влог во вредност од ${amt} Евра` : '', ГЛАВНИНА_ИЗНОС: amt,
    ПОЛНОМОШНИК: D.agentPerson || agent.name, ПОЛНОМОШНИК_ЕМБГ: D.agentEmbg, ПОЛНОМОШНИК_ГРАД: D.agentCity || agent.city,
  };
}

/** Employee + employment contract (legacy `ctx.e` / `ctx.c`). */
export function tplCtVars(e: { name: string; embg?: string | null; address?: string | null; position?: string | null }, c: {
  no?: string | null; signDate?: string | null; position?: string | null; typeName?: string | null; start?: string | null; end?: string | null; probation?: string | number | null;
  place?: string | null; workPlace?: string | null; duties?: string | null; rep?: string | null; repRole?: string | null; reason?: string | null;
}): Vals {
  return {
    РАБОТНИК: e.name, РАБОТНИК_ЕМБГ: e.embg, РАБОТНИК_АДРЕСА: e.address, РАБОТНО_МЕСТО: c.position || e.position,
    ДОГОВОР_БРОЈ: c.no, ДАТУМ_ПОТПИС: d(c.signDate), ВИД_ДОГОВОР: c.typeName, ПОЧЕТОК: d(c.start), КРАЈ: d(c.end), ПРОБНА_РАБОТА: c.probation,
    МЕСТО_РАБОТА: c.workPlace || c.place, ДОЛЖНОСТИ: c.duties, ПРЕТСТАВНИК: c.rep, ПРЕТСТАВНИК_ФУНКЦИЈА: c.repRole, ПРИЧИНА_ОПРЕДЕЛЕНО: c.reason,
  };
}

/** Disciplinary / termination document (legacy `ctx.x` + `diRep()`). */
export function tplDiVars(e: { name: string; embg?: string | null; address?: string | null; position?: string | null }, x: { no?: string | null; date?: string | null; facts?: string | null }, rep: { rep?: string | null; role?: string | null }): Vals {
  return {
    РАБОТНИК: e.name, РАБОТНИК_ЕМБГ: e.embg, РАБОТНИК_АДРЕСА: e.address, РАБОТНО_МЕСТО: e.position,
    БРОЈ: x.no, ДАТУМ_ДОКУМЕНТ: d(x.date), ОПИС: x.facts, ПРЕТСТАВНИК: rep.rep, ПРЕТСТАВНИК_ФУНКЦИЈА: rep.role,
  };
}

/** Accounting-service contract (legacy `ctx.k`). */
export function tplKdVars(k: { number?: string | null; date?: string | null; place?: string | null; fee?: string | null; rep?: string | null; repRole?: string | null; note?: string | null; services?: readonly string[] }): Vals {
  return {
    ДОГОВОР_БРОЈ: k.number, ДАТУМ_ДОГОВОР: d(k.date), МЕСТО_ДОГОВОР: k.place, НАДОМЕСТ: k.fee, ПРЕТСТАВНИК: k.rep, ПРЕТСТАВНИК_ФУНКЦИЈА: k.repRole,
    НАПОМЕНА: k.note, УСЛУГИ: k.services?.length ? k.services.map((s) => '– ' + s).join('\n') : '',
  };
}

/** Person for the confidentiality statement (legacy `ctx.P`). */
export const tplPersonVars = (P: { name?: string | null; embg?: string | null; position?: string | null }): Vals => ({ ЛИЦЕ: P.name, ЛИЦЕ_ЕМБГ: P.embg, ЛИЦЕ_ФУНКЦИЈА: P.position });

/** AML client file (legacy `ctx.A`) + the office's authorised person. */
export function tplAmlVars(A: { bo?: readonly { name: string; share?: number | string | null }[]; rep?: { name?: string; embg?: string } | null; purpose?: string | null; source?: string | null } | null,
  risk: { level?: string | null; next?: string | null } = {}, off: { officer?: string | null; deputy?: string | null } = {}): Vals {
  return {
    ВИСТИНСКИ_СОПСТВЕНИЦИ: (A?.bo ?? []).map((b) => b.name + (b.share ? ` (${b.share}%)` : '')).join(', '), ЗАСТАПНИК: A?.rep?.name, ЗАСТАПНИК_ЕМБГ: A?.rep?.embg,
    ЦЕЛ_НА_ОДНОСОТ: A?.purpose, ИЗВОР_НА_СРЕДСТВА: A?.source, РИЗИК: risk.level, СЛЕДНА_АНАЛИЗА: d(risk.next), ОВЛАСТЕНО_ЛИЦЕ: off.officer, ЗАМЕНИК: off.deputy,
  };
}

/** Template keys for a registered HR document (legacy wrappers of `ctPdf` and `diPdf`). */
export function hrDocTplKeys(kind: string, title: string | null | undefined): string[] {
  if (kind === 'contract') return ['ct'];
  if (kind.startsWith('di-') && title) return ['d:' + title];
  return [];
}

/** Source references for `/api/office/tpl/own` (`kind:id`). */
export type TplSrc = { t: 'kd' | 'osn' | 'aml' | 'emp' | 'user' | 'firm'; id: string };
export function tplSrcParse(s: unknown): TplSrc | null {
  const m = /^(kd|osn|aml|emp|user|firm):([0-9a-f-]{36}|)$/i.exec(String(s ?? ''));
  return m ? { t: m[1]!.toLowerCase() as TplSrc['t'], id: m[2]! } : null;
}
