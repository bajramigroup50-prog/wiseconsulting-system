import 'server-only';
/** Shared by the „Контроли и решенија“ page and its Word export: findings → core types, the objection draft, the analysis text. */
import { and, eq, inArray } from 'drizzle-orm';
import { aiErrCodeOf, aiErrText } from '@wise/core/ai/errors';
import {
  FINDING_AREA, fmtCents, isKontrolaAuth, isKontrolaDoc, KONTROLA_AUTH, KONTROLA_DOC, kontrolaObjectionDraft, kontrolaSummary, recommendFinding, RECOMMEND_LBL,
  toCents, VERDICT_LBL, type DraftDoc, type Finding, type FindingArea, type FindingVerdict, type Recommendation,
} from '@wise/core/compliance';
import { aiDocuments, files, getOfficeProfile, kontrolaDue, kontroli, type Firm, type Kontrola, type KontrolaFinding, type Tx } from '@wise/db';
import { dispatchAiReads, queueAiReads } from './ai';
import { db } from './db';
import { today } from './office';

/* ---------------- reading the attached act ---------------- */

/** Files the `kontrola` read takes: PDF, photos (AI), Word / text (free reader). */
export const isKontrolaReadable = (f: { name: string; mime: string }) =>
  /^application\/pdf$|^image\/(jpeg|png|webp)$|wordprocessingml|^text\/plain$/.test(f.mime) || /\.(pdf|jpe?g|png|webp|docx|txt)$/i.test(f.name);

export interface KontrolaRead { id: string; fileId: string | null; at: string }
export const kontrolaReads = (k: Pick<Kontrola, 'data'>): KontrolaRead[] => ((k.data ?? {}) as { reads?: KontrolaRead[] }).reads ?? [];

/**
 * Start the read of attached acts (inside the caller's transaction, after `office`): one `kontrola` read per readable
 * file, remembered on the case (`data.reads`) so the case page shows the progress / result / error even after a
 * reload. Returns the read ids — `dispatchKontrolaReads` after the commit.
 */
export async function startKontrolaReads(tx: Tx, firmId: string, userId: string, kid: string, fileIds: readonly string[]): Promise<string[]> {
  const want = [...new Set(fileIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!want.length) return [];
  const F = await tx.select({ id: files.id, name: files.name, mime: files.mime }).from(files)
    .where(and(eq(files.firmId, firmId), inArray(files.id, want), eq(files.status, 'ready')));
  const ok = F.filter(isKontrolaReadable).map((f) => f.id);
  if (!ok.length) return [];
  const ids = await queueAiReads(tx, { firmId, userId, kind: 'kontrola', fileIds: ok, options: { kontrolaId: kid } });
  const [k] = await tx.select({ data: kontroli.data }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firmId))).limit(1);
  const at = new Date().toISOString();
  const reads = [...kontrolaReads({ data: k?.data ?? {} }), ...ids.map((id, i) => ({ id, fileId: ok[i] ?? null, at }))].slice(-20);
  await tx.update(kontroli).set({ data: { ...(k?.data ?? {}), reads } }).where(eq(kontroli.id, kid));
  return ids;
}

/** Enqueue the reads; if the job queue is not reachable the reads are marked failed with a message (never a silent „чека…“). */
export async function dispatchKontrolaReads(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try { await dispatchAiReads(ids); } catch (e) {
    console.error('[kontrola] dispatch', e);
    await db().update(aiDocuments).set({ status: 'error', error: 'Читањето не можеше да започне (серверот за позадинска обработка не одговара) – кликнете ↻ Повторно.' }).where(inArray(aiDocuments.id, ids));
  }
}

/** Reads of the case not yet applied (for the case page): state, friendly error, file name. */
export async function pendingKontrolaReads(k: Kontrola) {
  const R = kontrolaReads(k);
  if (!R.length) return [];
  const D = await db().select({ d: aiDocuments, name: files.name }).from(aiDocuments).leftJoin(files, eq(files.id, aiDocuments.fileId))
    .where(and(eq(aiDocuments.firmId, k.firmId), inArray(aiDocuments.id, R.map((r) => r.id))));
  return D.filter(({ d }) => d.status !== 'saved').map(({ d, name }) => {
    const ec = (d.options as { errCode?: unknown }).errCode;
    return {
      id: d.id, kind: d.kind, status: d.status, error: d.error ? aiErrText(d.error, ec) : null, model: d.model, result: null,
      errCode: d.status === 'error' ? aiErrCodeOf(d.error, ec) : null, name: name ?? '', fileId: d.fileId,
    };
  });
}

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
    auth: k.auth, doc: k.doc, docNo: k.docNo, docDate: k.docDate, delivered: k.delivered, dueOverride: kontrolaDue(k), periodFrom: k.periodFrom, periodTo: k.periodTo,
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
