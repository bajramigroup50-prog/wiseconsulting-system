/**
 * „⏸ Минат период – за проверка“ — the database side of `@wise/core/vat/past-period`:
 * - `pastPeriodContext`: the firm's closed (filed) VAT periods, its lock date and the setting (b)
 *   „Задржи ги сите документи од претходни ДДВ периоди“ (`firms.settings.pastVatHold`, ON by default);
 * - `heldScanDrafts`: the drafts a bulk save held (scan screen, inbox, „масовно“);
 * - the owner's decision per held draft: `confirmPastDraft` („✓ Прокнижи во својот период“ / for an incoming invoice
 *   „Прокнижи со датум на прием во тековниот период“) and `rejectPastDraft` („✕ Отфрли“) — both audited
 *   (`pastPost` / `pastReject`); the caller checks the right (`canDecidePast`);
 * - `pastCorrections`: „Корекции на ДДВ-04 потребни“ — the documents confirmed into their own past period;
 * - `latePostedDocuments`: „Документи книжени во минат/затворен ДДВ период по затворањето“ — documents whose
 *   `created_at` is after the period was filed (closed in WISE), or — a period never closed in WISE — after its
 *   filing deadline (the 25th of the next month), or after a chosen date. Their ДДВ-04 must be corrected.
 * VAT books and amounts stay computed from the documents; locked / closed periods stay refused by the posting service.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { todaySkopje } from '@wise/core/office/dates';
import { perRange, periodDue, periodOf } from '@wise/core';
import {
  pastDecisionOptions, pastHoldPrevious, pastPeriodOf, receiptDateOk, vatPeriodName, draftVatDate, OUTGOING_DATE_NOTE,
  type PastPeriodCtx, type PastPeriodHit,
} from '@wise/core/vat/past-period';
import { audit, type Tx } from './audit';
import { aiDocuments, auditLog, firms, invoices, partners, purchases, vatPeriods, type AiDocument, type Firm } from './schema/index';
import { DocumentError, type DocActor } from './sales/context';
import { patchDraft, saveScanDraft } from './sales/scan-save';
import { loadAiDocument } from './sales/ai-docs';
import { repostPurchase } from './sales/purchases';

type FirmLike = Pick<Firm, 'id' | 'vatPeriod' | 'lockDate' | 'settings'>;

/** The past-period context of a firm (`today` defaults to today in Skopje). */
export async function pastPeriodContext(tx: Pick<Tx, 'select'>, firm: FirmLike, today = todaySkopje()): Promise<PastPeriodCtx> {
  const C = await tx.select({ period: vatPeriods.period, dateFrom: vatPeriods.dateFrom, dateTo: vatPeriods.dateTo, submittedAt: vatPeriods.submittedAt })
    .from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.status, 'closed')));
  return {
    kind: firm.vatPeriod === 'month' ? 'month' : 'quarter', today, lockDate: firm.lockDate ?? null,
    holdPrevious: pastHoldPrevious(firm.settings as Record<string, unknown>),
    closed: C.map((c) => ({ period: c.period, dateFrom: c.dateFrom, dateTo: c.dateTo, submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null })),
  };
}

/** Switch (b) „Задржи ги сите документи од претходни ДДВ периоди“ for a firm (audited `pastHoldSet`). */
export async function setPastHold(tx: Tx, a: { firmId: string; on: boolean; userId: string | null }): Promise<void> {
  await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify({ pastVatHold: a.on })}::jsonb` }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pastHoldSet', entityType: 'firm', entityId: a.firmId, data: { on: a.on } });
}

export interface HeldDraft {
  docId: string; index: number; kind: 'purchase' | 'sale'; fileId: string | null;
  number: string; date: string; docDate: string | null; party: string; total: number;
  past: NonNullable<AiDocument['drafts'][number]['past']>;
}

/** Every held draft of a firm (`status = 'past'`, not saved, not rejected), newest first. */
export async function heldScanDrafts(tx: Pick<Tx, 'select'>, firmId: string): Promise<HeldDraft[]> {
  const D = await tx.select().from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, firmId), inArray(aiDocuments.kind, ['purchase', 'sale']), sql`${aiDocuments.drafts} @> '[{"status":"past"}]'::jsonb`))
    .orderBy(desc(aiDocuments.createdAt)).limit(500);
  return D.flatMap((d) => d.drafts.flatMap((x, index): HeldDraft[] => {
    if (x.status !== 'past' || x.savedId || x.skipped || !x.past) return [];
    const r = x.draft as { number?: string; date?: string; docDate?: string; shifted?: boolean; supplierName?: string; buyer?: { name?: string }; groups?: { base: number; vat: number }[]; art32?: boolean; total?: number; calcTotal?: number };
    const kind = d.kind as 'purchase' | 'sale';
    const total = kind === 'sale' ? Number(r.calcTotal ?? r.total ?? 0) : (r.groups ?? []).reduce((s, g) => s + Number(g.base) + (r.art32 ? 0 : Number(g.vat)), 0);
    return [{
      docId: d.id, index, kind, fileId: d.fileId, number: String(r.number ?? ''), date: draftVatDate(kind, r), docDate: r.docDate || null,
      party: kind === 'sale' ? String(r.buyer?.name ?? '') : String(r.supplierName ?? ''), total, past: x.past,
    }];
  }));
}

/** Number of held drafts (the count badge). */
export async function heldScanCount(tx: Pick<Tx, 'select'>, firmIds: readonly string[]): Promise<number> {
  if (!firmIds.length) return 0;
  const [r] = await tx.select({ n: sql<number>`coalesce(sum((select count(*) from jsonb_array_elements(${aiDocuments.drafts}) e where e->>'status' = 'past' and e->>'savedId' is null and coalesce((e->>'skipped')::boolean, false) = false)), 0)::int` })
    .from(aiDocuments).where(and(inArray(aiDocuments.firmId, [...firmIds]), sql`${aiDocuments.drafts} @> '[{"status":"past"}]'::jsonb`));
  return Number(r?.n ?? 0);
}

export interface PastConfirmInput {
  firm: FirmLike; docId: string; index: number;
  /** `own` = „✓ Прокнижи во својот период“; `receipt` = „Прокнижи со датум на прием во тековниот период“ (incoming only). */
  mode: 'own' | 'receipt';
  /** The receipt date for `receipt` (default today). */
  receiptDate?: string | null;
  actor: DocActor;
  today?: string;
}

export interface PastConfirmResult { id: string; entityType: 'purchase' | 'invoice'; date: string; period: string; correction: boolean; hit: PastPeriodHit | null }

/** The owner's decision: post the held draft into its own past period, or (incoming) with a receipt date now. */
export async function confirmPastDraft(tx: Tx, a: PastConfirmInput): Promise<PastConfirmResult> {
  const d = await loadAiDocument(tx, a.firm.id, a.docId);
  const x = d.drafts[a.index];
  if (!x || x.status !== 'past' || !x.past) throw new DocumentError('Документот не е задржан за проверка.');
  if (x.savedId) throw new DocumentError('Документот е веќе прокнижен.');
  if (x.skipped) throw new DocumentError('Документот е отфрлен.');
  const kind = d.kind as 'purchase' | 'sale';
  const ctx = await pastPeriodContext(tx, a.firm, a.today);
  const r = x.draft as { number?: string; date?: string; docDate?: string; shifted?: boolean };
  const own = draftVatDate(kind, r);
  // the period as it is now (it may have been reopened / closed since the hold)
  const hit = pastPeriodOf(own, ctx);
  let date = own, over: { date?: string; docDate?: string | null } | undefined;
  if (a.mode === 'receipt') {
    if (kind !== 'purchase') throw new DocumentError(OUTGOING_DATE_NOTE);
    const docDate = r.docDate || r.date || null;
    date = a.receiptDate || ctx.today;
    const bad = receiptDateOk(date, ctx, docDate);
    if (bad) throw new DocumentError(bad);
    over = { date, docDate };
  } else {
    if (hit) {
      const o = pastDecisionOptions(kind, hit);
      if (!o.own) throw new DocumentError(`Не може да се прокнижи во ${hit.text}: ${o.ownWhyNot}.`);
    }
    over = kind === 'purchase' ? { date: own, docDate: r.docDate || own } : { date: own };
  }
  await patchDraft(tx, d.id, a.index, (y) => ({ ...y, status: 'ok' }));
  const fresh = await loadAiDocument(tx, a.firm.id, a.docId);
  const id = await saveScanDraft(tx, a.firm.id, fresh, a.index, a.actor, over);
  await patchDraft(tx, d.id, a.index, (y) => ({ ...y, msg: a.mode === 'receipt' ? `прокнижена со датум на прием ${date.split('-').reverse().join('.')} (тековен период)` : `прокнижена во ${x.past!.text} – ДДВ-04 треба да се коригира` }));
  const entityType = kind === 'sale' ? 'invoice' : 'purchase';
  const correction = a.mode === 'own' && !!hit;
  const period = periodOf(date, ctx.kind);
  await audit(tx, {
    userId: a.actor.userId, firmId: a.firm.id, action: a.mode === 'receipt' ? 'pastRecv' : 'pastPost', entityType, entityId: id,
    data: { mode: a.mode, docId: d.id, index: a.index, number: r.number ?? '', date, docDate: r.docDate ?? null, heldPeriod: x.past.period, heldText: x.past.text, period, correction, closed: !!hit?.closed },
  });
  return { id, entityType, date, period, correction, hit };
}

/**
 * „✓ Прокнижи ги сите во својот период“: every held draft (of `kind`, or both) is posted into its own past period, each in
 * its own savepoint — one that cannot be posted (closed / locked period, a used number…) stays held and is listed with
 * the reason; the others go on. Every posted one is audited `pastPost` like the single decision.
 */
export async function confirmAllPastDrafts(tx: Tx, a: { firm: FirmLike; actor: DocActor; kind?: 'purchase' | 'sale'; today?: string; only?: readonly string[] }): Promise<{ posted: number; failed: { number: string; why: string }[] }> {
  // `only`: the ticked rows („docId:index“) of „✓ Прокнижи ги избраните“
  const H = (await heldScanDrafts(tx, a.firm.id)).filter((h) => (!a.kind || h.kind === a.kind) && (!a.only || a.only.includes(`${h.docId}:${h.index}`)));
  let posted = 0;
  const failed: { number: string; why: string }[] = [];
  for (const h of H) {
    try {
      await tx.transaction((s) => confirmPastDraft(s as Tx, { firm: a.firm, docId: h.docId, index: h.index, mode: 'own', actor: a.actor, today: a.today }));
      posted++;
    } catch (e) {
      failed.push({ number: h.number, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { posted, failed };
}

/** „✕ Отфрли“: the held draft is deleted (the whole read when it was its only invoice). Audited `pastReject`. */
export async function rejectPastDraft(tx: Tx, a: { firmId: string; docId: string; index: number; userId: string | null }): Promise<void> {
  const d = await loadAiDocument(tx, a.firmId, a.docId);
  const x = d.drafts[a.index];
  if (!x || x.status !== 'past') throw new DocumentError('Документот не е задржан за проверка.');
  if (x.savedId) throw new DocumentError('Документот е веќе прокнижен.');
  const others = d.drafts.filter((_, k) => k !== a.index);
  if (!others.length) await tx.delete(aiDocuments).where(eq(aiDocuments.id, d.id));
  else {
    const drafts = d.drafts.map((y, k) => (k === a.index ? { ...y, skipped: true, msg: 'отфрлена (минат период)' } : y));
    await tx.update(aiDocuments).set({ drafts, ...(drafts.every((y) => y.savedId || y.skipped) && drafts.some((y) => y.savedId) ? { status: 'saved' as const } : {}) }).where(eq(aiDocuments.id, d.id));
  }
  await audit(tx, {
    userId: a.userId, firmId: a.firmId, action: 'pastReject', entityType: 'ai_document', entityId: d.id,
    data: { index: a.index, number: (x.draft as { number?: string }).number ?? '', period: x.past?.period ?? null, text: x.past?.text ?? null },
  });
}

export interface PastCorrection { entityType: 'purchase' | 'invoice'; id: string; number: string; date: string; at: Date; by: string | null; heldText: string; exists: boolean }

/** „Корекции на ДДВ-04 потребни“: documents confirmed „во својот период“ into `period` (or every period when null). */
export async function pastCorrections(tx: Pick<Tx, 'select'>, firmId: string, period: string | null): Promise<PastCorrection[]> {
  const A = await tx.select().from(auditLog).where(and(eq(auditLog.firmId, firmId), eq(auditLog.action, 'pastPost'),
    sql`(${auditLog.data}->>'correction')::boolean`, ...(period ? [sql`${auditLog.data}->>'period' = ${period}`] : []))).orderBy(desc(auditLog.at)).limit(500);
  const ids = (t: string) => A.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!);
  const [P, I] = await Promise.all([
    ids('purchase').length ? tx.select({ id: purchases.id }).from(purchases).where(inArray(purchases.id, ids('purchase'))) : [],
    ids('invoice').length ? tx.select({ id: invoices.id }).from(invoices).where(inArray(invoices.id, ids('invoice'))) : [],
  ]);
  const live = new Set([...P, ...I].map((r) => r.id));
  return A.map((r) => {
    const v = (r.data ?? {}) as { number?: string; date?: string; heldText?: string };
    return { entityType: r.entityType as 'purchase' | 'invoice', id: r.entityId ?? '', number: String(v.number ?? ''), date: String(v.date ?? ''), at: r.at, by: r.userId, heldText: String(v.heldText ?? ''), exists: live.has(r.entityId ?? '') };
  });
}

export interface LatePostedDoc {
  entityType: 'purchase' | 'invoice'; id: string; number: string; date: string; party: string; vat: number; total: number;
  createdAt: Date; period: string; periodText: string;
  /** `closed` = after the filing in WISE; `due` = never closed in WISE, after the filing deadline; `after` = after the chosen date. */
  basis: 'closed' | 'due' | 'after';
  threshold: Date;
}

/** End of a day in Skopje (the latest offset, so a document on that day is never counted as late). */
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999Z`);

/**
 * „Документи книжени во минат/затворен ДДВ период по затворањето“: documents dated in [from, to] whose `created_at` is
 * after their period was filed in WISE (`submitted_at`, also when the period was reopened since), or — never filed in
 * WISE — after the period's filing deadline; with `after`, after that date for every period. Only periods before the
 * one that contains `today` (the current period is not filed yet).
 */
export async function latePostedDocuments(tx: Pick<Tx, 'select'>, firm: FirmLike, a: { from: string; to: string; after?: string | null; today?: string }): Promise<LatePostedDoc[]> {
  const today = a.today ?? todaySkopje();
  const kind = firm.vatPeriod === 'month' ? 'month' : 'quarter';
  const [curFrom] = perRange(periodOf(today, kind));
  const VP = await tx.select({ period: vatPeriods.period, dateFrom: vatPeriods.dateFrom, dateTo: vatPeriods.dateTo, submittedAt: vatPeriods.submittedAt, status: vatPeriods.status })
    .from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), isNotNull(vatPeriods.submittedAt), lte(vatPeriods.dateFrom, a.to), gte(vatPeriods.dateTo, a.from)));
  const after = a.after && /^\d{4}-\d{2}-\d{2}$/.test(a.after) ? endOfDay(a.after) : null;
  const [P, I] = await Promise.all([
    tx.select({ id: purchases.id, number: purchases.number, date: purchases.date, party: sql<string>`coalesce(${partners.name}, ${purchases.supplierName}, '')`, vat: purchases.vat, total: purchases.total, createdAt: purchases.createdAt })
      .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(and(eq(purchases.firmId, firm.id), inArray(purchases.status, ['posted', 'pending']), gte(purchases.date, a.from), lte(purchases.date, a.to))),
    tx.select({ id: invoices.id, number: invoices.number, date: invoices.date, party: sql<string>`coalesce(${partners.name}, '')`, vat: invoices.vat, total: invoices.total, createdAt: invoices.createdAt })
      .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
      .where(and(eq(invoices.firmId, firm.id), inArray(invoices.kind, ['invoice', 'credit']), inArray(invoices.status, ['posted', 'pending']), gte(invoices.date, a.from), lte(invoices.date, a.to))),
  ]);
  const out: LatePostedDoc[] = [];
  const check = (entityType: 'purchase' | 'invoice', r: (typeof P)[number]) => {
    const vp = VP.find((p) => p.dateFrom <= r.date && r.date <= p.dateTo);
    const period = vp?.period ?? periodOf(r.date, kind);
    if (!vp && r.date >= curFrom) return;
    const basis: LatePostedDoc['basis'] = after ? 'after' : vp ? 'closed' : 'due';
    const threshold = after ?? (vp ? vp.submittedAt! : endOfDay(periodDue(period)));
    if (r.createdAt <= threshold) return;
    out.push({ entityType, id: r.id, number: r.number, date: r.date, party: r.party, vat: Number(r.vat), total: Number(r.total), createdAt: r.createdAt, period, periodText: vatPeriodName(period), basis, threshold });
  };
  for (const r of P) check('purchase', r);
  for (const r of I) check('invoice', r);
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.createdAt.getTime() - y.createdAt.getTime()));
}

/**
 * The first day of the VAT period a late document goes into now: the previous period while its ДДВ-04 is still due
 * (not filed in WISE, deadline not passed), else the current one.
 */
export async function openVatPeriodStart(tx: Pick<Tx, 'select'>, firm: FirmLike, today = todaySkopje()): Promise<string> {
  const kind = firm.vatPeriod === 'month' ? 'month' : 'quarter';
  const [curFrom] = perRange(periodOf(today, kind));
  const d = new Date(curFrom + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  const prev = periodOf(d.toISOString().slice(0, 10), kind);
  const [pFrom, pTo] = perRange(prev);
  const due = new Date(pTo + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() + 25);
  const [filed] = await tx.select({ x: vatPeriods.period }).from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.period, prev), or(eq(vatPeriods.status, 'closed'), isNotNull(vatPeriods.submittedAt)))).limit(1);
  return !filed && due.toISOString().slice(0, 10) >= today ? pFrom : curFrom;
}

/**
 * „⇢ Премести ги во тековниот ДДВ период“: incoming invoices / receipts booked late into a past period (filed, or its
 * deadline passed) get the first day of the open period as their booking date – the invoice date stays as the document
 * date – and are re-posted there; the past period's ДДВ-04 no longer changes. Outgoing invoices keep their issue date.
 */
export async function moveLatePurchases(tx: Tx, firm: FirmLike & Parameters<typeof repostPurchase>[1], ids: readonly string[], userId: string | null): Promise<{ moved: number; to: string }> {
  const to = await openVatPeriodStart(tx, firm);
  let moved = 0;
  for (const id of ids) {
    const [p] = await tx.select({ id: purchases.id, date: purchases.date, docDate: purchases.docDate, status: purchases.status }).from(purchases).where(and(eq(purchases.id, id), eq(purchases.firmId, firm.id))).limit(1);
    if (!p || p.status !== 'posted' || String(p.date) >= to) continue;
    await tx.update(purchases).set({ date: to, docDate: p.docDate ?? p.date }).where(eq(purchases.id, id));
    await repostPurchase(tx, firm, id, userId);
    await audit(tx, { userId, firmId: firm.id, action: 'vatLateMove', entityType: 'purchase', entityId: id, data: { from: p.date, to } });
    moved++;
  }
  return { moved, to };
}
