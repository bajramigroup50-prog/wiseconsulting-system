import 'server-only';
/**
 * Autopilot „Затворање на период“ data (legacy `apClGo` → `apCloseHTML` / `apClDdvHTML`): for every VAT firm whose
 * VAT period matches the chosen mode, the ДДВ-04 fields of that period, whether it is already closed, and what is
 * still missing (open problems of the autopilot check and entries waiting for approval).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { apClPeriodFor, type ApClMode } from '@wise/core/office/ap-close';
import { autopilotFindings, clientEntries, computeVatPeriod, firmVatPeriodKind, vatPeriods, vatPeriodLabel, type Firm } from '@wise/db';
import { db } from './db';
import { vatSource } from './vat-source';

export interface ApClRow {
  firm: Firm;
  period: string;
  label: string;
  kind: 'month' | 'quarter';
  fields: Record<string, number>;
  closed: boolean;
  ready: boolean;
  miss: string[];
  error?: string;
}

export async function apCloseRows(F: readonly Firm[], mode: ApClMode, td: string): Promise<ApClRow[]> {
  const V = F.filter((f) => f.vatRegistered && apClPeriodFor(mode, firmVatPeriodKind(f), td));
  if (!V.length) return [];
  const ids = V.map((f) => f.id);
  const [bad, pend, VP] = await Promise.all([
    db().select({ f: autopilotFindings.firmId, txt: autopilotFindings.txt }).from(autopilotFindings)
      .where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), eq(autopilotFindings.lvl, 'bad'))),
    db().select({ f: clientEntries.firmId }).from(clientEntries).where(and(inArray(clientEntries.firmId, ids), eq(clientEntries.status, 'pending'))),
    db().select({ f: vatPeriods.firmId, p: vatPeriods.period, st: vatPeriods.status }).from(vatPeriods).where(inArray(vatPeriods.firmId, ids)),
  ]);
  const out: ApClRow[] = [];
  for (const f of V) {
    const kind = firmVatPeriodKind(f);
    const period = apClPeriodFor(mode, kind, td)!;
    const miss = bad.filter((x) => x.f === f.id).map((x) => x.txt);
    const np = pend.filter((x) => x.f === f.id).length;
    if (np) miss.push(`${np} документи од клиентот чекаат одобрување`);
    const closed = VP.some((x) => x.f === f.id && x.p === period && x.st === 'closed');
    let fields: Record<string, number> = {}, error: string | undefined;
    try { fields = (await computeVatPeriod(db(), f, period, vatSource)).fields as unknown as Record<string, number>; } catch (e) { error = e instanceof Error ? e.message : 'грешка'; miss.push(`ДДВ-04: ${error}`); }
    out.push({ firm: f, period, label: vatPeriodLabel(period), kind, fields, closed, ready: !miss.length, miss, error });
  }
  return out.sort((a, b) => Number(a.ready) - Number(b.ready) || a.firm.name.localeCompare(b.firm.name, 'mk'));
}
