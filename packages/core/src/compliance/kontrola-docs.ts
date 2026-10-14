/**
 * „🧾 Подготви приговор / жалба“ — the documents of a disputed inspection case, built from the case data only
 * (free, deterministic):
 *
 * - `chooseSubmission` — which external document fits the act and the stage (забелешки на записник / приговор /
 *   жалба / тужба), to whom, the deadline and the days left; anything the program could not confirm is „за проверка“;
 * - `kontrolaSubmission` — the external document in the formal Macedonian structure (header, предмет, барање,
 *   образложение per disputed finding with our books' amounts, evidence and legal basis, заклучок, прилози,
 *   place / date, signature and stamp blocks). Only findings the office disputes (оспори / делумно) are argued;
 *   accepted ones are acknowledged in one sentence;
 * - `kontrolaInternal` — the office's internal analysis (never shown in the client portal): per finding the claim,
 *   our books vs the decision, who changed the related records, the cause, risk (chance, amount at stake),
 *   recommendation and a task list;
 * - versions kept in the case (`data.versions`) and the client-safe view of the case data;
 * - the optional paid „💲 AI правна анализа“: the law context from the program's law store, the prompt, and the
 *   parser that checks every article the model cites against that store („треба да се провери“ otherwise).
 * Amounts are integer cents.
 */
import { fmtCents, sumCents } from './cents';
import { daysLeft as daysBetween, deadlineFrom } from './deadlines';
import {
  disputedOf, FINDING_AREA, KONTROLA_AUTH, KONTROLA_DOC, recommendFinding, RECOMMEND_LBL, remediesFor, VERDICT_LBL,
  type Finding, type KontrolaAuth, type KontrolaDoc, type Recommendation, type Remedy,
} from './kontrola';

/* ====================================================================================================== */
/* Which document                                                                                          */
/* ====================================================================================================== */

export const SUBMISSION_LBL = {
  zabeleski: 'Забелешки на записник',
  prigovor: 'Приговор',
  zhalba: 'Жалба',
  tuzhba: 'Тужба',
} as const;
export type SubmissionType = keyof typeof SUBMISSION_LBL;
export const isSubmissionType = (x: unknown): x is SubmissionType => typeof x === 'string' && x in SUBMISSION_LBL;

export interface SubmissionChoice {
  type: SubmissionType;
  /** Chosen by the program (false = the office picked another type). */
  auto: boolean;
  title: string;
  to: string;
  remedy: Remedy | null;
  deadline: string | null;
  daysLeft: number | null;
  /** Why this document (shown in the callout). */
  reason: string;
  /** Remedy / deadline / addressee the program could not confirm — „за проверка“ in the act's „правна поука“. */
  verify: boolean;
}

const US = 'Управен суд';

/** The document that fits the act: record → remarks, first-instance decision → appeal (АЗЛП: lawsuit), second instance → lawsuit, payment order / conclusion → objection. */
export function submissionTypeFor(auth: KontrolaAuth, doc: KontrolaDoc): SubmissionType {
  if (doc === 'zapisnik') return 'zabeleski';
  if (doc === 'vtor') return 'tuzhba';
  if (doc === 'reshenie') return remediesFor(auth, doc)[0]?.name === 'Тужба' ? 'tuzhba' : 'zhalba';
  return 'prigovor';
}

const REASON: Record<SubmissionType, string> = {
  zabeleski: 'Записникот уште не е решение – наодите се оспоруваат со забелешки (изјаснување) пред да се донесе решението.',
  zhalba: 'Против првостепеното решение правно средство е жалба до второстепениот орган.',
  tuzhba: 'Против конечниот (второстепен) акт се поведува управен спор со тужба до Управниот суд.',
  prigovor: 'Против платниот налог / заклучокот – приговор (оспорување) до органот што го издал актот.',
};

export function chooseSubmission(x: { auth: KontrolaAuth; doc: KontrolaDoc; delivered?: string | null; dueOverride?: string | null; today: string; override?: SubmissionType | null }): SubmissionChoice {
  const auto = submissionTypeFor(x.auth, x.doc);
  const type = x.override && isSubmissionType(x.override) ? x.override : auto;
  const R = remediesFor(x.auth, x.doc);
  // the remedy of the act when the type matches it; otherwise (the office chose another type) no tracked deadline from the table
  const remedy = type === auto ? R[0] ?? null : null;
  const deadline = x.dueOverride ?? (remedy && x.delivered ? deadlineFrom(x.delivered, remedy.n, remedy.unit) : null);
  const to = type === 'tuzhba' ? (remedy?.to ?? `${US} (управен спор)`)
    : type === 'zabeleski' || type === 'prigovor' ? (remedy?.to ?? KONTROLA_AUTH[x.auth])
      : (remedy?.to ?? 'второстепениот орган наведен во правната поука');
  const verify = !x.dueOverride && (!remedy || !!remedy.confirm || type !== auto);
  return {
    type, auto: type === auto, title: SUBMISSION_LBL[type].toUpperCase(), to, remedy, deadline,
    daysLeft: deadline ? daysBetween(x.today, deadline) : null,
    reason: type === auto ? REASON[type] : `Избрано рачно (програмата предлага: ${SUBMISSION_LBL[auto]}).`,
    verify,
  };
}

/** „за 5 дена“ / „денес“ / „истечен пред 2 дена“. */
export function daysLeftText(n: number | null): string {
  if (n == null) return 'рокот не е пресметан (внесете датум на прием)';
  if (n === 0) return 'истекува ДЕНЕС';
  if (n < 0) return `рокот истекол пред ${-n} ${-n === 1 ? 'ден' : 'дена'}`;
  return `уште ${n} ${n === 1 ? 'ден' : 'дена'}`;
}

/* ====================================================================================================== */
/* Input                                                                                                   */
/* ====================================================================================================== */

export interface AuditBrief { n: number; users: { name: string; n: number }[]; first: string | null; last: string | null }

export interface CaseItem {
  f: Finding;
  /** Documents from our books for the controlled period: journal numbers, invoices, statements, payroll, ДДВ-04. */
  refs?: readonly string[];
  /** Where our amount comes from (`oursSource`). */
  oursSource?: string | null;
  checks?: readonly { s: 'ok' | 'warn' | 'bad'; txt: string }[];
  audit?: AuditBrief | null;
}

export interface CaseInput {
  auth: KontrolaAuth;
  doc: KontrolaDoc;
  docNo?: string | null;
  docDate?: string | null;
  delivered?: string | null;
  dueOverride?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  subject?: string | null;
  firm: { name: string; edb?: string | null; embs?: string | null; address?: string | null; city?: string | null; manager?: string | null };
  /** The accounting office as полномошник (when its profile has a name). */
  office?: { name?: string | null; edb?: string | null; address?: string | null; city?: string | null; rep?: string | null } | null;
  items: readonly CaseItem[];
  today: string;
  /** The type the office picked instead of the program's choice. */
  override?: SubmissionType | null;
}

export interface DocSection { h?: string; p: string[]; center?: boolean }
export interface CaseDoc { kind: 'external' | 'internal'; title: string; sections: DocSection[]; choice: SubmissionChoice; verify: string[] }

const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '___');
const den = (c: number) => `${fmtCents(c)} ден.`;
export const isDisputed = (f: Finding) => { const r = recommendFinding(f); return r === 'object' || r === 'partial'; };
const actName = (x: Pick<CaseInput, 'doc' | 'docNo' | 'docDate'>) => `${KONTROLA_DOC[x.doc].toLowerCase()}${x.docNo ? ` бр. ${x.docNo}` : ''} од ${dmy(x.docDate)}`;

/* ====================================================================================================== */
/* External document                                                                                       */
/* ====================================================================================================== */

/** Per finding: the reasoning paragraphs (the AI analysis may replace the „our position“ part). */
export function findingReasoning(it: CaseItem, positionOverride?: string | null): string[] {
  const f = it.f;
  const partial = recommendFinding(f) === 'partial';
  const P: string[] = [];
  P.push(`Наод на органот: ${f.text}${f.article ? ` (органот се повикува на ${f.article})` : ''}. Утврдено: ${den(f.claimed)}${f.interest ? `, камата ${den(f.interest)}` : ''}${f.fine ? `, глоба ${den(f.fine)}` : ''}.`);
  if (f.ours != null) {
    const diff = f.claimed - f.ours;
    P.push(`Факти од деловните книги: за контролираниот период износот изнесува ${den(f.ours)}${it.oursSource ? ` (${it.oursSource})` : ''}${diff > 0 ? `, односно ${den(diff)} помалку од утврденото во актот` : diff < 0 ? `, односно ${den(-diff)} повеќе од утврденото – разликата не се оспорува` : ''}.`);
  }
  if (it.refs?.length) P.push(`Докази: ${it.refs.join('; ')}.`);
  const pos = positionOverride?.trim() || f.analysis?.trim();
  P.push(`Наш став: наодот ${partial ? 'е делумно основан' : 'не е основан'}${pos ? ` – ${pos.replace(/\s*\.?$/, '')}` : ''}.`);
  return P;
}

/** The legal basis we rely on: the articles cited in the finding and in our analysis. */
function legalBasis(items: readonly CaseItem[]): string[] {
  const S = new Set<string>();
  for (const it of items) {
    if (it.f.article) S.add(`${it.f.article} (наведен во актот)`);
    for (const r of lawRefsOf(it.f.analysis ?? '')) S.add(refLabel(r));
  }
  return [...S];
}

export interface SubmissionAiPatch {
  /** Per finding no: our position / argument (AI, accepted by the user). */
  reasoning?: Record<number, string>;
  procedural?: string[];
  conclusion?: string | null;
}

export function kontrolaSubmission(x: CaseInput, ai?: SubmissionAiPatch | null): CaseDoc {
  const ch = chooseSubmission(x);
  const disputed = x.items.filter((it) => isDisputed(it.f));
  const accepted = x.items.filter((it) => recommendFinding(it.f) === 'accept');
  const total = sumCents(x.items.map((it) => it.f.claimed + (it.f.interest ?? 0) + (it.f.fine ?? 0)));
  const disp = sumCents(x.items.map((it) => disputedOf(it.f)));
  const nos = disputed.map((it) => it.f.no).join(', ') || '—';
  const firmLine = [
    x.firm.name, x.firm.edb ? `ЕДБ ${x.firm.edb}` : null, x.firm.embs ? `ЕМБС ${x.firm.embs}` : null,
    [x.firm.address, x.firm.city].filter(Boolean).join(', ') || null,
  ].filter(Boolean).join(', ');
  const officeName = x.office?.name?.trim();
  const S: DocSection[] = [];
  S.push({ p: [
    `До: ${ch.to}`,
    `Орган што го донел актот: ${KONTROLA_AUTH[x.auth]}`,
    ...(ch.type === 'zhalba' ? [`Преку: ${KONTROLA_AUTH[x.auth]} (првостепениот орган)`] : []),
    `Акт: ${KONTROLA_DOC[x.doc]}${x.docNo ? ` бр. ${x.docNo}` : ''} од ${dmy(x.docDate)}${x.delivered ? `, примен на ${dmy(x.delivered)}` : ''}`,
    `Подносител: ${firmLine}${x.firm.manager ? `, застапуван од управителот ${x.firm.manager}` : ''}`,
    ...(officeName ? [`Полномошник: ${[officeName, x.office?.edb ? `ЕДБ ${x.office.edb}` : null, [x.office?.address, x.office?.city].filter(Boolean).join(', ') || null].filter(Boolean).join(', ')} (по полномошно во прилог)`] : []),
  ] });
  S.push({ center: true, p: [ch.title] });
  S.push({ h: 'Предмет', p: [`${SUBMISSION_LBL[ch.type]} против ${actName(x)} на ${KONTROLA_AUTH[x.auth]}${x.subject ? ` (${x.subject})` : ''}${x.periodFrom || x.periodTo ? `, за контролираниот период ${dmy(x.periodFrom)}–${dmy(x.periodTo)}` : ''}.`] });
  const ask = ch.type === 'zabeleski'
    ? `Наодите под точка ${nos} од записникот да се преиспитаат и изменат согласно изнесеното и доказите во прилог, пред да се донесе решение.`
    : ch.type === 'tuzhba'
      ? `Управниот суд да ја уважи тужбата и да го поништи оспорениот акт во делот на наодите под точка ${nos} и предметот да го врати на повторно одлучување.`
      : ch.type === 'zhalba'
        ? `Второстепениот орган да ја уважи жалбата и решението во делот на наодите под точка ${nos} да го поништи, односно измени, или предметот да го врати на повторна постапка.`
        : `Актот да се преиспита и да се стави вон сила, односно измени во делот на наодите под точка ${nos}.`;
  S.push({ h: 'Барање', p: [ask, `Оспорен износ: ${den(disp)} од вкупно утврдени ${den(total)}.`] });
  S.push({ h: 'Навременост', p: [ch.deadline
    ? `${SUBMISSION_LBL[ch.type]} се поднесува во рок${x.dueOverride ? 'от наведен во правната поука' : ch.remedy ? ` од ${ch.remedy.n} ${ch.remedy.unit === 'workdays' ? 'работни дена' : ch.remedy.unit === 'months' ? 'месеци' : 'дена'} од приемот` : ''}, најдоцна до ${dmy(ch.deadline)}${ch.remedy ? ` (${ch.remedy.law})` : ''}.`
    : `${SUBMISSION_LBL[ch.type]} се поднесува во рокот од правната поука на актот.`] });
  const body: string[] = [];
  disputed.forEach((it, i) => { body.push(`${i + 1}. Наод под точка ${it.f.no} (${FINDING_AREA[it.f.area]})`); body.push(...findingReasoning(it, ai?.reasoning?.[it.f.no])); });
  if (!disputed.length) body.push('Подносителот не оспорува ниту еден наод.');
  if (accepted.length) body.push(`Наодите под точка ${accepted.map((it) => it.f.no).join(', ')} подносителот ги прифаќа и не се предмет на ${SUBMISSION_LBL[ch.type].toLowerCase()}.`);
  S.push({ h: 'Образложение', p: body });
  if (ai?.procedural?.length) S.push({ h: 'Процесни наводи', p: ai.procedural });
  const basis = legalBasis(disputed);
  S.push({ h: 'Правен основ', p: basis.length ? basis : ['Членовите на кои се повикува органот и релевантните одредби од законот (да се дополнат).'] });
  S.push({ h: 'Заклучок', p: [ai?.conclusion?.trim() || `Од изнесените факти и доказите во прилог произлегува дека наодите под точка ${nos} не се утврдени правилно и целосно. Поради тоа предлагаме ${ch.type === 'zabeleski' ? 'записникот да се дополни и измени' : ch.type === 'tuzhba' ? 'тужбата да се уважи' : ch.type === 'zhalba' ? 'жалбата да се уважи' : 'приговорот да се уважи'} како во барањето.`,
    ...(ch.remedy && !ch.remedy.suspends && x.doc !== 'zapisnik' ? ['Напомена: поднесувањето не го одлага плаќањето / извршувањето; подносителот го задржува правото да бара одлагање.'] : [])] });
  const att = ['Копија од актот што се оспорува'];
  for (const it of disputed) for (const r of it.refs ?? []) att.push(r);
  att.push('Извод од деловните книги за контролираниот период (картици, налози)');
  if (officeName) att.push('Полномошно');
  S.push({ h: 'Прилози', p: [...new Set(att)].map((a, i) => `${i + 1}. ${a}`) });
  S.push({ p: [`${x.firm.city || x.office?.city || '__________'}, ${dmy(x.today)}`] });
  S.push({ p: [
    `Подносител: ${x.firm.name}`, `${x.firm.manager ? `${x.firm.manager}, управител` : 'Управител'}  _____________________   М.П.`,
    ...(officeName ? [`Полномошник: ${officeName}${x.office?.rep ? `, ${x.office.rep}` : ''}  _____________________   М.П.`] : []),
  ] });
  const verify: string[] = [];
  if (ch.verify) verify.push(`Правното средство, органот до кој се поднесува и рокот се ЗА ПРОВЕРКА во правната поука на актот${ch.remedy ? ` (${ch.remedy.law})` : ''}.`);
  return { kind: 'external', title: ch.title, sections: S, choice: ch, verify };
}

/* ====================================================================================================== */
/* Internal analysis                                                                                       */
/* ====================================================================================================== */

export interface FindingRisk { chance: number; level: 'висока' | 'средна' | 'ниска' | '—'; atStake: number; disputed: number }

/** The program's estimate of the chance to succeed for one finding (percent, 0 for accepted findings). */
export function findingRisk(f: Finding): FindingRisk {
  const atStake = f.claimed + (f.interest ?? 0) + (f.fine ?? 0);
  const disputed = disputedOf(f);
  const r = recommendFinding(f);
  if (r === 'accept') return { chance: 0, level: '—', atStake, disputed: 0 };
  let c = f.verdict === 'incorrect' || r === 'object' ? (f.ours != null ? 70 : 55) : f.verdict === 'partly' || r === 'partial' ? 50 : 30;
  if (f.officeOk === false) c -= 25;
  if (f.systemError === true) c -= 10;
  if (f.ours != null && f.claimed - f.ours > 0 && r === 'partial') c += 10;
  c = Math.max(5, Math.min(90, c));
  return { chance: c, level: c >= 60 ? 'висока' : c >= 35 ? 'средна' : 'ниска', atStake, disputed };
}

export interface SuggestedTask { text: string; findingNo: number | null; due: string | null; owner: string }

const minDate = (a: string | null, b: string) => (a && a < b ? a : b);
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Recommendation text for one finding (incl. paying half of the fine within 8 days where the act is a payment order). */
export function findingAdvice(f: Finding, doc: KontrolaDoc): string {
  const r = recommendFinding(f);
  const halfFine = (f.fine ?? 0) > 0 && doc === 'platen';
  if (r === 'accept') return halfFine ? `Прифати и плати ја половината од глобата (${den(Math.round((f.fine ?? 0) / 2))}) во рок од 8 дена од приемот (Закон за прекршоците – за проверка).` : 'Прифати – плати / постапи во рокот од актот.';
  if (r === 'review') return 'Провери пред рокот: недостасуваат факти од книгите или оценка.';
  const base = r === 'object' ? (doc === 'zapisnik' ? 'Оспори со забелешки на записникот.' : doc === 'vtor' ? 'Оспори со тужба до Управниот суд.' : 'Оспори со жалба / приговор.') : 'Делумно оспори – само разликата според книгите.';
  return halfFine ? `${base} Алтернатива: плаќање на половина од глобата во 8 дена (тогаш нема оспорување на глобата – за проверка).` : base;
}

export function suggestTasks(x: CaseInput, ch: SubmissionChoice): SuggestedTask[] {
  const T: SuggestedTask[] = [];
  const due = ch.deadline;
  const before = (n: number) => (due ? (addDays(due, -n) < x.today ? x.today : addDays(due, -n)) : null);
  const disputed = x.items.filter((it) => isDisputed(it.f));
  if (disputed.length) T.push({ text: `Подготви, потпиши и поднеси: ${SUBMISSION_LBL[ch.type]}${due ? ` (рок ${dmy(due)})` : ''}`, findingNo: null, due: before(1), owner: 'канцеларија' });
  for (const it of disputed) T.push({ text: `Собери докази за наод ${it.f.no}${it.refs?.length ? `: ${it.refs.slice(0, 3).join('; ')}${it.refs.length > 3 ? '…' : ''}` : ' (картици, налози, фактури, изводи)'}`, findingNo: it.f.no, due: before(3), owner: 'канцеларија' });
  for (const it of x.items) {
    const f = it.f;
    if (recommendFinding(f) === 'accept' && f.claimed + (f.interest ?? 0) + (f.fine ?? 0) > 0) {
      const halfFine = (f.fine ?? 0) > 0 && x.doc === 'platen';
      T.push({ text: halfFine ? `Плати половина од глобата за наод ${f.no} (${den(Math.round((f.fine ?? 0) / 2))})` : `Плати го утврдениот износ за наод ${f.no} (${den(f.claimed + (f.interest ?? 0) + (f.fine ?? 0))})`, findingNo: f.no, due: halfFine && x.delivered ? minDate(due, addDays(x.delivered, 8)) : due, owner: 'клиент' });
    }
    if (f.officeOk === false) T.push({ text: `Корективно книжење / исправка на пријавата за наод ${f.no} и внатрешна постапка за да не се повтори`, findingNo: f.no, due: before(0), owner: 'канцеларија' });
    if (f.systemError === true) T.push({ text: `Пријави ја грешката во програмата (наод ${f.no}) и провери ги другите фирми за истиот проблем`, findingNo: f.no, due: x.today, owner: 'канцеларија' });
  }
  return T;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export interface InternalAiPatch { perFinding?: Record<number, string[]>; summary?: string | null }

export function kontrolaInternal(x: CaseInput, ai?: InternalAiPatch | null): CaseDoc {
  const ch = chooseSubmission(x);
  const S: DocSection[] = [];
  const R = x.items.map((it) => findingRisk(it.f));
  const total = sumCents(R.map((r) => r.atStake));
  const disp = sumCents(R.map((r) => r.disputed));
  const expected = sumCents(R.map((r) => Math.round((r.disputed * r.chance) / 100)));
  S.push({ center: true, p: ['ВНАТРЕШНА АНАЛИЗА – само за канцеларијата (не се доставува, не е видлива во порталот)'] });
  S.push({ p: [
    `${x.firm.name}${x.firm.edb ? `, ЕДБ ${x.firm.edb}` : ''}`,
    `${KONTROLA_DOC[x.doc]}${x.docNo ? ` бр. ${x.docNo}` : ''} од ${dmy(x.docDate)}, ${KONTROLA_AUTH[x.auth]}; примен ${dmy(x.delivered)}; контролиран период ${dmy(x.periodFrom)}–${dmy(x.periodTo)}.`,
    `Документ: ${SUBMISSION_LBL[ch.type]} до ${ch.to}; рок ${ch.deadline ? dmy(ch.deadline) : '—'} (${daysLeftText(ch.daysLeft)})${ch.verify ? ' – ЗА ПРОВЕРКА во правната поука' : ''}.`,
    `Во игра: ${den(total)} (данок/придонес + камата + глоба); оспорено ${den(disp)}; очекувано намалување според проценката ${den(expected)}`,
    ...(ai?.summary ? [`AI оценка (прифатена од корисникот): ${ai.summary}`] : []),
  ] });
  x.items.forEach((it, i) => {
    const f = it.f;
    const r = R[i]!;
    const P: string[] = [];
    P.push(`Тврдење на инспекторот: ${f.text}${f.article ? ` (${f.article})` : ''}.`);
    P.push(`Решение: ${den(f.claimed)}${f.interest ? ` + камата ${den(f.interest)}` : ''}${f.fine ? ` + глоба ${den(f.fine)}` : ''}; според нашите книги: ${f.ours == null ? '— (не е пресметано)' : den(f.ours)}${f.ours != null ? `; разлика ${den(f.claimed - f.ours)}` : ''}${it.oursSource ? ` (${it.oursSource})` : ''}.`);
    if (it.refs?.length) P.push(`Документи: ${it.refs.join('; ')}.`);
    const a = it.audit;
    P.push(`Кој / кога ги внесувал или менувал поврзаните документи: ${a && a.n ? `${a.n} промени во периодот – ${a.users.map((u) => `${u.name} (${u.n})`).join(', ')}; од ${dmy(a.first)} до ${dmy(a.last)}` : 'нема промени во програмата во контролираниот период'}.`);
    for (const c of it.checks ?? []) P.push(`Проверка на програмата: ${c.s === 'ok' ? '✓' : c.s === 'warn' ? '⚠' : '✗'} ${c.txt}`);
    P.push(`Причина: ${f.systemError ? 'програмата придонела за грешката' : f.systemError === false ? 'програмата не ја предизвикала грешката' : 'програмата – не е оценето'}; ${f.officeOk === false ? 'канцеларијата / фирмата не постапила според закон' : f.officeOk ? 'канцеларијата / фирмата постапила според закон' : 'постапувањето не е оценето'}.`);
    P.push(`Оценка: ${f.verdict ? VERDICT_LBL[f.verdict] : 'не е оценето'}. Ризик: шанса за успех ${r.level === '—' ? '— (не се оспорува)' : `${r.chance}% (${r.level}) – проценка на програмата`}; во игра ${den(r.atStake)}, оспорено ${den(r.disputed)}`);
    P.push(`Препорака: ${RECOMMEND_LBL[recommendFinding(f)]} – ${lower(findingAdvice(f, x.doc))}`);
    for (const t of ai?.perFinding?.[f.no] ?? []) P.push(`AI: ${t}`);
    S.push({ h: `${f.no}. ${FINDING_AREA[f.area]}${isDisputed(f) ? ' – ОСПОРЕНО' : ''}`, p: P });
  });
  const T = suggestTasks(x, ch);
  S.push({ h: 'Листа на задачи', p: T.length ? T.map((t, i) => `${i + 1}. ${t.text} – одговорен: ${t.owner}; рок ${t.due ? dmy(t.due) : '—'}`) : ['Нема предложени задачи.'] });
  return { kind: 'internal', title: 'ВНАТРЕШНА АНАЛИЗА', sections: S, choice: ch, verify: ch.verify ? ['Правното средство и рокот – ЗА ПРОВЕРКА во правната поука.'] : [] };
}

/* ====================================================================================================== */
/* Rendering                                                                                               */
/* ====================================================================================================== */

/** Plain-text lines (edit box, versions, Word fallback). */
export function docText(d: CaseDoc): string {
  const L: string[] = [];
  for (const s of d.sections) {
    if (s.h) L.push(s.h.toUpperCase());
    L.push(...s.p, '');
  }
  if (d.verify.length) L.push('ЗА ПРОВЕРКА:', ...d.verify);
  return L.join('\n').trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML of the document (print / PDF / Word via `htmlDocx`). */
export function docHtml(d: CaseDoc): string {
  return d.sections.map((s) => `${s.h ? `<p><b>${esc(s.h.toUpperCase())}</b></p>` : ''}${s.p.map((p) => (s.center ? `<h3 style="text-align:center">${esc(p)}</h3>` : `<p>${esc(p)}</p>`)).join('')}`).join('')
    + (d.verify.length ? `<p><b>ЗА ПРОВЕРКА:</b></p>${d.verify.map((v) => `<p>${esc(v)}</p>`).join('')}` : '');
}

/** HTML of an edited plain text: an all-capitals line is a bold heading. */
export function textHtml(t: string): string {
  return t.split(/\r?\n/).map((l) => (l.trim() && l === l.toUpperCase() && /[А-ЯЀ-Џ]/.test(l) ? `<p><b>${esc(l)}</b></p>` : `<p>${esc(l) || '&nbsp;'}</p>`)).join('');
}

/* ====================================================================================================== */
/* Versions (data.versions) and the client-safe view                                                       */
/* ====================================================================================================== */

export interface KontrolaVersion {
  id: string;
  at: string;
  /** auto = generated after a change; edit = the user's text; ai = „💲 AI правна анализа“. */
  kind: 'auto' | 'edit' | 'ai';
  type: SubmissionType;
  external: string;
  internal: string;
  hash: string;
  by?: string | null;
  model?: string | null;
  costUsd?: number | null;
  ai?: KontrolaAiAnalysis | null;
  /** AI version: accepted into the case text / discarded. */
  state?: 'new' | 'accepted' | 'discarded';
}

/** FNV-1a of the texts (detects „nothing changed“ without crypto). */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const MAX_VERSIONS = 40;

/** Append a version; an `auto` version identical to the newest auto version is not stored again. Oldest auto versions drop first. */
export function addVersion(list: readonly KontrolaVersion[] | undefined, v: Omit<KontrolaVersion, 'hash'>): { list: KontrolaVersion[]; added: boolean } {
  const L = [...(list ?? [])];
  const hash = textHash(`${v.type}\n${v.external}\n${v.internal}`);
  if (v.kind === 'auto') {
    const last = [...L].reverse().find((x) => x.kind === 'auto');
    if (last?.hash === hash) return { list: L, added: false };
  }
  L.push({ ...v, hash });
  while (L.length > MAX_VERSIONS) {
    const i = L.findIndex((x) => x.kind === 'auto');
    L.splice(i >= 0 ? i : 0, 1);
  }
  return { list: L, added: true };
}

export const versionsOf = (data: unknown): KontrolaVersion[] => {
  const v = (data as { versions?: unknown } | null)?.versions;
  return Array.isArray(v) ? (v as KontrolaVersion[]) : [];
};

/**
 * What of the case data a client (portal) may receive: nothing of the office's work — no drafts, no versions,
 * no internal analysis, no AI, no reads. The portal shows only the act's header, findings and deadline (the days of
 * the „правна поука“, `remedy`, are kept for it).
 */
export function kontrolaClientData(data: unknown): { remedy?: { n: number; unit: string } } {
  const r = (data as { remedy?: { n?: unknown; unit?: unknown } } | null)?.remedy;
  return r && typeof r.n === 'number' ? { remedy: { n: r.n, unit: r.unit === 'workdays' ? 'workdays' : 'days' } } : {};
}

/* ====================================================================================================== */
/* Law references and the law store context                                                                */
/* ====================================================================================================== */

/** Laws the program recognises in citations (code → how it is written). */
export const LAW_ALIASES: readonly [code: string, label: string, re: RegExp][] = [
  ['ZDDV', 'ЗДДВ', /ЗДДВ|данокот на додадена вредност|данок на додадена вредност/i],
  ['ZDD', 'ЗДД', /ЗДД(?![ВА-Яа-я])|данокот на добивка|данок на добивка/i],
  ['ZPDD', 'ЗПДД', /ЗПДД|ЗДЛД|персонален данок на доход|персоналниот данок на доход|данок на личен доход/i],
  ['ZDP', 'ЗДП', /ЗДП(?![А-Яа-я])|даночна постапка|даночната постапка/i],
  ['ZOUP', 'ЗОУП', /ЗОУП|општата управна постапка|општа управна постапка/i],
  ['ZIN', 'ЗИН', /ЗИН(?![А-Яа-я])|инспекцискиот надзор|инспекциски надзор/i],
  ['ZUS', 'ЗУС', /ЗУС(?![А-Яа-я])|управните спорови|управни спорови/i],
  ['ZZLP', 'ЗЗЛП', /ЗЗЛП|заштита на личните податоци/i],
  ['ZP', 'Закон за прекршоците', /Закон(?:от)? за прекршоците/i],
  ['ZRO', 'ЗРО', /ЗРО(?![А-Яа-я])|работните односи/i],
  ['ZSPPFT', 'ЗСППФТ', /ЗСППФТ|перење пари/i],
  ['ZPU', 'Закон за платежни услуги', /платежни услуги/i],
  ['ZTD', 'ЗТД', /ЗТД(?![А-Яа-я])|трговските друштва/i],
  ['ZPRID', 'Закон за придонеси', /Закон(?:от)? за придонеси|придонесите од задолжително/i],
];
const LAW_LABEL = Object.fromEntries(LAW_ALIASES.map(([c, l]) => [c, l]));
/** `LR_LAWS` keys of the tax review rules → law code. */
export const LR_LAW_CODE: Readonly<Record<string, string>> = { zddv: 'ZDDV', zdd: 'ZDD', zdld: 'ZPDD', zdp: 'ZDP' };

export interface LawRef { law: string | null; art: string }
export const refKey = (r: LawRef) => `${r.law ?? '?'}:${r.art}`;
export const refLabel = (r: LawRef) => `чл. ${r.art}${r.law ? ` ${LAW_LABEL[r.law] ?? r.law}` : ''}`;

function lawAt(s: string, mode: 'first' | 'last'): string | null {
  let best: { i: number; code: string } | null = null;
  for (const [code, , re] of LAW_ALIASES) {
    const g = new RegExp(re.source, 'gi');
    for (const m of s.matchAll(g)) {
      const i = m.index ?? 0;
      if (!best || (mode === 'first' ? i < best.i : i > best.i)) best = { i, code };
    }
  }
  return best?.code ?? null;
}

/**
 * Article references in a text: „чл. 34 ЗДДВ“, „член 102 од Законот за даночна постапка“, „ЗОУП чл. 106–107“
 * (a range gives both ends and what lies between), „чл. 111-а“. The law is the nearest one after the article in the
 * same clause, otherwise the nearest one before it.
 */
export function lawRefsOf(text: string): LawRef[] {
  const out = new Map<string, LawRef>();
  const re = /чл(?:ен(?:от)?|\.)\s*(\d{1,3})(?:\s*[-–‑]\s*(\d{1,3}|[а-ш](?![а-ш])))?/gi;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    const tail = text.slice(i + m[0].length, i + m[0].length + 90).split(/;|\n|чл(?:ен|\.)/i)[0] ?? '';
    const headStart = Math.max(0, i - 110);
    const head = text.slice(headStart, i).split(/;|\n/).pop() ?? '';
    const law = lawAt(tail, 'first') ?? lawAt(head, 'last');
    const a = Number(m[1]);
    const arts: string[] = [];
    if (m[2] && /^\d+$/.test(m[2]) && Number(m[2]) > a && Number(m[2]) - a <= 10) for (let n = a; n <= Number(m[2]); n++) arts.push(String(n));
    else if (m[2] && !/^\d+$/.test(m[2])) arts.push(`${a}-${m[2].toLowerCase()}`);
    else arts.push(String(a));
    for (const art of arts) { const r = { law, art }; out.set(refKey(r), r); }
  }
  return [...out.values()];
}

export interface LawSnippet {
  id: string;
  source: 'rule' | 'remedy' | 'change';
  law: string | null;
  title: string;
  text: string;
  refs: LawRef[];
}

export interface LawRuleLike { id: string; law: string; art: string; t: string }
export interface LawChangeLike { id: string; title: string; what?: string | null; date?: string | null; from?: string | null; verified?: boolean }

/** Which law codes a finding area concerns. */
const AREA_LAWS: Partial<Record<Finding['area'], string[]>> = {
  vat: ['ZDDV', 'ZDP'], cit: ['ZDD', 'ZDP'], pit: ['ZPDD', 'ZDP'], contrib: ['ZPRID', 'ZDP'], payroll: ['ZRO', 'ZPDD', 'ZPRID'], invoice: ['ZDDV'],
  books: ['ZTD', 'ZDP'], cash: ['ZPU', 'ZDP'], fiscal: ['ZDP'], labour: ['ZRO', 'ZIN'], market: ['ZIN'], aml: ['ZSPPFT'], gdpr: ['ZZLP'],
};
const AREA_WORDS: Partial<Record<Finding['area'], RegExp>> = {
  vat: /ддв|додадена вредност/i, cit: /добивка/i, pit: /персонален|личен доход/i, contrib: /придонес/i, payroll: /плат/i, invoice: /фактур/i,
  cash: /благајн|готовин/i, fiscal: /фискал/i, labour: /работн/i, aml: /перење/i, gdpr: /лични податоци/i, books: /книговод|сметководств/i,
};

/**
 * The law context of a case from the program's law store: the tax review rules (article + rule) of the laws the
 * findings concern, the remedies of the act (with their legal basis) and the law changes found by the daily robot that
 * mention those laws or the findings' subject. Also returns the articles cited in the case that the store does not
 * hold (`missing` → „треба да се провери“).
 */
export function kontrolaLawContext(x: { auth: KontrolaAuth; doc: KontrolaDoc; findings: readonly Finding[]; rules: readonly LawRuleLike[]; changes: readonly LawChangeLike[]; max?: number }): { snippets: LawSnippet[]; missing: LawRef[] } {
  const cited = x.findings.flatMap((f) => [...lawRefsOf(`${f.article ?? ''}`), ...lawRefsOf(f.analysis ?? '')]);
  const laws = new Set<string>([...cited.map((r) => r.law).filter((l): l is string => !!l), ...x.findings.flatMap((f) => AREA_LAWS[f.area] ?? [])]);
  const S: LawSnippet[] = [];
  let n = 0;
  const add = (s: Omit<LawSnippet, 'id' | 'refs'> & { refs?: LawRef[] }) => {
    const refs = (s.refs ?? lawRefsOf(`${s.title} ${s.text}`)).map((r) => ({ law: r.law ?? s.law, art: r.art }));
    S.push({ ...s, id: `L${++n}`, refs });
  };
  for (const r of remediesFor(x.auth, x.doc)) add({ source: 'remedy', law: null, title: `${r.name} – ${r.to}`, text: `${r.law}${r.note ? `. ${r.note}` : ''}` });
  for (const r of x.rules) {
    const code = LR_LAW_CODE[r.law] ?? null;
    if (!code || !laws.has(code)) continue;
    add({ source: 'rule', law: code, title: r.t, text: `${r.art} ${LAW_LABEL[code] ?? ''}`.trim() });
  }
  const words = x.findings.map((f) => AREA_WORDS[f.area]).filter((w): w is RegExp => !!w);
  const lawRes = LAW_ALIASES.filter(([c]) => laws.has(c)).map(([, , re]) => re);
  const C = x.changes.filter((c) => { const t = `${c.title} ${c.what ?? ''}`; return lawRes.some((re) => re.test(t)) || words.some((w) => w.test(t)); }).slice(0, x.max ?? 15);
  for (const c of C) add({ source: 'change', law: lawAt(`${c.title} ${c.what ?? ''}`, 'first'), title: `${c.title}${c.date ? ` (${dmy(c.date)})` : ''}${c.verified === false ? ' – непотврдено' : ''}`, text: (c.what ?? '').slice(0, 600) });
  const have = storeKeys(S);
  const missing = dedupeRefs(cited).filter((r) => !refInStore(r, have));
  return { snippets: S, missing };
}

const dedupeRefs = (R: readonly LawRef[]) => [...new Map(R.map((r) => [refKey(r), r])).values()];
const storeKeys = (S: readonly LawSnippet[]) => new Set(S.flatMap((s) => s.refs.map(refKey)));
/** A reference without a law matches any stored article with the same number. */
function refInStore(r: LawRef, have: Set<string>): boolean {
  if (r.law) return have.has(refKey(r));
  for (const k of have) if (k.endsWith(`:${r.art}`)) return true;
  return false;
}

/* ====================================================================================================== */
/* „💲 AI правна анализа“                                                                                  */
/* ====================================================================================================== */

export interface AiCite { ref: string; why: string; verified: boolean }
export interface AiFindingAssessment {
  no: number;
  inspectorRight: 'yes' | 'no' | 'partly' | 'unclear';
  assessment: string;
  support: AiCite[];
  against: AiCite[];
  counter: string[];
  procedural: string[];
  recommendation: Recommendation;
  chance: number;
  /** Our position for the external document (the improved reasoning). */
  position: string;
  /** Notes for the internal analysis. */
  internal: string[];
}
export interface KontrolaAiAnalysis {
  findings: AiFindingAssessment[];
  procedural: string[];
  conclusion: string;
  summary: string;
  /** Articles the model cited that are not in the law store („треба да се провери“). */
  unverified: string[];
  /** Articles cited in the case that the store does not hold. */
  missing: string[];
}

export const VERIFY_TAG = '[треба да се провери]';

/** The prompt of the AI legal analysis. Only the case text goes out: no ЕДБ / ЕМБС / address, no staff names. */
export function kontrolaAiPrompt(x: CaseInput, ctx: { snippets: readonly LawSnippet[]; missing: readonly LawRef[] }): string {
  const ch = chooseSubmission(x);
  const F = x.items.map((it) => ({
    no: it.f.no, area: FINDING_AREA[it.f.area], finding: it.f.text, articleCitedByAuthority: it.f.article ?? null,
    claimed: fmtCents(it.f.claimed), interest: fmtCents(it.f.interest ?? 0), fine: fmtCents(it.f.fine ?? 0),
    oursFromBooks: it.f.ours == null ? null : fmtCents(it.f.ours), oursSource: it.oursSource ?? null,
    difference: it.f.ours == null ? null : fmtCents(it.f.claimed - it.f.ours),
    officeVerdict: it.f.verdict ? VERDICT_LBL[it.f.verdict] : null, officeAnalysis: it.f.analysis ?? null,
    officeActedLawfully: it.f.officeOk, programError: it.f.systemError, disputed: isDisputed(it.f),
    documents: it.refs ?? [], programChecks: (it.checks ?? []).map((c) => `${c.s}: ${c.txt}`), changesInPeriod: it.audit?.n ?? 0,
  }));
  return `You are a North Macedonian tax and administrative-law expert helping an accounting office respond to an inspection act.
Write everything in formal Macedonian (Cyrillic).

CASE
Authority: ${KONTROLA_AUTH[x.auth]}
Act: ${KONTROLA_DOC[x.doc]}${x.docNo ? ` no. ${x.docNo}` : ''}, dated ${x.docDate ?? 'unknown'}, delivered ${x.delivered ?? 'unknown'}
Controlled period: ${x.periodFrom ?? '?'} – ${x.periodTo ?? '?'}; subject: ${x.subject ?? '—'}
Remedy prepared by the program: ${SUBMISSION_LBL[ch.type]} to ${ch.to}; deadline ${ch.deadline ?? 'unknown'}${ch.verify ? ' (remedy/deadline not confirmed – must be checked in the act)' : ''}
Findings (JSON): ${JSON.stringify(F)}

LAW STORE (the ONLY legal texts you may cite as verified; quote the snippet id):
${ctx.snippets.map((s) => `[${s.id}] (${s.source}) ${s.title}: ${s.text}`).join('\n') || '(empty)'}
Articles cited in the case that are NOT in the store: ${ctx.missing.map(refLabel).join(', ') || 'none'}

RULES
- Cite articles as „чл. N <law abbreviation>“ (ЗДДВ, ЗДД, ЗПДД, ЗДП, ЗОУП, ЗИН, ЗУС, ЗЗЛП …). Never invent articles or their content.
  If you rely on an article that is not in the LAW STORE, add „${VERIFY_TAG}“ right after it.
- Procedural arguments: deadlines, form of the act, competence, statute of limitations (ЗДП – застареност), proper delivery, right to be heard.
- chance = your estimate 0–100 that the office succeeds on that finding.
- Do not add personal data. Do not address the client.
Return ONLY JSON:
{"findings":[{"no":1,"inspectorRight":"yes|no|partly|unclear","assessment":"","support":[{"ref":"чл. N ЗАКОН","why":""}],"against":[{"ref":"","why":""}],"counter":[""],"procedural":[""],"recommendation":"accept|object|partial|review","chance":50,"position":"our position for the external document, 2–5 sentences","internal":["notes for the internal analysis"]}],
 "procedural":["case-wide procedural arguments"],"conclusion":"conclusion paragraph of the external document","summary":"3–5 sentences for the internal analysis"}`;
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, n = 12) => (Array.isArray(v) ? v.map((x) => str(x, 1500)).filter(Boolean).slice(0, n) : []);

/** Mark every article reference in `t` that the store does not hold (once). */
export function tagUnverified(t: string, have: Set<string>, found: Set<string>): string {
  const re = /чл(?:ен(?:от)?|\.)\s*\d{1,3}(?:\s*[-–‑]\s*(?:\d{1,3}|[а-ш](?![а-ш])))?(?:\s+(?:ст\.|став|т\.|точка)\s*\d+)*(?:\s+(?:од\s+)?(?:Закон(?:от)?\s+за\s+[А-Яа-яЀ-ӿ ]{3,60}?(?=[,.;)]|$)|[А-ЯЀ-Џ]{2,7}))?/g;
  return t.replace(re, (m, off: number) => {
    const refs = lawRefsOf(m);
    const bad = refs.filter((r) => !refInStore(r, have));
    if (!bad.length || t.slice(off + m.length, off + m.length + VERIFY_TAG.length + 1).includes(VERIFY_TAG)) return m;
    for (const r of bad) found.add(refLabel(r));
    return `${m} ${VERIFY_TAG}`;
  });
}

const REC_OK = new Set<Recommendation>(['accept', 'object', 'partial', 'review']);
const RIGHT_OK = new Set(['yes', 'no', 'partly', 'unclear']);

/** Parse and check the model's answer: unknown findings are dropped, every unstored article is tagged „треба да се провери“. */
export function parseKontrolaAi(raw: string, ctx: { snippets: readonly LawSnippet[]; missing: readonly LawRef[] }, nos: readonly number[]): KontrolaAiAnalysis {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI не врати анализа (JSON).');
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]) as Record<string, unknown>; } catch { throw new Error('AI врати неважечка анализа (JSON).'); }
  const have = storeKeys(ctx.snippets);
  const found = new Set<string>();
  const T = (s: string) => tagUnverified(s, have, found);
  const cites = (v: unknown): AiCite[] => (Array.isArray(v) ? v : []).slice(0, 10).map((c) => {
    const ref = str((c as { ref?: unknown })?.ref, 200), why = str((c as { why?: unknown })?.why, 1500);
    const R = lawRefsOf(ref);
    const verified = R.length > 0 && R.every((r) => refInStore(r, have));
    if (!verified && ref) for (const r of R.length ? R : []) found.add(refLabel(r));
    if (!verified && ref && !R.length) found.add(ref);
    return { ref, why: T(why), verified };
  }).filter((c) => c.ref || c.why);
  const F = (Array.isArray(j.findings) ? j.findings : []).flatMap((x): AiFindingAssessment[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    const no = Number(o.no);
    if (!nos.includes(no)) return [];
    const rec = o.recommendation as Recommendation;
    const ch = Math.round(Number(o.chance));
    return [{
      no, inspectorRight: RIGHT_OK.has(String(o.inspectorRight)) ? (o.inspectorRight as AiFindingAssessment['inspectorRight']) : 'unclear',
      assessment: T(str(o.assessment)), support: cites(o.support), against: cites(o.against), counter: strs(o.counter).map(T), procedural: strs(o.procedural).map(T),
      recommendation: REC_OK.has(rec) ? rec : 'review', chance: Number.isFinite(ch) ? Math.max(0, Math.min(100, ch)) : 0,
      position: T(str(o.position)), internal: strs(o.internal).map(T),
    }];
  });
  return {
    findings: F, procedural: strs(j.procedural).map(T), conclusion: T(str(j.conclusion)), summary: T(str(j.summary)),
    unverified: [...found], missing: ctx.missing.map(refLabel),
  };
}

/** The AI analysis as patches of the two documents. */
export function aiPatches(a: KontrolaAiAnalysis): { external: SubmissionAiPatch; internal: InternalAiPatch } {
  const reasoning: Record<number, string> = {};
  const perFinding: Record<number, string[]> = {};
  for (const f of a.findings) {
    if (f.position) reasoning[f.no] = f.position;
    perFinding[f.no] = [
      `инспекторот е во право: ${({ yes: 'да', no: 'не', partly: 'делумно', unclear: 'нејасно' } as const)[f.inspectorRight]}; шанса ${f.chance}%; препорака ${RECOMMEND_LBL[f.recommendation]}.`,
      ...(f.assessment ? [f.assessment] : []),
      ...f.support.map((c) => `За нас: ${c.ref}${c.verified ? '' : ` ${VERIFY_TAG}`} – ${c.why}`),
      ...f.against.map((c) => `Против нас: ${c.ref}${c.verified ? '' : ` ${VERIFY_TAG}`} – ${c.why}`),
      ...f.counter.map((c) => `Контрааргумент: ${c}`),
      ...f.procedural.map((c) => `Процесно: ${c}`),
      ...f.internal,
    ];
  }
  const verify = [...a.unverified, ...a.missing.filter((m) => !a.unverified.includes(m))];
  return {
    external: { reasoning, procedural: a.procedural, conclusion: a.conclusion || null },
    internal: { perFinding, summary: [a.summary, verify.length ? `Членови што треба да се проверат (не се во базата на закони): ${verify.join(', ')}.` : ''].filter(Boolean).join(' ') || null },
  };
}
