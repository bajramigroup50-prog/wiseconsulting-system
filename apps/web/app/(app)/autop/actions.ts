'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit, autopilotFindings, autopilotMessages, patchOfficeProfile, runAutopilot, sendAutopilotMessage, type OfficeProfile } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { officeError } from '@/lib/office';

/**
 * Legacy `apGo`: run the checks now (the worker also runs them every 6 hours).
 * Runs in-process — every check reads the database only. Office-wide, so `office` without a firm;
 * the run covers all active firms like the scheduled job (legacy limited it to `firmAllowed`, the screen
 * still only shows the user's firms).
 */
export async function runNow(): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const r = await runAutopilot(db(), { trigger: 'manual', userId: u.id });
    revalidatePath('/autop');
    return { ok: `Проверени ${r.firms} фирми: ${r.findings} наоди (${r.newBad} нови проблеми), ${r.messages} нови пораки.` };
  } catch (e) { return officeError(e); }
}

/** Legacy `apSendOne`: send a proposed message to the client portal. TODO(mail): also by e-mail via Phase 6. */
export async function sendMessage(key: string): Promise<ActionState> {
  try {
    const [m] = await db().select({ firmId: autopilotMessages.firmId }).from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
    if (!m) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', m.firmId);
    const ok = await db().transaction((tx) => sendAutopilotMessage(tx, key, { portal: true, mail: true }, u.id, u.name));
    revalidatePath('/autop');
    return { ok: ok.length ? `Испратено: ${ok.join(', ')}` : 'Веќе е испратено.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `apSkip`. */
export async function skipMessage(key: string): Promise<ActionState> {
  try {
    const [m] = await db().select({ firmId: autopilotMessages.firmId }).from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
    if (!m) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', m.firmId);
    await db().transaction(async (tx) => {
      await tx.update(autopilotMessages).set({ status: 'skipped', sentBy: u.name, sentAt: new Date() }).where(eq(autopilotMessages.key, key));
      await audit(tx, { userId: u.id, firmId: m.firmId, action: 'apSkip', entityType: 'autopilot_message', entityId: key });
    });
    revalidatePath('/autop');
    return { ok: 'Прескокнато.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `alAck`: acknowledge a finding (stays hidden until it changes). */
export async function ackFinding(id: number): Promise<ActionState> {
  try {
    const [f] = await db().select({ firmId: autopilotFindings.firmId }).from(autopilotFindings).where(eq(autopilotFindings.id, id)).limit(1);
    if (!f) return { error: 'Не постои.' };
    const u = await requireCan('office', f.firmId);
    await db().transaction(async (tx) => {
      await tx.update(autopilotFindings).set({ ackBy: u.id, ackAt: new Date() }).where(eq(autopilotFindings.id, id));
      await audit(tx, { userId: u.id, firmId: f.firmId, action: 'alAck', entityType: 'autopilot_finding', entityId: String(id) });
    });
    revalidatePath('/autop');
    revalidatePath('/izvestuvanja');
    return { ok: 'Потврдено.' };
  } catch (e) { return officeError(e); }
}

/** Autopilot settings (legacy `apAuto` in `appsettings/office`, now a jsonb merge — FIX #7). Owner/admin only. */
export async function saveAutopilotSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    const types = ['inv', 'out', 'cash', 'izv', 'vat'] as const;
    const patch: Partial<OfficeProfile> = {
      apAuto: Object.fromEntries(types.map((t) => [t, f.get(`auto_${t}`) === 'on'])),
      apTasks: f.get('apTasks') === 'on',
    };
    await db().transaction(async (tx) => {
      await patchOfficeProfile(tx, patch, u.id);
      await audit(tx, { userId: u.id, action: 'apCfg', entityType: 'app_settings', entityId: 'office', data: patch as Record<string, unknown> });
    });
    revalidatePath('/autop');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}
