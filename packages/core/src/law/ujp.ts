/**
 * 📚 Закони на УЈП – синхронизирано (legacy v541 `UJP_AREAS` 16773, `ujpAreaRules` 16786, `VIEWS.ujpZakoni` 16787):
 * every law area that УЈП administers, linked to its consolidated texts on ujp.gov.mk, the program screens that apply
 * it, the automatic checks (tax-review rules + inspection checks: article → rule → postings) and the latest changes
 * found by the law robot (matched by keywords).
 */
import { INSP, type InspItem, type InspRow } from '../office/inspection';
import { LR_RULES, type LrResult, type LrRule } from './lawrep';
import type { LawRow } from './robot';

export const UJP_U = 'https://www.ujp.gov.mk/mk/regulativa/';

export interface UjpArea {
  k: string; n: string; url: string; kw: RegExp;
  lr?: readonly string[]; lrIds?: readonly string[]; insp?: readonly string[];
  prog?: readonly (readonly [string, string])[]; note?: string;
}

/** Legacy `UJP_AREAS`, verbatim. */
export const UJP_AREAS: readonly UjpArea[] = [
  { k: 'ddv', n: 'Данок на додадена вредност (ЗДДВ)', url: UJP_U + 'pregled/tipovi/ddv', kw: /ддв|додадена вредност|32-а|горива/i, lr: ['zddv'], insp: ['u_ddv', 'u_inv', 'u_32a'], prog: [['ddv', 'ДДВ-04 и книга на влезни/излезни фактури'], ['autop', 'Автопилот → Затворање месец/квартал (ДДВ-04 за сите фирми)']] },
  { k: 'dd', n: 'Данок на добивка (ЗДД)', url: UJP_U + 'pregled/tipovi/dd', kw: /добивка|дб-вп|аконтаци|непризнат/i, lr: ['zdd'], prog: [['firmi', 'Даночен биланс ДБ / ДБ-ВП (Фирми → годишна сметка)']] },
  { k: 'pd', n: 'Персонален данок на доход (ЗПДД)', url: UJP_U + 'pregled/tipovi/pd', kw: /персонален|личен доход|ппд|гдп|дневниц/i, lr: ['zdld'], prog: [['plati', 'Плати и МПИН'], ['pozajmici', 'Позајмици (камата на физички лица)']] },
  { k: 'pri', n: 'Придонеси од задолжително социјално осигурување', url: UJP_U + 'pregled/tipovi/pridonesi', kw: /придонес|мпин|минимална плата|просечна плата|основица/i, insp: ['u_mpin', 't_min', 't_pay15'], prog: [['plati', 'Пресметка на плата, МПИН, минимална и максимална основица']] },
  { k: 'fis', n: 'Фискализација (регистрирање готовински плаќања)', url: UJP_U + 'pregled/tipovi/fis', kw: /фискал|готовинск/i, insp: ['u_z', 'u_fdev', 'u_kneg'], prog: [['fiskPer', 'Фискални извештаи (Z)'], ['blagajna', 'Благајна по денови']] },
  { k: 'zdp', n: 'Закон за даночна постапка (ЗДП)', url: UJP_U + 'opis/97', kw: /даночна постапка|камата|застаре|контрол/i, lr: ['zdp'], insp: ['u_arch'], prog: [['paket', '🏛 Пакет за УЈП со еден клик'], ['insp', '🛡 Подготвеност за инспекција']] },
  { k: 'don', n: 'Донации и спонзорства', url: UJP_U + 'pregled/tipovi/donacii%20i%20sponzorstva', kw: /донаци|спонзор/i, lrIds: ['p_spon'] },
  { k: 'reg', n: 'Регистрација (ЕДБ, ДДВ)', url: UJP_U + 'pregled/tipovi/reg', kw: /регистрац|едб/i, lrIds: ['v_reg', 'v_mon'] },
  { k: 'kasa', n: 'Благајничко работење (Закон за платежни услуги, чл. 183) – поврзан пропис', url: UJP_U + 'pregled/td/pp', kw: /благајн|готовин/i, insp: ['u_kmax', 'u_kins', 'u_c6'], lrIds: ['l_cash'] },
  { k: 'loan', n: 'Позајмици и заеми (ЗДД чл. 11, ЗПДД)', url: UJP_U + 'pregled/tipovi/dd', kw: /позајм|заем/i, insp: ['u_loan'], lrIds: ['p_loan', 'p_lnfree', 'l_lnint'], prog: [['pozajmici', '🤝 Позајмици и заеми – договори']] },
  { k: 'mgdd', n: 'Минимален глобален данок на добивка', url: UJP_U + 'pregled/tipovi/mgdd', kw: /глобален/i, note: 'Само за групи со приход над 750 милиони евра – не се однесува на нашите клиенти.' },
  { k: 'drugo', n: 'Друго (е-Фактура, обрасци, рокови)', url: UJP_U + 'pregled/tipovi/drugo', kw: /е-фактур|e-faktur|образец/i, prog: [['zakoni', '⚖️ Законски промени – дневен робот']] },
];

/** Legacy `ujpAreaRules`: the tax-review rules and inspection checks of an area. */
export function ujpAreaRules(a: UjpArea, rules: readonly LrRule[] = LR_RULES, insp: readonly InspItem[] = INSP): { R: LrRule[]; I: InspItem[] } {
  return {
    R: rules.filter((r) => (a.lr ?? []).includes(r.law) || (a.lrIds ?? []).includes(r.id)),
    I: insp.filter((i) => (a.insp ?? []).includes(i.id)),
  };
}

/** Total automatic checks over all areas (legacy header count). */
export const ujpTotalChecks = (): number => UJP_AREAS.reduce((s, a) => { const { R, I } = ujpAreaRules(a); return s + R.length + I.length; }, 0);

/** Latest changes of an area (legacy: keyword match over title / summary / text / institution, first 3). */
export const ujpAreaChanges = <T extends LawRow & { summary?: string | null; text?: string | null }>(a: UjpArea, law: readonly T[]): T[] =>
  law.filter((x) => a.kw.test([x.title, x.what, x.summary, x.text, x.inst].filter(Boolean).join(' '))).slice(0, 3);

/** Findings of the firm in an area (legacy `fr`): ⛔ bad, ⚠ warn (inspection `todo` counts as warn). */
export function ujpAreaFindings(a: UjpArea, X: LrResult, Y: readonly InspRow[]): { bad: number; warn: number } {
  const { R, I } = ujpAreaRules(a);
  const rid = new Set(R.map((r) => r.id)), iid = new Set(I.map((i) => i.id));
  return {
    bad: X.R.filter((x) => rid.has(x.r.id) && x.s === 'bad').length + Y.filter((x) => iid.has(x.it.id) && x.s === 'bad').length,
    warn: X.R.filter((x) => rid.has(x.r.id) && x.s === 'warn').length + Y.filter((x) => iid.has(x.it.id) && (x.s === 'warn' || x.s === 'todo')).length,
  };
}
