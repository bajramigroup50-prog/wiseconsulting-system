/**
 * Inspection readiness (УЈП / ДПИ / ДИТ) — legacy `INSP_G` … `inspCheck` (16462–16530).
 * 40 checks: some are computed from the books (`auto`), the rest are confirmed by hand (`man`, optionally
 * with a validity in months). Data owned by other phases is optional in the context; a check whose data is
 * missing is shown as "to confirm" rather than guessed.
 */
import { r2 } from '../money';
import { addDays, addMonths, dmy, fmtMk, ymAdd } from './dates';
import { cashDays, invoiceGaps, vatPeriodRange, type FirmSnapshot } from './autopilot';

export const INSP_G = [['ujp', '🏛 УЈП – даночна и фискална контрола'], ['dpi', '🛒 Државен пазарен инспекторат'], ['dit', '👷 Државен инспекторат за труд']] as const;
export type InspGroup = (typeof INSP_G)[number][0];

export const INSP_ACT = [['retail', 'Трговија на мало'], ['whole', 'Трговија на големо'], ['ugost', 'Угостителство'], ['serv', 'Услуги'], ['rent', 'Изнајмување (рент)'], ['build', 'Градежништво'], ['prod', 'Производство'], ['trans', 'Превоз']] as const;

export interface InspEmployee {
  name: string; start?: string | null; end?: string | null; embg?: string | null; position?: string | null;
  m1Date?: string | null; lekDate?: string | null; bzrDate?: string | null; leaveDays?: number | null;
}

/** Firm inspection profile (legacy `firm.inspProf` + `kasaMax`). */
export interface InspProfile { fisk?: boolean; alc?: boolean; web?: boolean; kasaMax?: number }

export interface InspCtx {
  td: string; y: string; n: number;
  emps: readonly InspEmployee[];
  codes: string[];
  fisk: boolean; retail: boolean; ugost: boolean; whole: boolean; build: boolean; prod: boolean; rent: boolean; serv: boolean; trans: boolean;
  alc: boolean; web: boolean; kmax: number; ddv: boolean;
  snap: FirmSnapshot & { inspEmployees?: readonly InspEmployee[] | null };
}

/** Legacy `inspCodes`: two-digit NKD divisions (with optional class) of the main and other activities. */
export function inspCodes(nkds: readonly (string | null | undefined)[]): string[] {
  const norm = (x: unknown) => (/\d{2}(\.\d{1,2})?/.exec(String(x ?? '')) ?? [''])[0];
  return [...new Set(nkds.map(norm).filter(Boolean))];
}

/** Legacy `inspCtx`. */
export function inspCtx(snap: InspCtx['snap'], prof: InspProfile = {}, otherNkd: readonly string[] = []): InspCtx {
  const td = snap.today, y = td.slice(0, 4);
  const emps = (snap.inspEmployees ?? []).filter((e) => !e.start || e.start <= td);
  const codes = inspCodes([snap.firm.nkd, ...otherNkd]);
  const has = (re: RegExp) => codes.some((c) => re.test(c));
  const fiskData = !!snap.fiscalDays?.length;
  const retail = has(/^4[57]/) || fiskData, ugost = has(/^5[56]/), whole = has(/^4[56]/), build = has(/^4[1-3]/);
  const prod = has(/^(1\d|2\d|3[0-3])/), rent = has(/^77/), trans = has(/^(49|5[0-3])/), serv = has(/^(3[5-9]|5[89]|6\d|7[0-5]|7[89]|8\d|9\d)/);
  return {
    td, y, n: emps.length, emps, codes, fisk: prof.fisk ?? fiskData, retail, ugost, whole, build, prod, rent, serv, trans,
    alc: !!prof.alc, web: !!prof.web, kmax: Number(prof.kasaMax) || 0, ddv: snap.firm.vatRegistered, snap,
  };
}

export type InspS = 'ok' | 'bad' | 'warn' | 'todo' | 'na';
export interface InspRes { s: InspS; txt: string; go?: string }
const iOk = (txt: string): InspRes => ({ s: 'ok', txt });
const iBad = (txt: string, go?: string): InspRes => ({ s: 'bad', txt, go });
const iWarn = (txt: string, go?: string): InspRes => ({ s: 'warn', txt, go });

export interface InspItem {
  id: string; g: InspGroup; t: string | ((c: InspCtx) => string); law: string; ev: string; fine?: string;
  man?: boolean; valid?: number; need?: (c: InspCtx) => boolean;
}

/** The catalog (legacy `INSP`, 16474), verbatim texts. Automatic checks are in `INSP_AUTO`. */
export const INSP: readonly InspItem[] = [
  { id: "u_z", g: "ujp", t: "Фискална сметка за секоја продажба + дневен Z извештај", law: "Закон за регистрирање на готовински плаќања", ev: "Z извештаи (книга на дневни извештаи), контролни ленти", need: (c) => c.fisk },
  { id: "u_fdev", g: "ujp", t: "Фискален апарат: сервисен договор, контролни ленти 5 год., истакнато „Барајте фискална сметка“", law: "Закон за регистрирање на готовински плаќања", ev: "Договор со овластен сервис, контролни ленти, налепница/известување на касата", man: true, need: (c) => c.fisk },
  { id: "u_ddv", g: "ujp", t: "ДДВ-04 поднесена и книжена до 25-ти", law: "Закон за ДДВ", ev: "Поднесени ДДВ-04 (е-Даноци), книга на влезни и излезни фактури", need: (c) => c.ddv },
  { id: "u_mpin", g: "ujp", t: "МПИН до 10-ти, придонеси платени до 15-ти", law: "Закон за придонеси од задолжително социјално осигурување", ev: "Поднесени МПИН, изводи за платени придонеси", need: (c) => c.n > 0 },
  { id: "u_kneg", g: "ujp", t: "Благајната не смее да оди во минус", law: "Закон за сметководство / благајничко работење", ev: "Благајнички дневник по денови" },
  { id: "u_kmax", g: "ujp", t: "Акт за благајнички максимум; вишокот уплатен до наредниот работен ден", law: "Закон за платежни услуги и платни системи, чл. 183", ev: "Одлука за благајнички максимум, изводи со уплати на пазар", fine: "микро 50–250 €, мал 250–750 €, среден 750–1.500 €, голем 1.500–3.000 € (чл. 218)", man: true },
  { id: "u_kins", g: "ujp", t: "Осигурување на готовината во благајна (пожар, поплава, кражба)", law: "Закон за платежни услуги и платни системи, чл. 183", ev: "Полиса за осигурување најмалку до благајничкиот максимум", man: true, valid: 12, need: (c) => c.kmax > 20000 },
  { id: "u_c6", g: "ujp", t: "Плаќања во готово ≤ 6.000 ден. по набавка и ≤ 60.000 ден. месечно", law: "Закон за платежни услуги и платни системи, чл. 183", ev: "Благајнички исплатници", fine: "микро 50–250 € … голем 1.500–3.000 €" },
  { id: "u_inv", g: "ujp", t: "Излезни фактури по ред без прескокнати броеви, со ЕДБ на купувачот", law: "Закон за ДДВ (елементи на фактура)", ev: "Книга на излезни фактури" },
  { id: "u_popis", g: "ujp", t: "Годишен попис на 31.12 (залиха, основни средства, побарувања и обврски)", law: "Закон за трговските друштва / Закон за сметководство", ev: "Одлука за попис, комисија, пописни листи, извештај", man: true, valid: 12 },
  { id: "u_32a", g: "ujp", t: "Градежни услуги кон ДДВ обврзник – пренесување на даночна обврска (член 32-а)", law: "Закон за ДДВ, чл. 32-а", ev: "Фактури со ознака „член 32-а“ (без пресметан ДДВ)", need: (c) => c.build && c.ddv },
  { id: "u_norm", g: "ujp", t: "Нормативи и калкулација на цена на чинење на производите", law: "Закон за сметководство / МСС 2 Залихи", ev: "Нормативи (материјал, труд), калкулации, работни налози", man: true, need: (c) => c.prod },
  { id: "u_rent", g: "ujp", t: "Договори за изнајмување и фактура за секој период на закуп", law: "Закон за ДДВ, чл. 53 (фактура)", ev: "Договори за закуп / рент, фактури, евиденција на возила/опрема", man: true, need: (c) => c.rent },
  { id: "u_arch", g: "ujp", t: "Чување на книговодствени документи 10 години (архивска книга)", law: "Закон за даночна постапка; Закон за архивски материјал", ev: "Архивска книга, листа на архивски материјал", man: true },
  { id: "d_stock", g: "dpi", t: "Набавна документација за целата стока во објектот (нема продажба без влезна фактура)", law: "Закон за трговија, чл. 28", ev: "Влезни фактури и евиденција за набавка и продажба – во објектот", fine: "500 € ако не е во објектот; 3.000–4.000 € ако не се води", man: true, need: (c) => c.retail || c.ugost || c.whole || c.prod },
  { id: "d_hours", g: "dpi", t: "Работно време истакнато на влезот (со телефон на ДПИ) и пријавено во ЦРМ", law: "Закон за трговија, чл. 25–27", ev: "Истакнато работно време, потврда од ЦРМ", fine: "500 €", man: true, need: (c) => c.retail || c.ugost || c.whole },
  { id: "d_start", g: "dpi", t: "Известување до ДПИ и општината 15 дена пред почеток + минимални технички услови", law: "Закон за трговија, чл. 22–23", ev: "Копија од известувањето, решение/исполнети минимални технички услови", fine: "500 € (известување); 3.000–4.000 € (услови)", man: true, need: (c) => c.retail || c.ugost || c.whole },
  { id: "d_price", g: "dpi", t: "Истакната продажна цена (со ДДВ) и единечна цена на секој производ", law: "Закон за заштита на потрошувачите", ev: "Ценовни етикети, ценовник", man: true, need: (c) => c.retail || c.ugost },
  { id: "d_rekl", g: "dpi", t: "Постапка за рекламации истакната; одговор до потрошувачот во рок од 30 дена", law: "Закон за заштита на потрошувачите", ev: "Известување во објектот, евиденција на рекламации", man: true, need: (c) => c.retail },
  { id: "d_lang", g: "dpi", t: "Декларации, гаранции и упатства на македонски јазик", law: "Закон за заштита на потрошувачите", ev: "Декларации на производите", man: true, need: (c) => c.retail },
  { id: "d_web", g: "dpi", t: "Цени на веб-страница (дел „Ценовник“, ажуриран секој ден до 10 ч.)", law: "Закон за заштита на потрошувачите (измени 2025)", ev: "Веб-страница со ценовник по продавница", fine: "до 10.000 €", man: true, need: (c) => c.retail && c.n > 10 },
  { id: "d_18", g: "dpi", t: "Знак „забрана за продажба на алкохол, енергетски пијалаци и цигари на лица под 18 год.“ (20×50 cm)", law: "Закон за трговија, чл. 24", ev: "Истакнат знак, дозвола за алкохол", fine: "500 €", man: true, need: (c) => c.alc },
  { id: "d_ug", g: "dpi", t: "Угостителство: ценовник, заверени нормативи, категоризација, куќен ред, работно време", law: "Закон за угостителската дејност", ev: "Ценовник на маса/шанк, нормативи заверени во општина, решение за категорија", man: true, need: (c) => c.ugost },
  { id: "t_data", g: "dit", t: "Евиденција за вработените (ЕМБГ, датум на вработување, работно место)", law: "Закон за евиденциите во областа на трудот", ev: "Персонални досиеја", need: (c) => c.n > 0 },
  { id: "t_m1", g: "dit", t: "М1 пријава најдоцна ден пред почеток на работа; копија до работникот", law: "Закон за работните односи, чл. 13", ev: "М1/М2 пријави од АВРМ", fine: "непријавен работник – највисоки казни", need: (c) => c.n > 0 },
  { id: "t_contract", g: "dit", t: "Договор за вработување во писмена форма, во седиштето; копија до работникот", law: "Закон за работните односи, чл. 15", ev: "Потпишани договори и анекси", man: true, need: (c) => c.n > 0 },
  { id: "t_min", g: "dit", t: "Плата не помала од минималната", law: "Закон за минимална плата", ev: "Пресметки на плата", need: (c) => c.n > 0 },
  { id: "t_pay15", g: "dit", t: "Плата исплатена најдоцна до 15-ти во наредниот месец; пресметка до секој работник", law: "Закон за работните односи", ev: "Изводи за исплата, платни листи", man: true, need: (c) => c.n > 0 },
  { id: "t_ot", g: "dit", t: "Прекувремена работа најмногу 190 часа годишно (8 часа неделно)", law: "Закон за работните односи, чл. 117", ev: "Евиденција на прекувремена работа, известување до ДИТ", need: (c) => c.n > 0 },
  { id: "t_leave", g: "dit", t: "Годишен одмор најмалку 20 работни дена; решенија и распоред", law: "Закон за работните односи", ev: "Решенија за годишен одмор, распоред", man: true, valid: 12, need: (c) => c.n > 0 },
  { id: "t_time", g: "dit", t: (c) => (c.n > 25 ? "Електронска евиденција на работно време и прекувремена работа (над 25 вработени)" : "Евиденција на присуство / работно време (евидентен лист)"), law: "Закон за работните односи; Правилник за електронска евиденција на работно време", ev: "Систем за евиденција / месечни листи за присуство", man: true, need: (c) => c.n > 0 },
  { id: "t_sys", g: "dit", t: "Акт за систематизација на работните места", law: "Закон за работните односи", ev: "Акт за систематизација", man: true, need: (c) => c.n > 50 },
  { id: "b_grad", g: "dit", t: "Писмено известување до инспекторатот за труд пред почеток на градежни работи", law: "Закон за БЗР, чл. 23 ст. 2", ev: "Копија од известувањето за секое градилиште", man: true, need: (c) => c.build && c.n > 0 },
  { id: "b_izj", g: "dit", t: "Изјава за безбедност со проценка на ризик, презентирана на вработените", law: "Закон за БЗР, чл. 11 и 27", ev: "Изјава за безбедност (потпишана)", man: true, need: (c) => c.n > 0 },
  { id: "b_lice", g: "dit", t: "Стручно лице за БЗР (или овластена фирма) и договор со овластена здравствена установа", law: "Закон за БЗР, чл. 17–18", ev: "Решение / договор", man: true, need: (c) => c.n > 0 },
  { id: "b_lek", g: "dit", t: "Лекарски (систематски) преглед на секој вработен – на 24 месеци", law: "Закон за БЗР, чл. 22", ev: "Лекарски уверенија", need: (c) => c.n > 0 },
  { id: "b_obuka", g: "dit", t: "Обука за безбедност при работа на секој вработен (при вработување / промена)", law: "Закон за БЗР, чл. 31", ev: "Записник/потврда за обука", need: (c) => c.n > 0 },
  { id: "b_ppz", g: "dit", t: "Противпожарни апарати (сервис), прва помош и план за евакуација", law: "Закон за БЗР, чл. 17 и 24", ev: "Сервисен лист за ПП апарати, комплет прва помош, план за евакуација", man: true, valid: 12, need: (c) => c.n > 0 },
  { id: "b_mikro", g: "dit", t: "Испитување на микроклима и осветленост (во рок од 1 година од почетокот)", law: "Закон за БЗР, чл. 34–35", ev: "Извештај од овластена установа", man: true, need: (c) => c.n > 0 },
  { id: "b_povr", g: "dit", t: "Евиденција за повреди при работа; пријава до ДИТ во рок од 48 часа", law: "Закон за БЗР, чл. 36–37; Закон за евиденциите во областа на трудот", ev: "Книга / евиденција за повреди", man: true, need: (c) => c.n > 0 },];

/** Cash payments: ledger lines crediting cash against a 22x/4x debit in the same journal (legacy `inspCashPays`). */
function cashPays(c: InspCtx) {
  const K = new Set(c.snap.cashAccounts?.length ? c.snap.cashAccounts : ['1020']);
  const by = new Map<string, typeof c.snap.ledger[number][]>();
  for (const l of c.snap.ledger) { const k = l.journalId ?? `${l.date}|${l.number ?? ''}`; by.set(k, [...(by.get(k) ?? []), l]); }
  const R: { date: string; amt: number; partnerId: string | null }[] = [];
  for (const L of by.values()) {
    const out = L.filter((l) => K.has(l.account) && l.credit > 0);
    if (!out.length) continue;
    const cp = L.filter((l) => /^(22|4)/.test(l.account) && l.debit > 0);
    if (!cp.length) continue;
    R.push({ date: L[0]!.date, amt: r2(Math.min(out.reduce((s, l) => s + l.credit, 0), cp.reduce((s, l) => s + l.debit, 0))), partnerId: cp.find((l) => l.partnerId)?.partnerId ?? null });
  }
  return R;
}

/** Automatic part of the checks (`null` = nothing to say / data not available). */
export const INSP_AUTO: Record<string, (c: InspCtx) => InspRes | null> = {
  u_z: (c) => {
    const Z = c.snap.fiscalDays;
    if (!Z) return null; // fiscal reports not available
    const have = new Set(Z);
    const miss: string[] = [];
    for (let d = addDays(c.td, -60); d < c.td; d = addDays(d, 1)) {
      if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0 || have.has(d)) continue;
      if (Z.length && d >= [...Z].sort()[0]!) miss.push(dmy(d));
    }
    return miss.length >= 3 ? iBad(`${miss.length} работни дена без Z извештај во последните 60 дена (${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''})`, 'fiskPer')
      : miss.length ? iWarn(`Без Z: ${miss.join(', ')}`, 'fiskPer') : iOk('Z извештаите се внесени за секој работен ден');
  },
  u_ddv: (c) => {
    const closed = c.snap.vatClosedPeriods;
    if (!closed) return null; // VAT closes not available
    const per = c.snap.firm.vatPeriod ?? 'quarter', step = per === 'month' ? 1 : 3;
    const miss: string[] = [];
    let [a] = vatPeriodRange(c.td, per);
    for (let i = 0; i < 12 / step; i++) {
      a = addMonths(a, -step);
      if (!a.startsWith(c.y)) break;
      const [, b] = vatPeriodRange(a, per);
      if (addDays(b, 25) < c.td && !closed.includes(a)) miss.push(`${dmy(a)}–${dmy(b)}`);
    }
    return miss.length ? iBad(`Не е книжена ДДВ-04 за: ${miss.join(', ')}`, 'ddv') : iOk('ДДВ-04 е книжена за сите поминати периоди');
  },
  u_mpin: (c) => {
    const P = c.snap.payrollMonths;
    if (!P) return null; // payroll not available
    const first = c.emps.map((e) => e.start ?? '').filter(Boolean).sort()[0] ?? `${c.y}-01-01`;
    const miss: string[] = [];
    for (let m = ymAdd(c.td.slice(0, 7), -1), i = 0; i < 12 && m >= first.slice(0, 7) && m.startsWith(c.y); m = ymAdd(m, -1), i++)
      if (!P.includes(m)) miss.push(`${m.slice(5)}/${m.slice(0, 4)}`);
    return miss.length ? iBad(`Нема пресметана плата / МПИН за: ${miss.join(', ')}`, 'plati') : iOk('Плата и МПИН пресметани за секој месец');
  },
  u_kneg: (c) => {
    const D = cashDays(c.snap, c.y).days;
    if (!D.length) return null;
    const neg = D.filter(([, b]) => b < -1);
    return neg.length ? iBad(`Благајната е во минус на ${neg.length} дена (прв ${dmy(neg[0]![0])}: ${fmtMk(neg[0]![1])} ден.)`, 'blagajna') : iOk('Благајната никогаш не е во минус');
  },
  u_kmax: (c) => {
    if (!c.kmax) return iWarn('Внесете го износот на благајничкиот максимум (горе) за да се провери салдото по денови');
    const D = cashDays(c.snap, c.y).days;
    const over = D.filter(([, b]) => b > c.kmax + 1);
    const last = over[over.length - 1];
    return last ? iBad(`Салдото е над максимумот (${fmtMk(c.kmax)}) на ${over.length} дена – последен ${dmy(last[0])} (${fmtMk(last[1])} ден.)`, 'blagajna') : iOk(`Салдото никогаш не го надминува максимумот од ${fmtMk(c.kmax)}`);
  },
  u_c6: (c) => {
    const P = cashPays(c).filter((x) => x.date.startsWith(c.y));
    if (!P.length) return null;
    const big = P.filter((x) => x.amt > 6000);
    const byM = new Map<string, number>();
    for (const x of P) byM.set(x.date.slice(0, 7), r2((byM.get(x.date.slice(0, 7)) ?? 0) + x.amt));
    const mo = [...byM].filter(([, v]) => v > 60000);
    if (!big.length && !mo.length) return iOk('Готовинските плаќања се во дозволените граници');
    const pn = (id: string | null) => (id ? c.snap.partnerNames[id] ?? '' : '');
    return iBad([
      big.length ? `${big.length} плаќања над 6.000 ден. (пр. ${dmy(big[0]!.date)} ${fmtMk(big[0]!.amt)}${big[0]!.partnerId ? ` – ${pn(big[0]!.partnerId)}` : ''})` : '',
      mo.length ? `месеци над 60.000 ден.: ${mo.map(([m, v]) => `${m.slice(5)}/${m.slice(0, 4)} ${fmtMk(v)}`).join(', ')}` : '',
    ].filter(Boolean).join('; '), 'blagajna');
  },
  u_inv: (c) => {
    const I = c.snap.invoices;
    if (!I) return null; // invoices not available
    const gaps = invoiceGaps(I, c.y);
    if (!I.some((i) => i.date.startsWith(c.y))) return null;
    return gaps.length ? iBad(`прескокнати броеви: ${gaps.map(([k, m]) => (k ? `${k}: ` : '') + m.slice(0, 10).join(', ')).join('; ')}`, 'izlez') : iOk('Излезните фактури се по ред');
  },
  t_data: (c) => {
    const bad = c.emps.filter((e) => !e.embg || !e.start || !e.position);
    return bad.length ? iWarn(`Недостасуваат податоци кај ${bad.length}: ${bad.slice(0, 4).map((e) => `${e.name} (${[!e.embg && 'ЕМБГ', !e.start && 'датум', !e.position && 'работно место'].filter(Boolean).join(', ')})`).join('; ')}`, 'vraboteni') : iOk('Податоците за сите вработени се комплетни');
  },
  t_m1: (c) => {
    const no = c.emps.filter((e) => !e.m1Date);
    const late = c.emps.filter((e) => e.m1Date && e.start && e.m1Date > e.start);
    const same = c.emps.filter((e) => e.m1Date && e.start && e.m1Date === e.start);
    return late.length ? iBad(`М1 поднесена ПО почетокот на работа: ${late.map((e) => `${e.name} (${dmy(e.m1Date)})`).join(', ')}`, 'vraboteni')
      : same.length ? iWarn(`М1 на истиот ден кога почнал (законот бара ден пред; само за итна работа – 1 час пред): ${same.map((e) => e.name).join(', ')}`, 'vraboteni')
        : no.length ? iWarn(`Внесете датум на М1 пријава кај ${no.length} вработени (Вработени → „М1 пријава“)`, 'vraboteni') : iOk('М1 пријавите се навремени');
  },
  t_contract: (c) => {
    const exp = c.emps.filter((e) => e.end && e.end < c.td);
    return exp.length ? iBad(`Истечен договор на определено време, а работникот е активен: ${exp.map((e) => `${e.name} (${dmy(e.end)})`).join(', ')}`, 'vraboteni') : null;
  },
  t_leave: (c) => {
    const low = c.emps.filter((e) => e.leaveDays != null && e.leaveDays < 20);
    return low.length ? iBad(`Помалку од 20 дена одмор: ${low.map((e) => `${e.name} (${e.leaveDays})`).join(', ')}`, 'vraboteni') : null;
  },
  b_lek: (c) => {
    const exp = (e: InspEmployee) => addMonths(e.lekDate!, 24);
    const no = c.emps.filter((e) => !e.lekDate);
    const old = c.emps.filter((e) => e.lekDate && exp(e) < c.td);
    const soon = c.emps.filter((e) => e.lekDate && !old.includes(e) && exp(e) < addDays(c.td, 45));
    return old.length ? iBad(`Истечен лекарски преглед: ${old.map((e) => `${e.name} (${dmy(e.lekDate)})`).join(', ')}`, 'vraboteni')
      : no.length ? iWarn(`Внесете датум на лекарски преглед кај ${no.length} вработени`, 'vraboteni')
        : soon.length ? iWarn(`Истекува наскоро: ${soon.map((e) => e.name).join(', ')}`, 'vraboteni') : iOk('Лекарските прегледи се важечки');
  },
  b_obuka: (c) => {
    const no = c.emps.filter((e) => !e.bzrDate);
    return no.length ? iWarn(`Внесете датум на обука за БЗР кај ${no.length} вработени`, 'vraboteni') : iOk('Обуката за БЗР е евидентирана за сите');
  },
};

/** Manual confirmation stored per firm and check (legacy `firm.insp[id] = {d | na, by, note}`). */
export interface InspManual { d?: string | null; na?: boolean; by?: string | null; note?: string | null }

/** Legacy `inspManState`. */
export function inspManState(it: InspItem, x: InspManual | undefined, td: string): InspRes | null {
  if (!x) return null;
  if (x.na) return { s: 'na', txt: `Не се однесува${x.by ? ` · ${x.by}` : ''}` };
  if (!x.d) return null;
  if (it.valid) {
    const exp = addMonths(x.d, it.valid);
    if (exp < td) return { s: 'bad', txt: `Истечено (${dmy(x.d)}) – обновете` };
    if (exp < addDays(td, 30)) return { s: 'warn', txt: `✓ ${dmy(x.d)} · истекува ${dmy(exp)}` };
  }
  return { s: 'ok', txt: `✓ Потврдено ${dmy(x.d)}${x.by ? ` · ${x.by}` : ''}${x.note ? ` · ${x.note}` : ''}` };
}

export interface InspRow extends InspRes { it: InspItem; t: string }

/** Legacy `inspCheck`: merge automatic and manual state per applicable check. */
export function inspCheck(c: InspCtx, manual: Readonly<Record<string, InspManual>>): InspRow[] {
  const R: InspRow[] = [];
  for (const it of INSP) {
    if (it.need && !it.need(c)) continue;
    let a: InspRes | null = null;
    try { a = INSP_AUTO[it.id]?.(c) ?? null; } catch (e) { a = { s: 'warn', txt: `Проверката не успеа: ${e instanceof Error ? e.message : String(e)}` }; }
    if (!it.man && !a) continue;
    const m = it.man ? inspManState(it, manual[it.id], c.td) : null;
    let r: InspRes;
    if (m && m.s === 'na') r = m;
    else if (a && a.s === 'bad') r = a;
    else if (it.man && !m) r = { s: a && a.s === 'ok' ? 'warn' : 'todo', txt: `${a ? `${a.txt} · ` : ''}Потврдете дека документот го имате`, go: a?.go };
    else if (m && (m.s === 'bad' || m.s === 'warn')) r = { ...m, txt: m.txt + (a ? ` · ${a.txt}` : '') };
    else if (a && a.s === 'warn') r = { ...a, txt: a.txt + (m ? ` · ${m.txt}` : '') };
    else r = a ?? m ?? { s: 'todo', txt: '' };
    if (a && m && a.s === 'ok' && m.s === 'ok') r = { s: 'ok', txt: `${a.txt} · ${m.txt}` };
    R.push({ it, t: typeof it.t === 'function' ? it.t(c) : it.t, ...r, go: r.go ?? a?.go });
  }
  return R;
}

/** Readiness score: share of applicable checks that are ok / not applicable. */
export function inspScore(R: readonly InspRow[]): { pct: number; bad: number; warn: number; todo: number } {
  const n = R.length || 1;
  const cnt = (s: InspS) => R.filter((r) => r.s === s).length;
  return { pct: Math.round((100 * (cnt('ok') + cnt('na'))) / n), bad: cnt('bad'), warn: cnt('warn'), todo: cnt('todo') };
}
