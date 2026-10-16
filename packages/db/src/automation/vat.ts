/**
 * P37 — ДДВ-04 draft: after a VAT period ends, the return of every VAT firm is computed with the existing VAT
 * computation (`computeVatPeriod`, documents + manual VAT journals) and stored as a draft with what is payable /
 * refundable and the problems that stop a bulk close:
 *  - books ≠ ledger: the VAT kontos of the journals (the closing difference) do not match field 31 (+30) of the return
 *    (the same check as the ДДВ-04 screen);
 *  - missing invoices: gaps in the outgoing invoice numbers, purchases of the period still in draft;
 *  - open `bad` autopilot findings and client documents waiting for approval (the autopilot close tab's checks).
 * Closing stays the existing `closeVatPeriod` (one click per firm, or in bulk for drafts without problems, re-checked
 * live). Nothing in a locked period.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { numberGaps } from '@wise/core/firms/zatvoranje';
import { apClPeriodFor } from '@wise/core/office/ap-close';
import { todaySkopje } from '@wise/core/office';
import { audit, type Tx } from '../audit';
import { autopilotFindings, clientEntries, invoices, purchases, vatPeriods, type Firm } from '../schema/index';
import { closeVatPeriod, computeVatPeriod, firmVatPeriodKind, vatPeriodLabel } from '../vat-service';
import { defaultVatSource, type VatDocumentSource } from '../vat-source';
import { autoFirms, autoOn, decideDraft, listDrafts, lockedAt, noteAutoRun, upsertDraft } from './common';

export const VAT_KIND = 'vat';

/** Open `bad` autopilot findings (not acknowledged) and client documents waiting for approval, per firm. */
export async function vatPendingIssues(tx: Pick<Tx, 'select'>, firmIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!firmIds.length) return out;
  const ids = [...firmIds];
  const [bad, pend] = await Promise.all([
    tx.select({ f: autopilotFindings.firmId, txt: autopilotFindings.txt }).from(autopilotFindings)
      .where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), eq(autopilotFindings.lvl, 'bad'))),
    tx.select({ f: clientEntries.firmId }).from(clientEntries).where(and(inArray(clientEntries.firmId, ids), eq(clientEntries.status, 'pending'))),
  ]);
  for (const id of ids) {
    const miss = bad.filter((x) => x.f === id).map((x) => x.txt);
    const np = pend.filter((x) => x.f === id).length;
    if (np) miss.push(`${np} документи од клиентот чекаат одобрување`);
    out.set(id, miss);
  }
  return out;
}

export interface VatDraftData { period: string; label: string; from: string; to: string; due: string; f31: number; f30: number; payable: number; refund: number; ledger: number; diff: number; [k: string]: unknown }

/** Compute the return of one period and its problems (nothing is written). */
export async function vatDraftCheck(tx: Tx, firm: Firm, period: string, source: VatDocumentSource = defaultVatSource): Promise<{ data: VatDraftData; problems: string[] }> {
  const [row] = await tx.select({ corrections: vatPeriods.corrections }).from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.period, period))).limit(1);
  const C = await computeVatPeriod(tx, firm, period, source, row?.corrections ?? {});
  const f31 = C.fields['31'] ?? 0, f30 = C.fields['30'] ?? 0;
  const ledger = Math.round(C.close.diff);
  const diff = ledger - (f31 + f30);
  const problems: string[] = [];
  if (Math.abs(diff) > 1) problems.push(`книги ≠ налози: ДДВ контата даваат ${ledger}, ДДВ-04 поле 31 = ${f31} (разлика ${diff} ден.)`);
  const y0 = C.from.slice(0, 4) + '-01-01';
  const [nos, draftPur] = await Promise.all([
    tx.select({ no: invoices.number }).from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), eq(invoices.advance, false), ne(invoices.status, 'draft'), sql`${invoices.date} between ${y0} and ${C.to}`)),
    tx.select({ n: sql<number>`count(*)::int` }).from(purchases).where(and(eq(purchases.firmId, firm.id), eq(purchases.status, 'draft'), sql`${purchases.date} between ${C.from} and ${C.to}`)),
  ]);
  const gaps = numberGaps(nos.map((r) => r.no ?? ''));
  if (gaps) problems.push(`излезни фактури: ${gaps} прескокнати броеви (фактури што недостасуваат?)`);
  const dp = draftPur[0]?.n ?? 0;
  if (dp) problems.push(`${dp} влезни фактури од периодот се уште се нацрт (не влегуваат во пријавата)`);
  problems.push(...((await vatPendingIssues(tx, [firm.id])).get(firm.id) ?? []));
  return {
    data: { period, label: vatPeriodLabel(period), from: C.from, to: C.to, due: C.due, f31, f30, payable: Math.max(0, f31), refund: Math.max(0, -f31), ledger, diff },
    problems,
  };
}

export interface AutoVatResult { drafts: number; problems: number; closed: number; locked: number; errors: string[]; skipped: boolean }

/** Daily 05:40: the draft of every VAT firm's last finished period (refreshed until it is closed). */
export async function runAutoVat(db: Tx, o: { today?: string; force?: boolean; source?: VatDocumentSource } = {}): Promise<AutoVatResult> {
  const out: AutoVatResult = { drafts: 0, problems: 0, closed: 0, locked: 0, errors: [], skipped: false };
  if (!o.force && !(await autoOn(db, 'vat'))) return { ...out, skipped: true };
  const today = o.today ?? todaySkopje();
  for (const f of (await autoFirms(db)).filter((x) => x.vatRegistered)) {
    const period = apClPeriodFor('auto', firmVatPeriodKind(f), today)!;
    try {
      await db.transaction(async (tx) => {
        const [vp] = await tx.select({ status: vatPeriods.status }).from(vatPeriods).where(and(eq(vatPeriods.firmId, f.id), eq(vatPeriods.period, period))).limit(1);
        const [d] = await listDrafts(tx, { kind: VAT_KIND, firmIds: [f.id], period });
        if (vp?.status === 'closed') { out.closed++; if (d) await decideDraft(tx, d.id, 'confirmed', null, { closedElsewhere: true }); return; }
        const C = await vatDraftCheck(tx, f, period, o.source);
        // 🔒 nothing in a locked period
        if (lockedAt(f, C.data.to)) { out.locked++; return; }
        await upsertDraft(tx, { kind: VAT_KIND, firmId: f.id, period, data: C.data, problems: C.problems });
        out.drafts++;
        if (C.problems.length) out.problems++;
      });
    } catch (e) { out.errors.push(`${f.name}: ${(e as Error).message}`); }
  }
  await noteAutoRun(db, 'vat', `нацрти ДДВ-04: ${out.drafts}${out.problems ? ` (со проблеми ${out.problems})` : ''}${out.errors.length ? ` · грешки ${out.errors.length}` : ''}`, { drafts: out.drafts });
  return out;
}

/**
 * Bulk close of the ticked drafts WITHOUT problems: each one re-checked now (still no problems, same field 31), then
 * the existing `closeVatPeriod` (one transaction per firm, audited `ddvClose` + `autoVatClose`).
 */
export async function closeVatDrafts(db: Tx, a: { ids: readonly string[]; userId: string; allowed: (firmId: string) => boolean; source?: VatDocumentSource }): Promise<{ closed: string[]; skipped: string[] }> {
  const closed: string[] = [], skipped: string[] = [];
  const D = (await listDrafts(db, { kind: VAT_KIND })).filter((d) => a.ids.includes(d.id));
  const F = await autoFirms(db, { ids: D.map((d) => d.firmId) });
  for (const d of D) {
    const f = F.find((x) => x.id === d.firmId);
    if (!f) continue;
    if (!a.allowed(f.id)) { skipped.push(`${f.name}: немате право`); continue; }
    try {
      const r = await db.transaction(async (tx) => {
        const C = await vatDraftCheck(tx, f, d.period, a.source);
        if (C.problems.length) throw new Error(C.problems[0]!);
        if (C.data.f31 !== Number(d.data.f31)) throw new Error(`пријавата е променета (поле 31: ${C.data.f31}) – прегледајте ја повторно`);
        const r = await closeVatPeriod(tx, { firmId: f.id, period: d.period, userId: a.userId, source: a.source });
        await decideDraft(tx, d.id, 'confirmed', a.userId, { journal: r.journal?.number ?? null });
        await audit(tx, { userId: a.userId, firmId: f.id, action: 'autoVatClose', entityType: 'vatPeriod', entityId: r.row.id, data: { period: d.period, field31: C.data.f31 } });
        return r;
      });
      closed.push(`${f.name}${r.journal ? ` (налог ${r.journal.number})` : ''}`);
    } catch (e) { skipped.push(`${f.name}: ${(e as Error).message}`); }
  }
  return { closed, skipped };
}
