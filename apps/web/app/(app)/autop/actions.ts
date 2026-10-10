'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { AP_TYPE_KEYS } from '@wise/core/office/autop-view';
import { audit, autopilotFindings, autopilotMessages, getOfficeProfile, patchOfficeProfile, runAutopilot, sendAutopilotMessage, type OfficeProfile } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail } from '@/lib/mail';
import { fv, isUuid, officeError } from '@/lib/office';
import { selectFirm } from '../actions';

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
    await dispatchMail(r.mailIds); // messages sent automatically (`apAuto`) by e-mail
    revalidatePath('/autop');
    return { ok: `Проверени ${r.firms} фирми: ${r.findings} наоди (${r.newBad} нови проблеми), ${r.messages} нови пораки.` };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `apSendOne` → `apSend`: to the client portal and, when the firm has an e-mail, by e-mail (the `mail_log`
 * row is queued in the same transaction and handed to the `mail.send` queue after COMMIT).
 */
export async function sendMessage(key: string): Promise<ActionState> {
  try {
    const [m] = await db().select({ firmId: autopilotMessages.firmId }).from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
    if (!m) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', m.firmId);
    const r = await db().transaction((tx) => sendAutopilotMessage(tx, key, { portal: true, mail: true }, u.id, u.name));
    const d = await dispatchMail(r.mailIds);
    revalidatePath('/autop');
    if (!r.channels.length) return { ok: 'Веќе е испратено.' };
    return { ok: `Испратено: ${r.channels.join(', ')}${r.channels.includes('е-пошта') ? '' : ' (фирмата нема е-пошта)'}${d.deferred ? ' – е-поштата ќе замине за неколку минути' : ''}.` };
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

/**
 * Legacy `apSendOne` with the subject / body as edited on the screen and the channel choice
 * („📨 Испрати (портал + е-пошта)“ or „Само портал“). Also sends an ad-hoc message (legacy `inspAsk` / `apClMsg` →
 * tab `msg1`): a `key` that does not exist yet is stored as a new message of the firm first, so it is logged and
 * not proposed twice.
 */
export async function sendClientMessage(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const key = fv(f, 'key');
    const subject = fv(f, 'subject');
    const body = String(f.get('body') ?? '').trim();
    if (!key || !subject || !body) return { error: 'Внесете наслов и текст на пораката.' };
    const [m] = await db().select({ firmId: autopilotMessages.firmId, status: autopilotMessages.status }).from(autopilotMessages).where(eq(autopilotMessages.key, key)).limit(1);
    const firmId = m?.firmId ?? fv(f, 'firmId');
    if (!isUuid(firmId)) return { error: 'Непозната фирма.' };
    const u = await requireCan('office', firmId);
    if (m?.status === 'sent') return { ok: 'Веќе е испратено.' };
    const portalOnly = fv(f, 'only') === 'portal';
    const r = await db().transaction(async (tx) => {
      if (m) await tx.update(autopilotMessages).set({ subject: subject.slice(0, 300), body: body.slice(0, 20000) }).where(eq(autopilotMessages.key, key));
      else await tx.insert(autopilotMessages).values({ key: key.slice(0, 300), firmId, type: (fv(f, 'type') ?? 'msg').slice(0, 20), subject: subject.slice(0, 300), body: body.slice(0, 20000) });
      return sendAutopilotMessage(tx, key, { portal: true, mail: !portalOnly }, u.id, u.name);
    });
    const d = await dispatchMail(r.mailIds);
    revalidatePath('/autop');
    if (!r.channels.length) return { ok: 'Веќе е испратено.' };
    return { ok: `Испратено: ${r.channels.join(', ')}${portalOnly || r.channels.includes('е-пошта') ? '' : ' (фирмата нема е-пошта)'}${d.deferred ? ' – е-поштата ќе замине за неколку минути' : ''}.` };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `data-apauto` checkbox: one message type to „автоматски“ (straight to the client, portal + e-mail) or back to
 * „рачно“. Turning it on also sends the messages of that type that are waiting now (legacy did the same after the confirm).
 */
export async function setAutoType(type: string, on: boolean): Promise<ActionState> {
  try {
    if (!(AP_TYPE_KEYS as readonly string[]).includes(type)) return { error: 'Непознат вид.' };
    const u = await requireCan('settings');
    const O = await getOfficeProfile(db());
    const mailIds: string[] = [];
    let n = 0;
    await db().transaction(async (tx) => {
      await patchOfficeProfile(tx, { apAuto: { ...(O.apAuto ?? {}), [type]: on } }, u.id);
      await audit(tx, { userId: u.id, action: 'apCfg', entityType: 'app_settings', entityId: 'office', data: { type, auto: on } });
      if (!on) return;
      const W = await tx.select({ key: autopilotMessages.key }).from(autopilotMessages).where(and(eq(autopilotMessages.type, type), eq(autopilotMessages.status, 'proposed')));
      for (const w of W) { mailIds.push(...(await sendAutopilotMessage(tx, w.key, { portal: true, mail: true }, u.id, u.name)).mailIds); n++; }
    });
    await dispatchMail(mailIds);
    revalidatePath('/autop');
    return { ok: on ? `✓ Автоматско праќање вклучено.${n ? ` 🤖 Испратени ${n} пораки.` : ''}` : 'Рачно праќање.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `apFirmOpen` / `inspOpen` / `lrOpen`: select the firm and open its screen. */
export async function openFirm(firmId: string, view: string): Promise<ActionState> {
  if (!isUuid(firmId) || !/^[A-Za-z_]+$/.test(view)) return { error: 'Непозната фирма.' };
  try { await selectFirm(firmId); } catch (e) { return { error: (e as Error).message }; }
  redirect(`/${view}`);
}
