/**
 * ⚖️ Прелиминарен даночен преглед според законите (legacy v539 `LR_RULES` 16612, `lrCtx` 16603, `lrCheck` 16645,
 * `lrTable` 16648, v541 additions 16761): the firm's books checked per law article (ЗДДВ, ЗДД, ЗПДД, ЗДП) —
 * article → rule → postings — with the estimated consequence (tax, interest 0,03% daily, fine).
 *
 * The context is built from plain inputs (ledger lines of the year without the closing journal, account names,
 * purchases with their VAT groups, assets, VAT periods, bank withdrawals, stock-count losses) by the DB layer.
 *
 * `p_lnfree` and `l_lnint` (v541) read the loan contracts (`VIEWS.pozajmici`, `lnState`): `LrInput.loans`.
 */
import { r2 } from '../money';
import { dmy, fmtMk as fmt, ymAdd } from '../office/dates';
import { inspCodes } from '../office/inspection';
import { periodDue, periodOf, perRange } from '../vat';

export type LrLaw = 'zddv' | 'zdd' | 'zdld' | 'zdp';
/** Legacy `LR_LAWS`: name and link to the consolidated text. */
export const LR_LAWS: Record<LrLaw, readonly [string, string]> = {
  zddv: ['Закон за данокот на додадена вредност (ЗДДВ)', 'https://www.ujp.gov.mk/files/attachment/0000/0986/______________________________________.____________267____30.12.2025.pdf'],
  zdd: ['Закон за данокот на добивка (ЗДД)', 'https://mapas.mk/wp-content/uploads/2024/02/zakon-za-danokot-na-dobivka.pdf'],
  zdld: ['Закон за персоналниот данок на доход (ЗПДД)', 'https://ujp.gov.mk/files/attachment/0000/1627/08-3061_1_________________________________________________________________14.04.2026.pdf'],
  zdp: ['Закон за даночна постапка (ЗДП)', 'https://ujp.gov.mk/files/attachment/0000/0900/_________________________.pdf'],
};

/** ЗДП: interest 0,03% per day. */
export const LR_INT = 0.0003;
const at = (d: string) => new Date(d + 'T12:00:00Z').getTime();
export const lrDays = (a: string, b: string): number => Math.max(0, Math.round((at(b) - at(a)) / 864e5));
export const lrInt = (amt: number, from: string, to: string): number => r2(Math.max(0, amt) * LR_INT * lrDays(from, to));
export type LrSize = 'micro' | 'small' | 'medium' | 'large';
export const lrSize = (emp: number): LrSize => (emp <= 10 ? 'micro' : emp <= 50 ? 'small' : emp <= 250 ? 'medium' : 'large');
export const LR_FINE_REG: Record<LrSize, string> = { micro: '300–1.000 €', small: '600–2.000 €', medium: '1.800–6.000 €', large: '3.000–10.000 €' };

/** Legacy partner "legal entity" test (`p_loan`, `lnParty`): not a natural person and a legal form in the name. */
export function lrPartnerLegal(name: string | null | undefined, data: { fl?: unknown; person?: unknown; embg?: unknown } = {}, extra = false): boolean {
  if (data.fl || data.person || data.embg) return false;
  return (extra ? /(ДОО|ДООЕЛ|\bАД\b|\bТП\b|DOO|ЈП|ЈЗУ|Општина|Фонд)/i : /(ДОО|ДООЕЛ|\bАД\b|\bТП\b|DOO|ЈП)/i).test(name ?? '');
}

export interface LrLine { account: string; debit: number; credit: number; date: string; partnerId?: string | null }
export interface LrPurchase { date: string; number: string; partnerName: string; art32: boolean; pending: boolean; groups: { konto: string; vat: number }[] }
export interface LrInput {
  firm: { name: string; vat: boolean; per: 'month' | 'quarter'; nkd: readonly (string | null | undefined)[]; kasaMax: number };
  year: string;
  today: string;
  /** Ledger lines of the year (opening included), without the closing journal. */
  lines: readonly LrLine[];
  /** Revenue on 74* of the previous year (legacy `lrPrevRev`). */
  prevRev74: number;
  accName: Readonly<Record<string, string>>;
  partners: Readonly<Record<string, { name: string; legal: boolean; legalX: boolean }>>;
  purchases: readonly LrPurchase[];
  assets: readonly { konto: string; name: string }[];
  /** VAT periods of the year that are due and not filed (closed), with the VAT payable (legacy `ddvFor(p).net`). */
  vatMissing: readonly { p: string; due: string; net: number }[];
  employees: number;
  /** Stock-count shortages of the year (legacy `moves.type==='popis' && qty<0`, |value|). */
  popisLoss: number;
  /** Cash withdrawals from the bank to the cash accounts in the year (|amount|). */
  cashWithdrawals: number;
  cashAccounts: readonly string[];
  /** Pre-close profit (legacy `statements().profit`), null when it cannot be computed. */
  profit: number | null;
  /** Loan contracts with their open balance (legacy `lnState`); `legal` = the other party is a legal entity (`lrPartnerLegal`). */
  loans?: readonly { dir: 'given' | 'received'; rate: number; bal: number; legal: boolean }[];
}

export interface LrCtx extends LrInput {
  B: Record<string, { d: number; p: number }>;
  kName: (k: string) => string;
  sumE: (pre: readonly string[], re: RegExp | null) => number;
  accE: (pre: readonly string[], re: RegExp | null) => string[];
  rev74: number;
  rev7: number;
  codes: string[];
}

export function lrCtx(x: LrInput): LrCtx {
  const B: Record<string, { d: number; p: number }> = {};
  for (const l of x.lines) { const b = (B[String(l.account)] ??= { d: 0, p: 0 }); b.d += +l.debit || 0; b.p += +l.credit || 0; }
  const kName = (k: string) => x.accName[k] ?? '';
  const match = (k: string, pre: readonly string[], re: RegExp | null) => pre.some((p) => k.startsWith(p)) || (!!re && re.test(kName(k)));
  const E = (pre: readonly string[], re: RegExp | null) => Object.entries(B).filter(([k]) => /^[45]/.test(k) && match(k, pre, re));
  const sum = (pre: string, sg: 1 | -1) => r2(Object.entries(B).filter(([k]) => k.startsWith(pre)).reduce((s, [, v]) => s + sg * (v.p - v.d), 0));
  return {
    ...x, B, kName,
    sumE: (pre, re) => r2(E(pre, re).reduce((s, [, v]) => s + v.d - v.p, 0)),
    accE: (pre, re) => E(pre, re).filter(([, v]) => Math.abs(v.d - v.p) > 0.5).map(([k]) => k),
    rev74: sum('74', 1), rev7: sum('7', 1), codes: inspCodes(x.firm.nkd),
  };
}

const lrMatch = (c: LrCtx, k: string, pre: readonly string[], re: RegExp | null) => pre.some((p) => String(k).startsWith(p)) || (!!re && re.test(c.kName(String(k))));
function lrPurVat(c: LrCtx, pre: readonly string[], re: RegExp | null) {
  const out: { p: LrPurchase; vat: number }[] = [];
  for (const p of c.purchases.filter((p) => p.date.startsWith(c.year) && !p.art32 && !p.pending)) {
    for (const g of p.groups) if (+g.vat > 0 && g.konto && lrMatch(c, g.konto, pre, re)) out.push({ p, vat: +g.vat });
  }
  return out;
}
const vatInt = (c: LrCtx, X: { p: LrPurchase; vat: number }[]) => r2(X.reduce((s, x) => s + lrInt(x.vat, periodDue(periodOf(x.p.date, c.firm.per)), c.today), 0));

/** The VAT period before `p` (legacy `prevPeriod`). */
export function lrPrevPeriod(p: string, per: 'month' | 'quarter'): string {
  const [a] = perRange(p);
  const d = new Date(a + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return periodOf(d.toISOString().slice(0, 10), per);
}
/** Finished VAT periods of the year whose ДДВ-04 is due before today (legacy `v_late` loop); the DB layer checks which are filed. */
export function lrVatPeriods(year: string, today: string, per: 'month' | 'quarter'): { p: string; due: string }[] {
  const out: { p: string; due: string }[] = [];
  let p = lrPrevPeriod(periodOf(today, per), per);
  for (let i = 0; i < (per === 'month' ? 12 : 4); i++) {
    if (!p.startsWith(year)) break;
    const due = periodDue(p);
    if (due < today) out.push({ p, due });
    p = lrPrevPeriod(p, per);
  }
  return out;
}

export type LrS = 'bad' | 'warn' | 'ok' | 'info';
export interface LrRes { s: LrS; txt: string; amt?: number; how?: string; fix?: string }
export interface LrRule { id: string; law: LrLaw; art: string; t: string; run: (c: LrCtx) => LrRes | null }

const RE_REPR = /репрезент/i, RE_HOT = /ноќев|сместув|хотел/i, RE_SPON = /спонзор/i, RE_DON = /донаци/i, RE_FINE = /казн[аи]|пенал/i,
  RE_WO = /отпис на побарув/i, RE_OWN = /сокриени исплати|имотна корист од сопственици/i, RE_SHORT = /кусок|кусоци|манок/i, RE_DNL = /договор на дело|авторск/i;

/** Legacy `LR_RULES` (final order after the v541 splice before `p_short`), verbatim texts. */
export const LR_RULES: readonly LrRule[] = [
  /* ---------- ЗДДВ ---------- */
  { id: 'v_reg', law: 'zddv', art: 'чл. 51', t: 'Задолжителна регистрација за ДДВ над 2.000.000 ден. промет', run: (c) => {
    if (c.firm.vat) return null;
    const prev = c.prevRev74;
    let cum = 0, cross: string | null = null;
    const days: Record<string, number> = {};
    for (const l of c.lines) if (String(l.account).startsWith('74')) days[l.date] = (days[l.date] || 0) + (+l.credit || 0) - (+l.debit || 0);
    for (const d of Object.keys(days).sort()) { cum += days[d]!; if (!cross && cum > 2000000) cross = d; }
    if (prev > 2000000) {
      const vat = r2(c.rev74 * 18 / 118);
      return { s: 'bad', txt: `Прометот во ${+c.year - 1} е ${fmt(prev)} ден. (над 2.000.000) – фирмата требаше да се регистрира до 15.01.${c.year}.`, amt: vat, how: `Можен ДДВ на прометот од ${c.year}: ${fmt(c.rev74)} × 18/118 = ${fmt(vat)} ден. + глоба ${LR_FINE_REG[lrSize(c.employees)]} + камата`, fix: 'Веднаш поднесете пријава за регистрација за ДДВ.' };
    }
    if (cross) {
      const vat = r2(Math.max(0, c.rev74 - 2000000) * 18 / 118);
      const due = ymAdd(cross.slice(0, 7), 1) + '-15';
      return { s: due < c.today ? 'bad' : 'warn', txt: `Прометот во ${c.year} го надмина 2.000.000 ден. на ${dmy(cross)} – рок за регистрација ${dmy(due)}.`, amt: due < c.today ? vat : 0, how: due < c.today ? `Проценет ДДВ на прометот над прагот: ${fmt(vat)} ден. + глоба ${LR_FINE_REG[lrSize(c.employees)]}` : 'Регистрирајте се навреме за да нема глоба.', fix: 'Пријава за регистрација за ДДВ до УЈП.' };
    }
    if (c.rev74 > 1600000) return { s: 'warn', txt: `Прометот во ${c.year} е ${fmt(c.rev74)} ден. – блиску до прагот од 2.000.000.`, fix: 'Следете го прометот; при надминување – регистрација до 15-ти следниот месец.' };
    return { s: 'ok', txt: `Промет ${fmt(c.rev74)} ден. – под прагот` };
  } },
  { id: 'v_mon', law: 'zddv', art: 'чл. 39', t: 'Месечен даночен период над 25.000.000 ден. промет', run: (c) => {
    if (!c.firm.vat) return null;
    if (c.prevRev74 > 25000000 && c.firm.per !== 'month') return { s: 'bad', txt: `Прометот во ${+c.year - 1} е ${fmt(c.prevRev74)} ден. – фирмата мора да поднесува ДДВ-04 МЕСЕЧНО, а е поставена тримесечно.`, fix: 'Сменете го периодот во ДДВ-04 на „Месечно“ и поднесете ги месечните пријави.' };
    return { s: 'ok', txt: 'Даночниот период е соодветен на прометот' };
  } },
  { id: 'v_repr', law: 'zddv', art: 'чл. 35 т. 3', t: 'Одбиен претходен ДДВ за репрезентација (не е дозволено)', run: (c) => {
    if (!c.firm.vat) return null;
    const X = lrPurVat(c, ['444'], RE_REPR);
    if (!X.length) return { s: 'ok', txt: 'Нема одбиен ДДВ на репрезентација' };
    const v = r2(X.reduce((s, x) => s + x.vat, 0)), it = vatInt(c, X);
    return { s: 'bad', txt: `${X.length} влезни фактури за репрезентација со одбиен ДДВ ${fmt(v)} ден. (пр. ${X[0]!.p.number || ''} ${X[0]!.p.partnerName || ''})`, amt: r2(v + it), how: `Враќање ДДВ ${fmt(v)} + камата 0,03% дневно ≈ ${fmt(it)} ден.`, fix: 'Книжете го ДДВ како трошок (без право на одбивка) и коригирајте ја ДДВ-04.' };
  } },
  { id: 'v_hot', law: 'zddv', art: 'чл. 35 т. 6', t: 'Одбиен претходен ДДВ за хотелско сместување и исхрана', run: (c) => {
    if (!c.firm.vat) return null;
    const X = lrPurVat(c, ['4401', '4410'], RE_HOT);
    if (!X.length) return { s: 'ok', txt: 'Нема одбиен ДДВ за сместување/исхрана' };
    const v = r2(X.reduce((s, x) => s + x.vat, 0)), it = vatInt(c, X);
    return { s: 'bad', txt: `${X.length} фактури за ноќевање/сместување/исхрана со одбиен ДДВ ${fmt(v)} ден.`, amt: r2(v + it), how: `Враќање ДДВ ${fmt(v)} + камата ≈ ${fmt(it)} ден.`, fix: 'ДДВ на хотелско сместување и оброци не се одбива – коригирајте.' };
  } },
  { id: 'v_car', law: 'zddv', art: 'чл. 35 т. 2', t: 'ДДВ на трошоци за патнички возила (гориво, сервис, закуп)', run: (c) => {
    if (!c.firm.vat) return null;
    const cars = c.assets.filter((a) => String(a.konto || '').startsWith('0136') && !/товар|камион|приклуч/i.test(a.name || '') && (String(a.konto) === '01360' || /патнич|автомобил/i.test(a.name || '')));
    if (!cars.length) return null;
    const X = lrPurVat(c, ['4034', '4136'], /гориво за сопствено|сервис.*возил|одржување на моторни возила/i);
    if (!X.length) return { s: 'ok', txt: 'Нема одбиен ДДВ за патнички возила' };
    const v = r2(X.reduce((s, x) => s + x.vat, 0));
    const ex = c.codes.some((k) => /^(77\.1|49\.3|85\.53)/.test(k));
    return { s: ex ? 'info' : 'warn', txt: `Фирмата има патнички возила (${cars.map((a) => a.name).slice(0, 3).join(', ')}) и одбиен ДДВ ${fmt(v)} ден. за гориво/сервис.`, amt: ex ? 0 : v, how: ex ? 'Дозволено само ако возилата се користат исклучиво за изнајмување / превоз на патници / автошкола.' : `Ако се патнички (М1) – враќање ${fmt(v)} ден. + камата`, fix: 'Проверете кои фактури се за патничко возило и коригирајте го ДДВ.' };
  } },
  { id: 'v_late', law: 'zdp', art: 'камата 0,03% дневно', t: 'Задоцнета ДДВ-04 / неплатен ДДВ', run: (c) => {
    if (!c.firm.vat) return null;
    const miss = c.vatMissing.map((x) => ({ ...x, it: lrInt(x.net, x.due, c.today) }));
    if (!miss.length) return { s: 'ok', txt: 'ДДВ-04 книжена за сите поминати периоди' };
    const it = r2(miss.reduce((s, x) => s + x.it, 0));
    return { s: 'bad', txt: `Не е книжена ДДВ-04 за: ${miss.map((x) => x.p + (x.net > 0 ? ' (' + fmt(x.net) + ' за плаќање)' : '')).join(', ')}`, amt: it, how: `Камата ≈ ${fmt(it)} ден. до денес (ако не е платено) + глоба за задоцнета пријава`, fix: 'Ако пријавите се поднесени во е-Даноци – книжете ги во програмата; ако не – поднесете ги веднаш.' };
  } },
  /* ---------- ЗДД ---------- */
  { id: 'p_repr', law: 'zdd', art: 'чл. 9 т. 8', t: 'Репрезентација – 90% непризнат расход', run: (c) => {
    const a = c.sumE(['444'], RE_REPR);
    if (a <= 0) return { s: 'ok', txt: 'Нема трошоци за репрезентација' };
    const nd = r2(a * 0.9);
    return { s: 'warn', txt: `Репрезентација ${fmt(a)} ден. (конта ${c.accE(['444'], RE_REPR).join(', ')}) – 90% = ${fmt(nd)} ден. се додава во даночната основа.`, amt: r2(nd * 0.1), how: `${fmt(nd)} × 10% = ${fmt(r2(nd * 0.1))} ден. данок`, fix: 'Вклучете го износот во ДБ (непризнати расходи). Ако е вклучен – во ред.' };
  } },
  { id: 'p_spon', law: 'zdd', art: 'чл. 9 т. 9–10', t: 'Спонзорства над 3% и донации над 5% од вкупниот приход', run: (c) => {
    const sp = c.sumE(['4430', '4431'], RE_SPON), dn = c.sumE(['4433', '4434'], RE_DON), mix = c.sumE(['443'], null) - sp - dn;
    if (sp + dn + Math.max(0, mix) <= 0) return null;
    const R = Math.max(0, c.rev7);
    const exS = r2(Math.max(0, sp + Math.max(0, mix) - R * 0.03)), exD = r2(Math.max(0, dn - R * 0.05)), ex = r2(exS + exD);
    return ex > 0
      ? { s: 'warn', txt: `Спонзорства ${fmt(sp + Math.max(0, mix))} (дозволено 3% = ${fmt(r2(R * 0.03))}), донации ${fmt(dn)} (дозволено 5% = ${fmt(r2(R * 0.05))}) – вишок ${fmt(ex)} ден.${mix > 0 ? ' (конто 443 е заедничко – проверете)' : ''}`, amt: r2(ex * 0.1), how: `${fmt(ex)} × 10% = ${fmt(r2(ex * 0.1))} ден.`, fix: 'Вишокот е непризнат расход; потребни се и договори според Законот за донации и спонзорства.' }
      : { s: 'ok', txt: 'Спонзорствата/донациите се во границите' };
  } },
  { id: 'p_fine', law: 'zdd', art: 'чл. 9 т. 14', t: 'Казни, пенали и казнени камати – 100% непризнати', run: (c) => {
    const a = c.sumE(['468'], RE_FINE);
    if (a <= 0) return { s: 'ok', txt: 'Нема книжени казни и пенали' };
    return { s: 'warn', txt: `Казни/пенали ${fmt(a)} ден. (${c.accE(['468'], RE_FINE).join(', ')})`, amt: r2(a * 0.1), how: `${fmt(a)} × 10% = ${fmt(r2(a * 0.1))} ден.`, fix: 'Целиот износ во ДБ како непризнат расход.' };
  } },
  { id: 'p_wo', law: 'zdd', art: 'чл. 9 т. 17, чл. 10', t: 'Директен отпис / исправка на побарувања', run: (c) => {
    const a = c.sumE(['466'], RE_WO);
    if (a <= 0) return null;
    return { s: 'warn', txt: `Отпис на побарувања ${fmt(a)} ден.`, amt: r2(a * 0.1), how: `Ако не се исполнети условите (стечај/ликвидација, утужено) – ${fmt(a)} × 10% = ${fmt(r2(a * 0.1))} ден.`, fix: 'Приложете докази (тужба, стечај, ликвидација) или вклучете во ДБ.' };
  } },
  { id: 'p_own', law: 'zdd', art: 'чл. 9 т. 7', t: 'Скриени исплати / имотна корист на сопствениците', run: (c) => {
    const a = c.sumE(['4691'], RE_OWN);
    if (a <= 0) return null;
    return { s: 'bad', txt: `Скриени исплати / повластици на сопственици ${fmt(a)} ден.`, amt: r2(a * 0.1), how: `${fmt(a)} × 10% = ${fmt(r2(a * 0.1))} ден. (+ можно оданочување кај сопственикот)`, fix: 'Непризнат расход во ДБ.' };
  } },
  { id: 'p_loan', law: 'zdd', art: 'чл. 11', t: 'Дадени заеми/позајмици невратени до крајот на годината', run: (c) => {
    const out: { k: string; b: number; n: string }[] = [];
    for (const [k, v] of Object.entries(c.B)) {
      if (!/^(033|16[0-3])/.test(k) || /камат/i.test(c.kName(k))) continue;
      if (r2(v.d - v.p) <= 1) continue;
      const byP: Record<string, number> = {};
      for (const l of c.lines) if (String(l.account) === k) byP[l.partnerId || ''] = (byP[l.partnerId || ''] || 0) + (+l.debit || 0) - (+l.credit || 0);
      for (const [pid, b] of Object.entries(byP)) {
        if (b <= 1) continue;
        const p = pid ? c.partners[pid] : undefined;
        if (!p?.legalX) out.push({ k, b: r2(b), n: p?.name || 'без комитент' });
      }
    }
    if (!out.length) return { s: 'ok', txt: 'Нема отворени заеми кон физички лица / сопственици' };
    const tot = r2(out.reduce((s, x) => s + x.b, 0));
    const ye = c.year + '-12-31' > c.today;
    return { s: ye ? 'warn' : 'bad', txt: `Отворени дадени заеми ${fmt(tot)} ден.: ${out.slice(0, 4).map((x) => x.n + ' ' + fmt(x.b)).join('; ')}`, amt: r2(tot * 0.1), how: `Ако не се вратат до 31.12.${c.year}: ${fmt(tot)} се додава во даночната основа × 10% = ${fmt(r2(tot * 0.1))} ден.`, fix: ye ? 'Наплатете ги заемите до 31.12.' : 'Вклучете ги во ДБ.' };
  } },
  /* v541 (spliced before p_short) */
  { id: 'p_lnfree', law: 'zdd', art: 'чл. 9 т. 7', t: 'Бескаматна позајмица на сопственик / физичко лице', run: (c) => {
    const R = (c.loans ?? []).filter((l) => l.dir === 'given' && !(+l.rate > 0) && l.bal > 0.5 && !l.legal);
    if (!R.length) return null;
    return { s: 'warn', txt: `${R.length} бескаматни дадени позајмици кон физички лица (${fmt(r2(R.reduce((s, l) => s + l.bal, 0)))} ден.)`, how: 'Ако примачот е сопственик / поврзано лице – непресметаната камата по пазарна стапка може да се смета за скриена распределба на добивка.', fix: 'Договорете камата или вратете ги позајмиците до крајот на годината.' };
  } },
  { id: 'l_lnint', law: 'zdld', art: 'данок 10% на камата', t: 'Камата на примена позајмица од физичко лице', run: (c) => {
    const R = (c.loans ?? []).filter((l) => l.dir === 'received' && +l.rate > 0 && !l.legal);
    if (!R.length) return null;
    return { s: 'warn', txt: `${R.length} примени позајмици од физички лица со камата`, how: 'При исплата на каматата фирмата задржува персонален данок 10% и поднесува е-ППД.', fix: 'Пресметајте го данокот при секоја исплата на камата.' };
  } },
  { id: 'l_cash', law: 'zdld', art: 'неоправдана готовина', t: 'Подигната готовина од сметка што останува неоправдана (благајна / аконтации)', run: (c) => {
    const K = new Set(c.cashAccounts);
    const wd = c.cashWithdrawals;
    let cash = 0;
    for (const [k, v] of Object.entries(c.B)) if (K.has(k)) cash += v.d - v.p;
    cash = r2(cash);
    let adv = 0;
    const advA: string[] = [];
    for (const [k, v] of Object.entries(c.B)) {
      if (!/^14[35]/.test(k) || k === '1450' || k === '1456') continue;
      const b = r2(v.d - v.p);
      if (b > 1) { adv += b; advA.push(k); }
    }
    adv = r2(adv);
    const lim = Math.max(+c.firm.kasaMax || 0, 0);
    const stuck = r2(Math.max(0, Math.min(cash - lim, wd)));
    const tot = r2(stuck + adv);
    if (tot <= 1) return wd ? { s: 'ok', txt: `Подигнати ${fmt(r2(wd))} ден. од сметка – оправдани со документи` } : null;
    return { s: 'warn', txt: [stuck > 0 ? `Во благајна останува ${fmt(cash)} ден.${lim ? ' (максимум ' + fmt(lim) + ')' : ''}, а од сметка се подигнати ${fmt(r2(wd))} ден. – неоправдано ≈ ${fmt(stuck)}` : '', adv > 0 ? `Отворени аконтации кон вработени/сопственици ${fmt(adv)} ден. (${advA.join(', ')})` : ''].filter(Boolean).join(' · '), amt: r2(tot * 0.1), how: `Ако не се оправдаат со сметки / не се вратат – може да се третираат како приход на лицето што ги подигнало: ${fmt(tot)} × 10% = ${fmt(r2(tot * 0.1))} ден. персонален данок (+ камата).`, fix: 'Внесете ги сметките за трошењето, вратете ги парите на сметка или затворете ги аконтациите (патни налози) до крајот на годината.' };
  } },
  { id: 'p_short', law: 'zdd', art: 'чл. 9 т. 7-а', t: 'Кусоци (не по виша сила, не наплатени од одговорно лице)', run: (c) => {
    const a = c.sumE([], RE_SHORT), pop = c.popisLoss, t = r2(a + pop);
    if (t <= 0) return null;
    return { s: 'warn', txt: `Кусоци ${fmt(t)} ден.${pop ? ' (од попис ' + fmt(r2(pop)) + ')' : ''}`, amt: r2(t * 0.1), how: `Ако не се над нормите на кало/растур и не се наплатени – ${fmt(t)} × 10%`, fix: 'Записник за кало/растур во границите или задолжете го одговорното лице (конто 1450).' };
  } },
  { id: 'p_est', law: 'zdd', art: 'чл. 2, 40', t: 'Проценет данок на добивка и аконтации', run: (c) => {
    if (c.profit == null) return null;
    const R = c.rev7;
    if (R <= 3000000) return { s: 'info', txt: `Вкупен приход ${fmt(R)} ден. – до 3.000.000 фирмата може да биде ослободена од данок на добивка (ДБ-ВП).` };
    if (R <= 6000000) return { s: 'info', txt: `Вкупен приход ${fmt(R)} ден. – може да се избере данок на вкупен приход 1% (= ${fmt(r2(R * 0.01))}) наместо 10% на добивка.` };
    return { s: 'info', txt: `Проценета добивка ${fmt(c.profit)} ден. → данок 10% ≈ ${fmt(r2(Math.max(0, c.profit) * 0.1))} ден. (пред непризнатите расходи погоре). Месечни аконтации – до 15-ти.` };
  } },
  /* ---------- ЗПДД ---------- */
  { id: 'l_dnl', law: 'zdld', art: 'данок 10% (е-ППД)', t: 'Исплати на физички лица по договор на дело / авторски', run: (c) => {
    const a = c.sumE(['44901'], RE_DNL);
    if (a <= 0) return null;
    return { s: 'warn', txt: `Трошоци за договор на дело / авторски ${fmt(a)} ден.`, how: 'Проверете дека е задржан и уплатен персонален данок 10% и поднесена е-ППД за секоја исплата.', fix: 'Ако не е – пресметајте и поднесете е-ППД (камата 0,03% дневно од датумот на исплата).' };
  } },
  { id: 'l_div', law: 'zdld', art: 'данок 10% на бруто дивиденда', t: 'Исплатени дивиденди', run: (c) => {
    let a = 0;
    for (const [k, v] of Object.entries(c.B)) if (/^2/.test(k) && /дивиденд/i.test(c.kName(k))) a += v.d;
    a = r2(a);
    if (a <= 0) return null;
    return { s: 'warn', txt: `Исплатени/пресметани дивиденди ${fmt(a)} ден.`, how: `Задржан данок 10% ≈ ${fmt(r2(a * 0.1))} ден. – проверете е-ППД.`, fix: 'Данокот на дивиденда го задржува и уплатува фирмата при исплата.' };
  } },
];

/** Rules not checked yet (none: the loan rules read `LrInput.loans`). Kept for the screen's note. */
export const LR_RULES_PENDING: readonly Pick<LrRule, 'id' | 'law' | 'art' | 't'>[] = [];

export interface LrFinding extends LrRes { r: LrRule }
export interface LrResult { R: LrFinding[]; exp: number; bad: number; warn: number }

/** Legacy `lrCheck`: run every rule; a rule that throws becomes a warning. */
export function lrCheck(c: LrCtx, rules: readonly LrRule[] = LR_RULES): LrResult {
  const R: LrFinding[] = [];
  for (const r of rules) {
    let x: LrRes | null;
    try { x = r.run(c); } catch (e) { x = { s: 'warn', txt: 'Проверката не успеа: ' + (e instanceof Error ? e.message : String(e)) }; }
    if (x) R.push({ r, ...x });
  }
  const exp = r2(R.filter((x) => x.s === 'bad' || x.s === 'warn').reduce((s, x) => s + (+(x.amt ?? 0) || 0), 0));
  return { R, exp, bad: R.filter((x) => x.s === 'bad').length, warn: R.filter((x) => x.s === 'warn').length };
}

export const LR_IC: Record<LrS, string> = { bad: '⛔', warn: '⚠️', ok: '✅', info: 'ℹ️' };
export const LR_IC_PDF: Record<LrS, string> = { bad: '✗', warn: '!', ok: '✓', info: 'i' };

/** Findings grouped by law in `LR_LAWS` order (legacy `lrTable`). */
export const lrByLaw = (X: LrResult): { law: LrLaw; name: string; rows: LrFinding[] }[] =>
  (Object.keys(LR_LAWS) as LrLaw[]).map((law) => ({ law, name: LR_LAWS[law][0], rows: X.R.filter((x) => x.r.law === law) })).filter((g) => g.rows.length);
