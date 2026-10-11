/** AML (ЗСППФТ) client risk assessment — legacy `AML_IND` … `amlPct` (15851–15893). */
import { addMonths, daysBetween } from './dates';

/** Suspicion indicators [id, text, auto-detectable]. */
export const AML_IND = [
  ['cash', 'Чести или големи готовински плаќања/наплати (над 1.000 € е забрането од 01.01.2025)', 1],
  ['loanCash', '„Заеми“ од основачот/трети лица уплатени во готово', 0],
  ['noEmp', 'Нема вработени, а има значаен промет', 1],
  ['manyAcc', 'Голем број трансакциски сметки без деловна логика', 1],
  ['offshore', 'Плаќања за консултантски/маркетинг услуги кон офшор или непознати фирми', 0],
  ['fict', 'Книжење на фиктивни или веќе платени долгови / фактури без реална испорака', 0],
  ['srcUnk', 'Непознато потекло на средствата (вложувања, позајмици)', 0],
  ['chgAcc', 'Честа промена на сметководителот / одбивање да достави документи', 0],
  ['sameAddr', 'Повеќе фирми на иста адреса без вистинска дејност', 0],
  ['lifestyle', 'Начин на живот на сопственикот несоодветен на приходите', 0],
  ['complex', 'Сложена сопственичка структура без јасна причина', 0],
  ['unusual', 'Невообичаени трансакции без економска логика (кружни, поделени под праг)', 0],
] as const;

/** Higher-risk / cash-intensive activity codes (NKD prefixes). */
export const AML_NKD = ['45', '47', '55', '56', '41', '43', '49.32', '64', '65', '66', '68', '92', '46.72', '46.77', '93.2'] as const;

export const AML_LEVELS = ['low', 'mid', 'midhi', 'high'] as const;
export type AmlLevel = (typeof AML_LEVELS)[number];
/** [level, name, review interval in months, pill class] */
export const AML_LV: Record<AmlLevel, readonly [string, number, string]> = {
  low: ['низок', 36, 'good'],
  mid: ['среден', 24, 'info'],
  midhi: ['средно-висок', 12, 'warn'],
  high: ['висок', 12, 'bad'],
};
export const isAmlLevel = (s: unknown): s is AmlLevel => typeof s === 'string' && (AML_LEVELS as readonly string[]).includes(s);

export interface BeneficialOwner { name: string; embg?: string; cit?: string; share?: number | string; legal?: boolean; pep?: boolean; ver?: string | null }

/** The stored assessment (legacy `appaml/{fid}`). */
export interface AmlFile {
  bo?: BeneficialOwner[];
  pep?: boolean;
  pepAsked?: boolean;
  hrc?: boolean;
  nonFace?: boolean;
  crDate?: string | null;
  rep?: { name?: string; embg?: string; idNo?: string; idType?: string; idValid?: string; ver?: boolean };
  purpose?: string;
  source?: string;
  wealth?: string;
  ind?: Record<string, boolean>;
  lvOver?: AmlLevel | null;
  lastReview?: string | null;
  created?: string | null;
  /** Legacy „✓ Одобрение од управителот“ (high risk / PEP): date of the management approval. */
  mgrOk?: string | null;
}

/** Facts read from the books (legacy `amlAuto`). */
export interface AmlAuto {
  cash: number;
  cashMax: number;
  rev: number;
  emps: number;
  nkdRisk: boolean;
  /** Firm age in years (null = unknown). */
  age: number | null;
  bo?: BeneficialOwner[];
}

export const nkdRisky = (nkd: string | null | undefined) => AML_NKD.some((p) => String(nkd ?? '').startsWith(p));

export interface AmlRisk { factors: [string, number][]; score: number; level: AmlLevel; enhanced: boolean }

/**
 * Legacy `amlRisk`. `eurRate` replaces the hard-coded 61.5 (FIX(#18)); `today` makes it deterministic.
 * Hard factors (no beneficial owner, PEP, high-risk country) force `high`; a manual override can raise the
 * level but never lower it below a hard factor.
 */
export function amlRisk(A: AmlFile, X: AmlAuto | null, o: { eurRate: number; today: string; year?: string | number; nkd?: string | null }): AmlRisk {
  const F: [string, number][] = [];
  let s = 0, hard = false;
  const add = (t: string, w: number, h = false) => { F.push([t, w]); s += w; if (h) hard = true; };
  const bo = A.bo?.length ? A.bo : X?.bo ?? [];
  if (!bo.length) add('Не е утврден вистинскиот сопственик', 3, true);
  if (bo.some((b) => b.pep) || A.pep) add('Носител на јавна функција (PEP) или член на семејство / близок соработник', 3, true);
  if (A.hrc) add('Поврзаност со високоризична трета земја (листи на ФАТФ/ЕУ)', 3, true);
  if (bo.some((b) => b.legal)) add('Сопственик е правно лице (сложена структура)', 1);
  if (bo.some((b) => b.cit && !/македон|рсм|р\.с\.м/i.test(b.cit))) add('Странски сопственик', 1);
  if (A.nonFace) add('Деловен однос без лично присуство', 1);
  if (X) {
    if (X.nkdRisk) add(`Дејност со поголем ризик / готовински интензивна (${o.nkd ?? ''})`, 1);
    if (X.cash) add(`Готовински плаќања над 1.000 € во ${o.year ?? o.today.slice(0, 4)}: ${X.cash} (најголема ${X.cashMax} ден.)`, 2);
    if (X.age != null && X.age < 1) add('Новоосновано друштво (под 1 година)', 1);
    if (X.emps === 0 && X.rev > Math.round(100000 * o.eurRate)) add('Нема вработени, промет над 100.000 €', 1);
  }
  if (A.crDate && daysBetween(A.crDate, o.today) > 183) add('Тековната состојба од ЦР е постара од 6 месеци', 1);
  const ind = Object.keys(A.ind ?? {}).filter((k) => A.ind![k]);
  if (ind.length) add(`Индикатори за сомнителност: ${ind.length}`, ind.length * 2);
  let level: AmlLevel = hard || s >= 5 ? 'high' : s >= 3 ? 'midhi' : s >= 1 ? 'mid' : 'low';
  const ord = AML_LEVELS as readonly string[];
  if (A.lvOver && ord.includes(A.lvOver) && !(hard && ord.indexOf(A.lvOver) < ord.indexOf(level))) level = A.lvOver;
  return { factors: F, score: s, level, enhanced: hard || level === 'high' || level === 'midhi' };
}

/** Legacy `amlNext`: next review = last review (or creation) + the level's interval. */
export function amlNextReview(A: AmlFile, level: AmlLevel, today: string): string {
  const b = A.lastReview || A.created;
  if (!b) return today;
  return addMonths(b, AML_LV[level][1]);
}

/** Legacy `amlPct`: completeness of the KYC file in %. */
export function amlCompleteness(A: AmlFile, X: AmlAuto | null): number {
  const bo = A.bo?.length ? A.bo : X?.bo ?? [];
  const ch = [!!A.crDate, !!A.rep?.idNo, bo.length > 0, bo.length > 0 && bo.every((b) => !!b.ver), !!A.purpose, !!A.source, !!A.lastReview, A.pepAsked !== undefined];
  return Math.round((100 * ch.filter(Boolean).length) / ch.length);
}
