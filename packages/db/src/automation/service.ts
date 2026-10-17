/**
 * P43 — „Потсетници за сервис“ in the hourly `reminders` job (once a day): per firm with customer vehicles, the
 * vehicles due within 30 days (`serviceReminders`, the screen's own rule) and the PREPARED message for each owner
 * (`reminderText`, the WhatsApp text). Stored as one draft per firm (`automation_drafts` kind `service`, period `-`);
 * nothing is sent — WhatsApp / e-mail stay the office's click on the potsetnici screen.
 */
import { eq, inArray } from 'drizzle-orm';
import { reminderText, serviceReminders } from '@wise/core/industry';
import { todaySkopje } from '@wise/core/office';
import type { Tx } from '../audit';
import { firmAutoConfig } from '../industry/auto';
import { customerVehicles, partners, workOrders } from '../schema/index';
import { autoFirms, autoLastRun, autoOn, dropDraft, noteAutoRun, upsertDraft } from './common';

export const SVC_KIND = 'service';

export interface AutoServiceResult { firms: number; messages: number; skipped: boolean }

export async function runServiceReminders(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoServiceResult> {
  const out: AutoServiceResult = { firms: 0, messages: 0, skipped: false };
  const today = o.today ?? todaySkopje();
  if (!o.force) {
    if (!(await autoOn(db, 'service'))) return { ...out, skipped: true };
    // hourly job, daily work
    const last = await autoLastRun(db, 'service');
    if (last && (last.data?.day ?? todaySkopje(last.at)) === today) return { ...out, skipped: true };
  }
  const V = await db.select().from(customerVehicles);
  const F = await autoFirms(db, { ids: [...new Set(V.map((v) => v.firmId))] });
  for (const f of F) {
    const Vf = V.filter((v) => v.firmId === f.id);
    const W = await db.select().from(workOrders).where(eq(workOrders.firmId, f.id));
    const R = serviceReminders(Vf, W, firmAutoConfig(f), today);
    await db.transaction(async (tx) => {
      if (!R.length) { await dropDraft(tx, SVC_KIND, f.id, '-'); return; }
      const pids = [...new Set(R.map((x) => x.v.partnerId).filter((x): x is string => !!x))];
      const P = pids.length ? await tx.select({ id: partners.id, name: partners.name, phone: partners.phone, email: partners.email }).from(partners).where(inArray(partners.id, pids)) : [];
      const rows = R.map((x) => {
        const p = P.find((y) => y.id === x.v.partnerId);
        return { vehicleId: x.v.id, plate: x.v.plate, owner: p?.name ?? '', phone: !!p?.phone, email: !!p?.email, late: x.late, why: x.why, text: reminderText(x.v, x.last.nextNote, { name: f.name, phone: f.phone }) };
      });
      await upsertDraft(tx, { kind: SVC_KIND, firmId: f.id, period: '-', data: { at: today, rows } });
    });
    if (R.length) { out.firms++; out.messages += R.length; }
  }
  await noteAutoRun(db, 'service', `${out.firms} фирми · подготвени пораки ${out.messages}`, { messages: out.messages, day: today });
  return out;
}
