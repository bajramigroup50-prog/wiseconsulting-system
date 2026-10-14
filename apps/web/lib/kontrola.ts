import 'server-only';
/** Shared by the „Контроли и решенија“ page, its actions and its Word export: the act reads, findings → core types, the case documents. */
import { and, eq, inArray } from 'drizzle-orm';
import { aiErrCodeOf, aiErrText } from '@wise/core/ai/errors';
import { FINDING_AREA, toCents, type Finding, type FindingArea, type FindingVerdict, type Recommendation } from '@wise/core/compliance';
import { aiDocuments, files, kontrolaDocs, kontroli, loadKontrolaCase, snapshotKontrolaDocs, type Kontrola, type KontrolaFinding, type Tx } from '@wise/db';
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

/**
 * The two documents of a case (external submission + internal analysis), generated from the case data and the
 * evidence of the controlled period. The office's edited / accepted texts (`data.draft`, `data.internalDraft`) are
 * shown instead when present (`kontrolaTexts`).
 */
export async function kontrolaCaseDocs(firmId: string, kid: string) {
  const c = await loadKontrolaCase(db(), firmId, kid, today());
  if (!c) return null;
  return { c, ...kontrolaDocs(c) };
}

/** After every change of a case: keep an `auto` version of the documents when something is disputed (never fails the action). */
export async function autoVersion(firmId: string, kid: string, userId: string | null): Promise<void> {
  try { await db().transaction((tx) => snapshotKontrolaDocs(tx, firmId, kid, userId, today())); } catch (e) { console.error('[kontrola] auto version', e); }
}

