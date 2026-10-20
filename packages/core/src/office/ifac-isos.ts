/**
 * IFAC – the obligations of the office towards ИСОС from the Закон за вршење на сметководствени работи (Сл. весник
 * 173/22, amended 47/25):
 *  - чл. 32 ст. 2 т. 6 and ст. 9 – professional liability insurance, a yearly policy of at least €20.000 per event for a
 *    друштво за вршење сметководствени работи (€10.000 for an овластен сметководител – трговец поединец, €2.000 for a
 *    сметководител – трговец поединец); by 31 January every year the list of the employees with their titles and ИСОС
 *    register numbers and the proof of the insurance go to ИСОС;
 *  - чл. 46 ст. 3 – the yearly quality-control questionnaire: ИСОС sends it by 20 December, it is returned by 31 March
 *    for the previous year; чл. 46 ст. 1 – the control on the spot, at least once in 5 years (what it checks below);
 *  - 47/25 чл. 8 – the КПУ hours of the first and the second cycle completed by 31.12.2026.
 *
 * Pure – storage in @wise/db `ifac_records` (office rows: `isos_ins` per policy start year, `isos_list` per submission
 * year, `isos_q` per year covered, `isos_ctl` per control year); the deadlines go to the office firm's
 * `firm_deadlines` (→ Рокови), the findings to the autopilot.
 */
import type { Finding } from './autopilot';
import type { ReadyItem, ReadySection } from './ifac-sqm';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const str = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max);
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const eur = (n: number) => `€${(Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })}`;

/** The `ifac_records.kind` of the office's ИСОС rows. */
export const ISOS_KINDS = { ins: 'isos_ins', list: 'isos_list', q: 'isos_q', ctl: 'isos_ctl' } as const;

/* ================= professional liability insurance (чл. 32) ================= */

export type IsosForm = 'co' | 'ovl' | 'smet';
/** The office's legal form and the minimum insured amount per event (чл. 32 ст. 2 т. 6). */
export const ISOS_FORMS: readonly (readonly [IsosForm, string, number])[] = [
  ['co', 'Друштво за вршење сметководствени работи', 20000],
  ['ovl', 'Овластен сметководител – трговец поединец', 10000],
  ['smet', 'Сметководител – трговец поединец', 2000],
];
export const insMin = (f: IsosForm | string | null | undefined) => ISOS_FORMS.find((x) => x[0] === f)?.[2] ?? ISOS_FORMS[0]![2];
/** Reminder before the policy expires. */
export const INS_REMIND_DAYS = 30;

export interface InsPolicy { form: IsosForm; insurer: string; policyNo: string; amountEur: number; validFrom: string; validTo: string; note: string }

export function insNormalize(v: Record<string, unknown> | null | undefined): InsPolicy {
  const d = v ?? {};
  const a = Number(String(d.amountEur ?? '').replace(/\./g, '').replace(',', '.'));
  return {
    form: ISOS_FORMS.some((x) => x[0] === d.form) ? (d.form as IsosForm) : 'co',
    insurer: str(d.insurer, 200), policyNo: str(d.policyNo, 100), amountEur: Number.isFinite(a) && a > 0 ? Math.round(a) : 0,
    validFrom: isDate(d.validFrom) ? d.validFrom : '', validTo: isDate(d.validTo) ? d.validTo : '', note: str(d.note),
  };
}

export function insValidate(p: InsPolicy): string | null {
  if (!p.insurer || !p.policyNo) return 'Внесете ја осигурителната компанија и бројот на полисата.';
  if (!p.validFrom || !p.validTo) return 'Внесете важност на полисата (од – до).';
  if (p.validTo <= p.validFrom) return 'Полисата важи „до“ по датумот „од“.';
  if (!p.amountEur) return 'Внесете ја сумата на осигурување по штетен настан (€).';
  return null;
}

export type InsState = 'none' | 'expired' | 'soon' | 'ok';
export interface InsStatus { cur: InsPolicy | null; next: InsPolicy | null; state: InsState; amountOk: boolean; min: number; days: number | null; text: string }

/**
 * The policy in force today (the one valid longest when they overlap), the recorded renewal, and the state:
 * none · expired · soon (expires in 30 days with no renewal recorded) · ok. The amount must reach the form's minimum.
 */
export function insStatus(P: readonly InsPolicy[], today: string, form?: IsosForm | null): InsStatus {
  const L = P.filter((p) => p.validFrom && p.validTo);
  const cur = L.filter((p) => p.validFrom <= today && p.validTo >= today).sort((a, b) => b.validTo.localeCompare(a.validTo))[0] ?? null;
  const last = [...L].sort((a, b) => b.validTo.localeCompare(a.validTo))[0] ?? null;
  const min = insMin(form ?? cur?.form ?? last?.form);
  if (!cur) {
    const next = L.filter((p) => p.validFrom > today).sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0] ?? null;
    return last && last.validTo < today
      ? { cur: null, next, state: 'expired', amountOk: false, min, days: days(today, last.validTo), text: `полисата ${last.policyNo} истече на ${dmy(last.validTo)}` }
      : { cur: null, next, state: 'none', amountOk: false, min, days: null, text: next ? `полисата ${next.policyNo} важи од ${dmy(next.validFrom)}` : 'нема внесена полиса' };
  }
  // a renewal continues the cover from the day after (or earlier)
  const next = L.filter((p) => p !== cur && p.validTo > cur.validTo && p.validFrom <= addDay(cur.validTo)).sort((a, b) => b.validTo.localeCompare(a.validTo))[0] ?? null;
  const d = days(today, cur.validTo);
  const amountOk = cur.amountEur >= min;
  const state: InsState = !next && d <= INS_REMIND_DAYS ? 'soon' : 'ok';
  return {
    cur, next, state, amountOk, min, days: d,
    text: `${cur.insurer}, полиса ${cur.policyNo}, ${eur(cur.amountEur)} по штетен настан, важи до ${dmy(cur.validTo)}${amountOk ? '' : ` – под минимумот од ${eur(min)}`}${next ? `; обновена со ${next.policyNo} до ${dmy(next.validTo)}` : state === 'soon' ? ` – истекува за ${d} дена` : ''}`,
  };
}
const addDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

/* ================= the list of employees by 31 January (чл. 32 ст. 9) ================= */

export const isosListDue = (year: number) => `${year}-01-31`;
export interface IsosListRow { name: string; title: string; reg: string }
export interface IsosListRec { submittedOn: string | null; how: string; note: string; staff?: IsosListRow[] }
export function isosListNormalize(v: Record<string, unknown> | null | undefined): IsosListRec {
  const d = v ?? {};
  const st = Array.isArray(d.staff) ? (d.staff as Record<string, unknown>[]).map((r) => ({ name: str(r?.name, 200), title: str(r?.title, 200), reg: str(r?.reg, 100) })).filter((r) => r.name) : undefined;
  return { submittedOn: isDate(d.submittedOn) ? d.submittedOn : null, how: str(d.how, 200), note: str(d.note), ...(st ? { staff: st } : {}) };
}

/** Title of an employee in the ИСОС registers (from the staff record), else the role in the office. */
export const isosTitle = (isos: string | null | undefined, role: string) =>
  isos === 'ovl' ? 'Овластен сметководител' : isos === 'smet' ? 'Сметководител' : role;

/** The list for ИСОС as HTML (print / PDF): employees with titles and register numbers, and the insurance in force. */
export function isosListHtml(o: { office: string; edb?: string | null; city?: string | null; year: number; date: string; rows: readonly IsosListRow[]; ins: InsStatus; rep?: string | null }): string {
  const c = o.ins.cur ?? o.ins.next;
  const td = (t: unknown, x = '') => `<td style="border:1px solid #999;padding:3px 6px${x}">${esc(t)}</td>`;
  return `<div style="font-family:'Times New Roman',Georgia,serif;font-size:12px;line-height:1.5;color:#111">
  <p style="margin:0"><b>${esc(o.office)}</b>${o.edb ? `, ЕДБ ${esc(o.edb)}` : ''}${o.city ? `, ${esc(o.city)}` : ''}</p>
  <p style="margin:6px 0 0">До: <b>Институт на сметководители и овластени сметководители на Република Северна Македонија (ИСОС)</b></p>
  <h1 style="text-align:center;font-size:15px;margin:14px 0 2px">СПИСОК НА ВРАБОТЕНИ И ДОКАЗ ЗА ОСИГУРУВАЊЕ</h1>
  <p style="text-align:center;margin:0 0 10px">за ${o.year} година · согласно член 32 став 9 од Законот за вршење на сметководствени работи</p>
  <table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr><th style="border:1px solid #999;padding:3px 6px;width:8mm">Р.б.</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Име и презиме</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Звање</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Број во регистарот на ИСОС</th></tr></thead>
  <tbody>${o.rows.map((r, i) => `<tr>${td(i + 1, ';text-align:center')}${td(r.name)}${td(r.title)}${td(r.reg || '—')}</tr>`).join('') || `<tr>${td('нема вработени', '')}</tr>`}</tbody></table>
  <p style="margin:12px 0 4px"><b>Осигурување од професионална одговорност</b> (член 32 став 2 точка 6):</p>
  <p style="margin:0 0 4px">${c ? `Осигурител: <b>${esc(c.insurer)}</b>, полиса бр. <b>${esc(c.policyNo)}</b>, сума на осигурување <b>${esc(eur(c.amountEur))}</b> по штетен настан, важност од ${esc(dmy(c.validFrom))} до ${esc(dmy(c.validTo))}.` : '⚠ нема внесена важечка полиса.'} Копија од полисата е во прилог.</p>
  <div style="display:flex;justify-content:space-between;margin-top:30px;gap:30px;page-break-inside:avoid">
    <div>${esc(o.city || '')}${o.city ? ', ' : ''}${esc(dmy(o.date))} година</div>
    <div style="text-align:center;min-width:70mm"><b>${esc(o.office)}</b><div style="margin-top:30px;border-top:1px solid #111;padding-top:3px">${esc(o.rep || '')}<br><small>(потпис и печат)</small></div></div>
  </div></div>`;
}

/* ================= the yearly quality-control questionnaire (чл. 46 ст. 3) ================= */

/** ИСОС sends the questionnaire by 20 December of the year; it is returned by 31 March of the next year. */
export const isosQSent = (year: number) => `${year}-12-20`;
export const isosQDue = (year: number) => `${year + 1}-03-31`;
export interface IsosQRec { receivedOn: string | null; submittedOn: string | null; note: string }
export function isosQNormalize(v: Record<string, unknown> | null | undefined): IsosQRec {
  const d = v ?? {};
  return { receivedOn: isDate(d.receivedOn) ? d.receivedOn : null, submittedOn: isDate(d.submittedOn) ? d.submittedOn : null, note: str(d.note) };
}

/* ================= the quality control on the spot (чл. 46 ст. 1) ================= */

/** At least once in 5 years. */
export const ISOS_CTL_YEARS = 5;
/** What the control checks (чл. 46 ст. 1) and where the office keeps the evidence. */
export const ISOS_CTL_SCOPE: readonly { k: string; n: string; ev: string; href: string }[] = [
  { k: 'ethics', n: 'Примена на Кодексот на етика на IFAC (IESBA)', ev: 'Годишни изјави за етика; ISQM 1 „Релевантни етички барања“', href: '/ifac?t=et' },
  { k: 'indep', n: 'Независност', ev: 'Клиентите и судирот на интереси во изјавите; листа ISQM 1 за прифаќање по клиент', href: '/ifac?t=sqm&c=ethics' },
  { k: 'hr', n: 'Човечки ресурси', ev: 'Компетентност по улога, КПУ со сертификати; ISO „Обуки и компетентност“', href: '/ifac?t=staff' },
  { k: 'lic', n: 'Лиценца (дозвола за вршење сметководствени работи)', ev: 'Дозволата и лиценците во досието на канцеларијата; осигурувањето', href: '/ifac?t=isos' },
  { k: 'reg', n: 'Уписи во регистрите на ИСОС', ev: 'Регистарски броеви на вработените; списокот до 31 јануари', href: '/ifac?t=staff' },
  { k: 'ic', n: 'Политики за внатрешна контрола', ev: 'Систем ISQM 1 (9 компоненти) и ISO процедурите', href: '/ifac?t=sqm' },
];
export interface IsosCtlRec { date: string | null; by: string; findings: string; measures: string; note: string }
export function isosCtlNormalize(v: Record<string, unknown> | null | undefined): IsosCtlRec {
  const d = v ?? {};
  return { date: isDate(d.date) ? d.date : null, by: str(d.by, 200), findings: str(d.findings, 4000), measures: str(d.measures, 4000), note: str(d.note) };
}
/** The next control at the latest (5 years after the last one). */
export const isosCtlNext = (last: string | null | undefined) => (last ? `${Number(last.slice(0, 4)) + ISOS_CTL_YEARS}-${last.slice(5)}` : null);

/* ================= КПУ transitional rule (47/25 чл. 8) ================= */

export const KPU_TRANSITION_END = '2026-12-31';
export const KPU_TRANSITION_TEXT = 'Преоден рок (Сл. весник 47/25, чл. 8): часовите за континуирано професионално усовршување од првиот и вториот циклус треба да се завршат најдоцна до 31.12.2026.';

/* ================= the state, the deadlines, the readiness, the autopilot ================= */

export interface IsosState {
  /** All recorded policies. */
  ins: InsPolicy[];
  /** Files on the policy in force (scan). */
  insFiles: number;
  form?: IsosForm | null;
  /** year → list submitted on. */
  list: Record<number, string | null>;
  /** year covered → questionnaire submitted on. */
  q: Record<number, string | null>;
  /** The last control on the spot. */
  ctl: IsosCtlRec | null;
  /** The registered employees' КПУ hours of the last three years against their rule; null = nobody registered. */
  kpu: { name: string; three: number; need: number }[] | null;
}

export const ISOS_DL = {
  list: (y: number) => `ИСОС: список на вработени и доказ за осигурување за ${y} (чл. 32 ст. 9)`,
  q: (y: number) => `ИСОС: годишен прашалник за контрола на квалитет за ${y} (чл. 46 ст. 3)`,
  ins: (p: Pick<InsPolicy, 'policyNo'>) => `ИСОС: истекува осигурувањето од професионална одговорност – полиса ${p.policyNo}`,
  kpu: 'ИСОС: КПУ – часовите од првиот и вториот циклус (преоден рок 47/25 чл. 8)',
} as const;
export interface IsosDeadline { title: string; due: string; remindDays: number; done: boolean; note: string }

const kpuOk = (s: IsosState) => !s.kpu || s.kpu.every((k) => k.three >= k.need);

/** The office deadlines towards ИСОС (this and next year) with their done state. */
export function isosDeadlines(s: IsosState, today: string): IsosDeadline[] {
  const Y = Number(today.slice(0, 4));
  const D: IsosDeadline[] = [];
  for (const y of [Y, Y + 1]) D.push({ title: ISOS_DL.list(y), due: isosListDue(y), remindDays: 30, done: !!s.list[y], note: 'Список на вработените со звањата и регистарските броеви во ИСОС и доказ за осигурувањето (🤝 IFAC › ИСОС).' });
  for (const y of [Y - 1, Y]) D.push({ title: ISOS_DL.q(y), due: isosQDue(y), remindDays: 30, done: !!s.q[y], note: `ИСОС го доставува прашалникот до ${dmy(isosQSent(y))}; се враќа до ${dmy(isosQDue(y))} (🤝 IFAC › ИСОС).` });
  for (const p of s.ins) {
    if (!p.validTo || !p.policyNo || p.validTo < `${Y - 1}-01-01`) continue;
    const renewed = s.ins.some((x) => x !== p && x.validTo > p.validTo && x.validFrom <= addDay(p.validTo));
    D.push({ title: ISOS_DL.ins(p), due: p.validTo, remindDays: INS_REMIND_DAYS, done: renewed, note: `Нова полиса од најмалку ${eur(insMin(p.form))} по штетен настан (ЗВСР чл. 32 ст. 2 т. 6) – внесете ја во 🤝 IFAC › ИСОС.` });
  }
  if (today <= KPU_TRANSITION_END) D.push({ title: ISOS_DL.kpu, due: KPU_TRANSITION_END, remindDays: 60, done: kpuOk(s), note: KPU_TRANSITION_TEXT });
  return D;
}

/** The readiness section „Обврски кон ИСОС“ for the given year. */
export function isosSection(s: IsosState, year: number, today: string): ReadySection {
  const st = insStatus(s.ins, today, s.form);
  const href = '/ifac?t=isos';
  const ctlNext = isosCtlNext(s.ctl?.date);
  const it: ReadyItem[] = [
    { n: `Осигурување од професионална одговорност важечко, најмалку ${eur(st.min)} по штетен настан (чл. 32 ст. 2 т. 6)`, ok: (st.state === 'ok' || st.state === 'soon') && st.amountOk, info: st.text, href },
    { n: 'Полисата (скен) во прилог', ok: !!st.cur && s.insFiles > 0, href },
    { n: `Список на вработени со звања и регистарски броеви и доказ за осигурување доставени до ИСОС до ${dmy(isosListDue(year))} (чл. 32 ст. 9)`, ok: !!s.list[year], info: s.list[year] ? `доставено ${dmy(s.list[year])}` : today <= isosListDue(year) ? `рок ${dmy(isosListDue(year))}` : 'не е доставено', href },
    { n: `Годишен прашалник за контрола на квалитет за ${year - 1} доставен до ${dmy(isosQDue(year - 1))} (чл. 46 ст. 3)`, ok: !!s.q[year - 1], info: s.q[year - 1] ? `доставено ${dmy(s.q[year - 1])}` : today <= isosQDue(year - 1) ? `рок ${dmy(isosQDue(year - 1))}` : 'не е доставено', href },
    { n: `Контрола на квалитет на терен (најмалку еднаш во ${ISOS_CTL_YEARS} години, чл. 46 ст. 1) – наодите и мерките евидентирани`, ok: !s.ctl?.findings || !!s.ctl.measures, info: s.ctl?.date ? `последна ${dmy(s.ctl.date)}, следна најдоцна ${dmy(ctlNext)}` : 'нема евидентирана контрола – доказите се во ISQM 1 / ISO', href },
  ];
  if (year <= Number(KPU_TRANSITION_END.slice(0, 4))) {
    it.push({ n: 'КПУ – часовите од првиот и вториот циклус завршени до 31.12.2026 (47/25 чл. 8)', ok: kpuOk(s), info: s.kpu?.length ? s.kpu.map((k) => `${k.name} ${k.three} / ${k.need} ч.`).join(', ') : 'нема означени сметководители во регистарот на ИСОС', href: '/ifac?t=staff' });
  }
  return { k: 'isos', n: 'Обврски кон ИСОС (Закон за вршење на сметководствени работи)', clause: 'ЗВСР чл. 32, 46 · 47/25 чл. 8', items: it };
}

export const ISOS_CAT = 'ИСОС';

/** Autopilot findings of the office firm (stable keys per obligation and year). */
export function isosFindings(s: IsosState, today: string): Finding[] {
  const Y = Number(today.slice(0, 4));
  const A: Finding[] = [];
  const add = (lvl: Finding['lvl'], key: string, txt: string) => A.push({ lvl, cat: ISOS_CAT, txt, go: 'ifac', key: `isos|${key}` });
  const st = insStatus(s.ins, today, s.form);
  if (st.state === 'none' || st.state === 'expired') add('bad', 'ins', `Нема важечко осигурување од професионална одговорност (ЗВСР чл. 32): ${st.text}.`);
  else {
    if (!st.amountOk) add('bad', 'insAmt', `Осигурувањето е под минимумот од ${eur(st.min)} по штетен настан: ${st.text}.`);
    if (st.state === 'soon') add('warn', 'insSoon', `Осигурувањето од професионална одговорност истекува на ${dmy(st.cur!.validTo)} – обновете ја полисата.`);
  }
  const ld = isosListDue(Y);
  if (!s.list[Y] && today > ld) add('bad', `list${Y}`, `Списокот на вработени и доказот за осигурување за ${Y} не се доставени до ИСОС (рок ${dmy(ld)}).`);
  else if (!s.list[Y] && days(today, ld) <= 30) add('warn', `list${Y}`, `До ${dmy(ld)}: список на вработени и доказ за осигурување до ИСОС.`);
  const qd = isosQDue(Y - 1);
  if (!s.q[Y - 1] && today > qd) add('bad', `q${Y - 1}`, `Годишниот прашалник за контрола на квалитет за ${Y - 1} не е доставен до ИСОС (рок ${dmy(qd)}).`);
  else if (!s.q[Y - 1] && days(today, qd) <= 30) add('warn', `q${Y - 1}`, `До ${dmy(qd)}: годишен прашалник за контрола на квалитет за ${Y - 1} до ИСОС.`);
  if (today <= KPU_TRANSITION_END && !kpuOk(s) && days(today, KPU_TRANSITION_END) <= 120) {
    add('warn', 'kpu2026', `КПУ преоден рок 31.12.2026: ${s.kpu!.filter((k) => k.three < k.need).map((k) => `${k.name} ${k.three} / ${k.need} ч.`).join(', ')}.`);
  }
  return A;
}
