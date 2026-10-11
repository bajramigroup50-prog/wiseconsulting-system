import 'server-only';
/** Shared by the „Контроли и решенија“ page and its Word export: findings → core types, the objection draft, the analysis text. */
import {
  FINDING_AREA, fmtCents, isKontrolaAuth, isKontrolaDoc, KONTROLA_AUTH, KONTROLA_DOC, kontrolaObjectionDraft, kontrolaSummary, recommendFinding, RECOMMEND_LBL,
  toCents, VERDICT_LBL, type DraftDoc, type Finding, type FindingArea, type FindingVerdict, type Recommendation,
} from '@wise/core/compliance';
import { getOfficeProfile, type Firm, type Kontrola, type KontrolaFinding } from '@wise/db';
import { db } from './db';
import { today } from './office';

export const toFinding = (f: KontrolaFinding): Finding => ({
  no: f.no, area: (f.area in FINDING_AREA ? f.area : 'other') as FindingArea, text: f.text, article: f.article,
  claimed: toCents(f.claimed), interest: toCents(f.interest), fine: toCents(f.fine), ours: f.ours == null ? null : toCents(f.ours),
  verdict: (f.verdict as FindingVerdict | null) ?? null, officeOk: f.officeOk, systemError: f.systemError, analysis: f.analysis,
  recommendation: (f.recommendation as Recommendation | null) ?? null,
});

export async function kontrolaDraft(k: Kontrola, F: readonly KontrolaFinding[], firm: Firm): Promise<DraftDoc | null> {
  if (!isKontrolaAuth(k.auth) || !isKontrolaDoc(k.doc)) return null;
  const O = await getOfficeProfile(db());
  const s = (firm.settings ?? {}) as { manager?: string; signer?: string };
  return kontrolaObjectionDraft({
    auth: k.auth, doc: k.doc, docNo: k.docNo, docDate: k.docDate, delivered: k.delivered, dueOverride: k.dueOverride, periodFrom: k.periodFrom, periodTo: k.periodTo,
    subject: k.subject, firm: { name: firm.name, edb: firm.edb, address: firm.address, city: firm.city, manager: s.manager || s.signer || null },
    office: { name: O.name ?? null, city: O.city ?? null }, findings: F.map(toFinding), today: today(),
  });
}

/** Plain-text paragraphs of the draft (what the editable text area starts with and what the Word file contains). */
export const draftParagraphs = (d: DraftDoc): string[] => [
  `До: ${d.to}`, '', d.title, '', ...d.blocks.flatMap((b) => [...(b.h ? [b.h.toUpperCase()] : []), ...b.p, '']),
];

const dmy = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '—');
const den = (c: number) => `${fmtCents(c)} ден.`;

/** The office's internal analysis of the case (Word / print): per finding the verdict, the books and the recommendation. */
export function analysisParagraphs(k: Kontrola, F: readonly KontrolaFinding[], firm: Pick<Firm, 'name' | 'edb'>): string[] {
  const S = kontrolaSummary(F.map(toFinding));
  const auth = isKontrolaAuth(k.auth) ? KONTROLA_AUTH[k.auth] : k.auth;
  const act = isKontrolaDoc(k.doc) ? KONTROLA_DOC[k.doc] : k.doc;
  return [
    'АНАЛИЗА НА АКТ ОД КОНТРОЛА',
    `${firm.name}${firm.edb ? `, ЕДБ ${firm.edb}` : ''}`,
    `${act}${k.docNo ? ` бр. ${k.docNo}` : ''} од ${dmy(k.docDate)}, ${auth}; примен ${dmy(k.delivered)}; контролиран период ${dmy(k.periodFrom)}–${dmy(k.periodTo)}.`,
    `Утврдено: ${den(S.claimed)} данок/придонес, ${den(S.interest)} камата, ${den(S.fine)} глоба – вкупно ${den(S.total)}. Оспорено: ${den(S.disputed)}. Препорака: ${RECOMMEND_LBL[S.overall]}.`,
    '',
    ...F.flatMap((f) => {
      const x = toFinding(f);
      return [
        `${f.no}. ${FINDING_AREA[x.area]} – ${f.text}${f.article ? ` (${f.article})` : ''}`,
        `   Утврдено: ${den(x.claimed)}${x.interest ? `, камата ${den(x.interest)}` : ''}${x.fine ? `, глоба ${den(x.fine)}` : ''}; според книгите: ${x.ours == null ? '—' : den(x.ours)}${f.oursSource ? ` (${f.oursSource})` : ''}.`,
        `   Оценка: ${x.verdict ? VERDICT_LBL[x.verdict] : 'не е оценето'}; канцеларијата / фирмата постапила според закон: ${f.officeOk == null ? '—' : f.officeOk ? 'да' : 'не'}; грешка во програмата: ${f.systemError == null ? '—' : f.systemError ? 'да' : 'не'}.`,
        ...(f.analysis ? [`   Анализа: ${f.analysis}`] : []),
        `   Препорака: ${RECOMMEND_LBL[recommendFinding(x)]}.`,
      ];
    }),
  ];
}
