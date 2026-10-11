/**
 * „Анализа на решение / записник од контрола“ — pure part of the inspections register:
 * authorities and act types, the legal remedies with their deadlines (приговор / забелешки / жалба / тужба), the
 * per-finding analysis and recommendation, the summary of an inspection and the Macedonian draft of the objection /
 * appeal. Amounts are integer cents (see cents.ts); the database stores them as `numeric(18,2)` strings.
 */
import { fmtCents, sumCents } from './cents';
import { deadlineFrom, deadlineState, type DeadlineState, type DeadlineUnit } from './deadlines';

export const KONTROLA_AUTH = {
  ujp: 'Управа за јавни приходи (УЈП)',
  dpi: 'Државен пазарен инспекторат (ДПИ)',
  dit: 'Државен инспекторат за труд (ДИТ)',
  ufr: 'Управа за финансиско разузнавање (УФР)',
  carina: 'Царинска управа',
  dzlp: 'Агенција за заштита на личните податоци (АЗЛП)',
  other: 'Друг орган',
} as const;
export type KontrolaAuth = keyof typeof KONTROLA_AUTH;
export const isKontrolaAuth = (x: unknown): x is KontrolaAuth => typeof x === 'string' && x in KONTROLA_AUTH;

export const KONTROLA_DOC = {
  zapisnik: 'Записник од контрола / инспекциски надзор',
  reshenie: 'Решение (прв степен)',
  vtor: 'Решение / одлука во втор степен',
  platen: 'Прекршочен платен налог / покана за плаќање',
  zakl: 'Заклучок / известување',
} as const;
export type KontrolaDoc = keyof typeof KONTROLA_DOC;
export const isKontrolaDoc = (x: unknown): x is KontrolaDoc => typeof x === 'string' && x in KONTROLA_DOC;

export const KONTROLA_STATUS = {
  open: 'Во тек (контрола)',
  record: 'Примен записник',
  decision: 'Примено решение',
  objected: 'Поднесен приговор / жалба',
  appeal: 'Втор степен / суд',
  closed: 'Затворено',
} as const;
export type KontrolaStatus = keyof typeof KONTROLA_STATUS;
export const isKontrolaStatus = (x: unknown): x is KontrolaStatus => typeof x === 'string' && x in KONTROLA_STATUS;

/** Areas a finding can concern — also decides which evidence the program links. */
export const FINDING_AREA = {
  vat: 'ДДВ',
  cit: 'Данок на добивка',
  pit: 'Персонален данок',
  contrib: 'Придонеси',
  payroll: 'Плати / работно време',
  invoice: 'Фактури / нумерација',
  books: 'Деловни книги / книжења',
  cash: 'Благајна / готовина',
  fiscal: 'Фискална каса',
  labour: 'Работни односи (ДИТ)',
  market: 'Трговија (ДПИ)',
  aml: 'Перење пари (УФР)',
  gdpr: 'Лични податоци',
  customs: 'Царина',
  other: 'Друго',
} as const;
export type FindingArea = keyof typeof FINDING_AREA;
export const isFindingArea = (x: unknown): x is FindingArea => typeof x === 'string' && x in FINDING_AREA;

/** Default area of a finding by authority (for the AI read and manual entry). */
export const AUTH_AREA: Readonly<Record<KontrolaAuth, FindingArea>> = { ujp: 'vat', dpi: 'market', dit: 'labour', ufr: 'aml', carina: 'customs', dzlp: 'gdpr', other: 'other' };

export interface Remedy {
  /** Short name of the legal remedy. */
  name: string;
  n: number;
  unit: DeadlineUnit;
  /** To whom / where it is filed. */
  to: string;
  /** Does filing suspend payment / execution? */
  suspends: boolean;
  law: string;
  note?: string;
  /** Reading of the program that the office must confirm (see COMPLIANCE.md „за потврда“). */
  confirm?: boolean;
}

const DKZ = 'Државна комисија за одлучување во управна постапка и постапка од работен однос во втор степен';
const DKI = 'надлежната второстепена комисија за инспекциски надзор';
const US = 'Управен суд (управен спор)';
const ZUS = 'Закон за управните спорови – тужба во рок од 30 дена од приемот на конечниот акт';
const PLATEN: Remedy = { name: 'Плаќање на половина од глобата / оспорување', n: 8, unit: 'days', to: 'органот што го издал платниот налог', suspends: false, law: 'Закон за прекршоците – прекршочен платен налог: плаќање во рок од 8 дена со намалување за половина', confirm: true, note: 'Ако не се плати, органот поднесува барање за прекршочна постапка, каде прекршокот може да се оспори.' };
const ZIN_REC: Remedy = { name: 'Изјаснување (забелешки) на записникот', n: 8, unit: 'days', to: 'инспекторот што го состави записникот', suspends: false, law: 'Закон за инспекцискиот надзор (Сл. весник 102/2019, 272/2024, 22/2025), чл. 62 и чл. 82 – записник составен подоцна: 8 дена за изјаснување; молчењето се смета за согласност', note: 'Ако записникот е составен на лице место, забелешките се внесуваат веднаш во записникот (чл. 62).' };
const ZIN_APPEAL: Remedy = { name: 'Жалба', n: 15, unit: 'days', to: DKI, suspends: false, law: 'Закон за инспекцискиот надзор чл. 84 – жалба во рок од 15 дена од приемот', confirm: true, note: 'Одлагањето на извршувањето (ЗОУП чл. 108) да се провери во правната поука на решението – програмата смета дека мерката се извршува.' };

/**
 * Remedies per authority and act. The first entry is the main one (its deadline is the one tracked);
 * further entries are the alternatives the analysis mentions. The deadline written in the act's „правна поука“
 * always prevails — enter it as the inspection's own deadline (`dueOverride`).
 */
export const REMEDIES: Readonly<Record<KontrolaAuth, Partial<Record<KontrolaDoc, readonly Remedy[]>>>> = {
  ujp: {
    zapisnik: [{ name: 'Приговор (забелешки) на записникот', n: 8, unit: 'days', to: 'Управа за јавни приходи – контролорот што го состави записникот', suspends: false, law: 'Закон за даночна постапка, чл. 102 – записникот се доставува со можност за изјаснување (законот не пропишува број на денови; рокот е наведен во записникот)', confirm: true, note: 'Внесете го рокот наведен во записникот. Во рок од 3 месеци од записникот може да се бара и обврзувачко мислење (ЗДП чл. 105).' }],
    reshenie: [{ name: 'Жалба', n: 15, unit: 'days', to: DKZ, suspends: false, law: 'Закон за општата управна постапка чл. 106–107 (15 дена, директно до второстепениот орган); ЗДП чл. 111 ст. 2 – правното средство не го одлага рокот за плаќање', note: 'Данокот се плаќа во рокот од решението (ДДВ: 15 дена, ЗДДВ чл. 43 ст. 3). Може да се бара одлагање на плаќањето до 90 дена (ЗДП чл. 111-а).' }],
    vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: `${ZUS}; ЗДП чл. 176 – тужбата не го одлага извршувањето`, confirm: true }],
    platen: [PLATEN],
  },
  dpi: { zapisnik: [ZIN_REC], reshenie: [ZIN_APPEAL], vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS, confirm: true }], platen: [PLATEN] },
  dit: { zapisnik: [ZIN_REC], reshenie: [{ ...ZIN_APPEAL, law: `${ZIN_APPEAL.law}; Закон за инспекција на трудот (посебен рок – за потврда)` }], vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS, confirm: true }], platen: [PLATEN] },
  ufr: {
    zapisnik: [{ ...ZIN_REC, to: 'Управа за финансиско разузнавање', law: 'Закон за спречување перење пари и финансирање тероризам (супервизија); Закон за инспекцискиот надзор чл. 82 (8 дена)', confirm: true }],
    reshenie: [{ name: 'Жалба / тужба според правната поука', n: 15, unit: 'days', to: 'органот наведен во правната поука', suspends: false, law: 'ЗОУП чл. 106 (15 дена) – ако законот не предвидува жалба, тужба до Управен суд во 30 дена', confirm: true }],
    vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS, confirm: true }],
    platen: [{ ...PLATEN, name: 'Постапка за порамнување / оспорување', to: 'Комисија за одлучување по прекршоци при УФР' }],
  },
  carina: {
    zapisnik: [{ ...ZIN_REC, to: 'Царинска управа', law: 'Царински закон – право на изјаснување пред донесување на одлуката', confirm: true }],
    reshenie: [{ name: 'Жалба', n: 15, unit: 'days', to: 'второстепениот орган наведен во правната поука (преку Царинската управа)', suspends: false, law: 'Царински закон; ЗОУП чл. 106 (15 дена)', confirm: true }],
    vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS, confirm: true }],
    platen: [PLATEN],
  },
  dzlp: {
    zapisnik: [{ ...ZIN_REC, to: 'Агенција за заштита на личните податоци – супервизорот', law: 'ЗЗЛП (Сл. весник 42/2020, 294/2021, 101/2025), чл. 104–107 – записникот се составува во рок од 30 дена по завршување на супервизијата', confirm: true }],
    reshenie: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: 'ЗЗЛП чл. 107 – против решението на Агенцијата нема жалба; тужба до Управен суд во рок од 30 дена' }],
    vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS }],
    platen: [{ ...PLATEN, to: 'Агенција за заштита на личните податоци' }],
  },
  other: {
    zapisnik: [ZIN_REC],
    reshenie: [{ name: 'Жалба', n: 15, unit: 'days', to: 'второстепениот орган', suspends: false, law: 'Закон за општата управна постапка чл. 106 – жалба во рок од 15 дена (ако посебен закон не предвидува подолг рок); чл. 108 – жалбата го одлага извршувањето ако законот не определува поинаку', confirm: true }],
    vtor: [{ name: 'Тужба', n: 30, unit: 'days', to: US, suspends: false, law: ZUS, confirm: true }],
    platen: [PLATEN],
  },
};

export function remediesFor(auth: KontrolaAuth, doc: KontrolaDoc): readonly Remedy[] {
  return REMEDIES[auth][doc] ?? [];
}

export interface KontrolaDeadline { remedy: Remedy; due: string; state: DeadlineState; /** The deadline typed from the act's „правна поука“. */ override?: boolean }

/** The tracked deadlines of an act delivered on `delivered` (null when the delivery date is not known yet). */
export function kontrolaDeadlines(auth: KontrolaAuth, doc: KontrolaDoc, delivered: string | null | undefined, today: string, dueOverride?: string | null): KontrolaDeadline[] {
  const R = remediesFor(auth, doc);
  if (dueOverride && R[0]) return [{ remedy: R[0], due: dueOverride, state: deadlineState(today, dueOverride), override: true }, ...(delivered ? R.slice(1).map((r) => dl(r, delivered, today)) : [])];
  if (!delivered) return [];
  return R.map((r) => dl(r, delivered, today));
}
const dl = (r: Remedy, delivered: string, today: string): KontrolaDeadline => { const due = deadlineFrom(delivered, r.n, r.unit); return { remedy: r, due, state: deadlineState(today, due) }; };

/* ---------------- Findings ---------------- */

export type FindingVerdict = 'correct' | 'partly' | 'incorrect' | 'unclear';
export const VERDICT_LBL: Readonly<Record<FindingVerdict, string>> = { correct: 'Наодот е основан', partly: 'Делумно основан', incorrect: 'Наодот не е основан', unclear: 'Нејасно – потребна проверка' };
export const isVerdict = (x: unknown): x is FindingVerdict => typeof x === 'string' && x in VERDICT_LBL;

export type Recommendation = 'accept' | 'object' | 'partial' | 'review';
export const RECOMMEND_LBL: Readonly<Record<Recommendation, string>> = { accept: 'Прифати', object: 'Приговор / жалба', partial: 'Делумен приговор', review: 'Провери пред рокот' };

export interface Finding {
  no: number;
  area: FindingArea;
  text: string;
  /** Article the authority cites. */
  article?: string | null;
  /** Amounts from the decision (cents): tax / contribution assessed, interest, fine. */
  claimed: number;
  interest?: number;
  fine?: number;
  /** Amount recalculated from our books (cents); null = not recalculated. */
  ours?: number | null;
  verdict?: FindingVerdict | null;
  /** Did the office / the firm act according to the law? */
  officeOk?: boolean | null;
  /** Did the program contribute to the error? */
  systemError?: boolean | null;
  /** Analysis text, with the articles the office relies on. */
  analysis?: string | null;
  /** Explicit recommendation (otherwise derived). */
  recommendation?: Recommendation | null;
}

/** Tolerance for "the same amount" — 1 denar of rounding (ДДВ-04 is filed in whole denars). */
export const AMOUNT_TOLERANCE = 100;

/**
 * Recommendation for one finding:
 * - explicit choice wins;
 * - verdict incorrect → object; partly → partial; correct → accept; unclear → review;
 * - no verdict: our recalculation differs from the decision by more than the tolerance → partial (object to the
 *   difference), same amount → accept, nothing recalculated → review.
 */
export function recommendFinding(f: Finding): Recommendation {
  if (f.recommendation) return f.recommendation;
  switch (f.verdict) {
    case 'incorrect': return 'object';
    case 'partly': return 'partial';
    case 'correct': return 'accept';
    case 'unclear': return 'review';
    default: break;
  }
  if (f.ours == null) return 'review';
  if (Math.abs(f.claimed - f.ours) <= AMOUNT_TOLERANCE) return 'accept';
  return f.ours < f.claimed ? 'partial' : 'accept';
}

/** Amount the office disputes for a finding (cents ≥ 0). */
export function disputedOf(f: Finding): number {
  const r = recommendFinding(f);
  if (r === 'object') return f.claimed + (f.interest ?? 0) + (f.fine ?? 0);
  if (r === 'partial') return f.ours != null ? Math.max(0, f.claimed - f.ours) : 0;
  return 0;
}

export interface KontrolaSummary {
  n: number;
  claimed: number; interest: number; fine: number; total: number;
  /** Sum of our recalculations over the findings that have one, and the decision's amounts for the same findings. */
  ours: number; claimedRecalc: number; diff: number;
  disputed: number;
  accepted: number;
  byVerdict: Record<FindingVerdict | 'none', number>;
  byRec: Record<Recommendation, number>;
  officeFault: number;
  systemErrors: number;
  overall: Recommendation;
}

export function kontrolaSummary(F: readonly Finding[]): KontrolaSummary {
  const byVerdict: KontrolaSummary['byVerdict'] = { correct: 0, partly: 0, incorrect: 0, unclear: 0, none: 0 };
  const byRec: KontrolaSummary['byRec'] = { accept: 0, object: 0, partial: 0, review: 0 };
  for (const f of F) { byVerdict[f.verdict ?? 'none']++; byRec[recommendFinding(f)]++; }
  const claimed = sumCents(F.map((f) => f.claimed));
  const interest = sumCents(F.map((f) => f.interest ?? 0));
  const fine = sumCents(F.map((f) => f.fine ?? 0));
  const R = F.filter((f) => f.ours != null);
  const ours = sumCents(R.map((f) => f.ours!));
  const claimedRecalc = sumCents(R.map((f) => f.claimed));
  const disputed = sumCents(F.map(disputedOf));
  const total = claimed + interest + fine;
  const overall: Recommendation = !F.length ? 'review'
    : byRec.object === F.length ? 'object'
      : byRec.object || byRec.partial ? 'partial'
        : byRec.review ? 'review' : 'accept';
  return {
    n: F.length, claimed, interest, fine, total, ours, claimedRecalc, diff: claimedRecalc - ours, disputed, accepted: total - disputed,
    byVerdict, byRec, officeFault: F.filter((f) => f.officeOk === false).length, systemErrors: F.filter((f) => f.systemError === true).length, overall,
  };
}

/* ---------------- Draft of the objection / appeal ---------------- */

export interface DraftInput {
  auth: KontrolaAuth;
  doc: KontrolaDoc;
  docNo?: string | null;
  docDate?: string | null;
  delivered?: string | null;
  dueOverride?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  subject?: string | null;
  firm: { name: string; edb?: string | null; address?: string | null; city?: string | null; manager?: string | null };
  office?: { name?: string | null; city?: string | null } | null;
  findings: readonly Finding[];
  today: string;
}

export interface DraftDoc { title: string; to: string; blocks: { h?: string; p: string[] }[]; remedy: Remedy | null; deadline: string | null }

const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '___');
const den = (c: number) => `${fmtCents(c)} ден.`;

/**
 * The Macedonian draft of the main remedy (приговор на записник / жалба / тужба) against the act, listing only the
 * findings the office disputes (object / partial), each with the authority's claim, the office's analysis and the
 * amount from the books. The office edits and signs it; the program never files anything.
 */
export function kontrolaObjectionDraft(x: DraftInput): DraftDoc {
  const remedy = remediesFor(x.auth, x.doc)[0] ?? null;
  const deadline = x.dueOverride ?? (remedy && x.delivered ? deadlineFrom(x.delivered, remedy.n, remedy.unit) : null);
  const S = kontrolaSummary(x.findings);
  const disputed = x.findings.filter((f) => ['object', 'partial'].includes(recommendFinding(f)));
  const act = `${KONTROLA_DOC[x.doc].toLowerCase()}${x.docNo ? ` бр. ${x.docNo}` : ''} од ${dmy(x.docDate)}`;
  const title = (remedy?.name ?? 'Поднесок').toUpperCase();
  const blocks: DraftDoc['blocks'] = [];
  blocks.push({ p: [
    `Подносител: ${x.firm.name}${x.firm.edb ? `, ЕДБ ${x.firm.edb}` : ''}${x.firm.address || x.firm.city ? `, ${[x.firm.address, x.firm.city].filter(Boolean).join(', ')}` : ''}${x.firm.manager ? `, застапувано од управителот ${x.firm.manager}` : ''}.`,
    `Предмет: ${remedy?.name ?? 'поднесок'} против ${act} на ${KONTROLA_AUTH[x.auth]}${x.periodFrom || x.periodTo ? `, за контролираниот период ${dmy(x.periodFrom)}–${dmy(x.periodTo)}` : ''}${x.delivered ? `, примен на ${dmy(x.delivered)}` : ''}.`,
  ] });
  blocks.push({ h: 'Навременост', p: [
    remedy && deadline
      ? `${remedy.name} се поднесува во рокот${x.dueOverride ? ' наведен во правната поука' : ` од ${remedy.n} ${remedy.unit === 'workdays' ? 'работни дена' : remedy.unit === 'months' ? 'месеци' : 'дена'} од приемот`}, најдоцна до ${dmy(deadline)} (${remedy.law}).`
      : 'Поднесокот се поднесува во законскиот рок.',
  ] });
  blocks.push({ h: 'Образложение', p: disputed.length
    ? disputed.flatMap((f) => {
      const r = recommendFinding(f);
      const P = [`${f.no}. Наод: ${f.text}${f.article ? ` (повикување на ${f.article})` : ''}. Утврден износ: ${den(f.claimed)}${f.interest ? `, камата ${den(f.interest)}` : ''}${f.fine ? `, глоба ${den(f.fine)}` : ''}.`];
      if (f.analysis) P.push(`Наодот ${r === 'object' ? 'не е основан' : 'е делумно основан'}: ${f.analysis}`);
      if (f.ours != null) P.push(`Според деловните книги и евиденциите на подносителот износот изнесува ${den(f.ours)}, односно разликата од ${den(Math.max(0, f.claimed - f.ours))} е неосновано утврдена.`);
      return P;
    })
    : ['Подносителот ги прифаќа наодите.'] });
  blocks.push({ h: 'Предлог', p: [
    x.doc === 'zapisnik'
      ? `Предлагаме наодите под точка ${disputed.map((f) => f.no).join(', ') || '—'} да се изменат согласно изнесеното и доказите во прилог, пред да се донесе решение.`
      : `Предлагаме ${remedy?.to.includes('Суд') ? 'Управниот суд да го поништи' : 'второстепениот орган да го поништи / измени'} актот во делот на наодите под точка ${disputed.map((f) => f.no).join(', ') || '—'} и предметот да се врати на повторно постапување.`,
    `Оспорен износ: ${den(S.disputed)} од вкупно утврдени ${den(S.total)}.`,
    ...(remedy && !remedy.suspends && x.doc !== 'zapisnik' ? ['Напомена: поднесувањето не го одлага извршувањето; подносителот го задржува правото да бара одлагање на извршувањето.'] : []),
  ] });
  blocks.push({ h: 'Прилози', p: ['1. Копија од актот што се оспорува', '2. Извод од деловните книги и евиденциите за контролираниот период (од програмата)', '3. Други докази наведени во образложението'] });
  blocks.push({ p: [`${x.office?.city || x.firm.city || '__________'}, ${dmy(x.today)}`, `За ${x.firm.name}`, '_____________________ (потпис и печат)'] });
  return { title, to: remedy?.to ?? KONTROLA_AUTH[x.auth], blocks, remedy, deadline };
}

/* ---------------- AI read ---------------- */

/** Prompt of the `kontrola` AI read (worker kind `kontrola`): the record / decision → structured findings. */
export const KONTROLA_PROMPT = `You read an official record (записник) or decision (решение) of a North Macedonian authority (УЈП, Државен пазарен инспекторат, Државен инспекторат за труд, УФР, Царинска управа, Агенција за заштита на личните податоци) issued to a company after an inspection.
Return ONLY JSON:
{"auth":"ujp|dpi|dit|ufr|carina|dzlp|other","doc":"zapisnik|reshenie|vtor|platen|zakl","docNo":"","docDate":"YYYY-MM-DD","periodFrom":"YYYY-MM-DD","periodTo":"YYYY-MM-DD","subject":"short subject",
 "findings":[{"no":1,"area":"vat|cit|pit|contrib|payroll|invoice|books|cash|fiscal|labour|market|aml|gdpr|customs|other","text":"the finding in Macedonian, concise","article":"article and law cited by the authority","claimed":"0.00","interest":"0.00","fine":"0.00"}]}
Rules: amounts as plain decimal strings with a dot (1234.56), "0.00" when none; one entry per distinct finding/irregularity; keep the authority's own wording for the finding; dates as YYYY-MM-DD or "" when absent; do not invent findings or amounts.`;

export interface KontrolaAiResult {
  auth?: string; doc?: string; docNo?: string; docDate?: string; periodFrom?: string; periodTo?: string; subject?: string;
  findings?: { no?: number; area?: string; text?: string; article?: string; claimed?: string | number; interest?: string | number; fine?: string | number }[];
}
