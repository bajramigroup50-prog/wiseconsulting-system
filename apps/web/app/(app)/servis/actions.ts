'use server';
/**
 * Legacy auto-service ACT (9681 `woNewB … woPdf`, 9704 `cvNew … cvSave`, 9741 `potDone`, `potMail`, `autoCfgSave`,
 * `digApply` for `cveh` / `vreg` 10304). Every action runs through `indRun` (`requireCan` + one transaction with the
 * audit rows). Legacy `dlToWo` (part from the search into the open order) is client-side, as in legacy: the order
 * editor keeps its unsaved state while the parts search is open and adds the part on return.
 */
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { serviceReminders, vehicleLabel } from '@wise/core/industry';
import {
  customerVehicles, deleteWorkOrder, firmAutoConfig, importCustomerVehicles, invoiceWorkOrder, markVehicleReminded, partners, saveAutoConfig, saveCustomerVehicle,
  saveWorkOrder, workOrders, type WorkOrderLabour, type WorkOrderPart,
} from '@wise/db';
import { markAiReadsSaved } from '@/lib/ai';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { indRun, num, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/servis', '/vozila', '/delovi', '/potsetnici', '/izlez'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface WorkOrderPayload {
  id: string; number: string; date: string; vehicleId: string; partnerId: string; km: string; mechanicId: string; status: 'open' | 'work' | 'done';
  complaint: string; work: string; nextKm: string; nextDate: string; nextNote: string; parts: WorkOrderPart[]; labour: WorkOrderLabour[];
}

const n0 = (s: string) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')) || null);

/** Legacy `woSaveB` (the editor posts its state as JSON). */
export async function saveWorkOrderAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const w = JSON.parse(str(f.get('payload')) || '{}') as WorkOrderPayload;
  const r = await indRun('woSaveB', P, async ({ tx, a }) => {
    const x = await saveWorkOrder(tx, a, {
      id: w.id || null, number: w.number, date: w.date, vehicleId: w.vehicleId, partnerId: w.partnerId, km: n0(w.km), complaint: w.complaint, work: w.work,
      parts: w.parts ?? [], labour: w.labour ?? [], status: w.status, mechanicId: w.mechanicId || null, nextKm: n0(w.nextKm), nextDate: w.nextDate || null, nextNote: w.nextNote,
    });
    id = x.id;
    return `Работниот налог ${x.number} е зачуван.`;
  });
  if (r.error) return r;
  redirect(str(f.get('then')) === 'stay' ? `/servis?id=${id}&saved=1` : '/servis');
}

/**
 * Legacy `woInv` (status done, save, then `bzInvDraft`): the order is saved and a DRAFT invoice is created; the user
 * lands in the invoice editor, reviews it and saves — only then is it booked and are the parts issued from stock.
 * `force` = the legacy „Сепак да се фактурира?“ confirm for short stock.
 */
export async function invoiceWorkOrderAction(_p: FormState, f: FormData): Promise<FormState> {
  const w = JSON.parse(str(f.get('payload')) || '{}') as WorkOrderPayload;
  let inv = '';
  const r = await indRun('woInv', P, async ({ tx, a }) => {
    const x = await saveWorkOrder(tx, a, {
      id: w.id || null, number: w.number, date: w.date, vehicleId: w.vehicleId, partnerId: w.partnerId, km: n0(w.km), complaint: w.complaint, work: w.work,
      parts: w.parts ?? [], labour: w.labour ?? [], status: 'done', mechanicId: w.mechanicId || null, nextKm: n0(w.nextKm), nextDate: w.nextDate || null, nextNote: w.nextNote,
    });
    const i = await invoiceWorkOrder(tx, a, x.id, today(), f.get('force') === 'on');
    inv = i.id;
    return 'Проверете ја фактурата и зачувајте – деловите се раздолжуваат од залиха.';
  });
  if (r.error) return r;
  redirect(`/izlez?edit=${inv}`);
}

export async function deleteWorkOrderAction(id: string): Promise<FormState> {
  const r = await indRun('del', P, async ({ tx, a }) => { await deleteWorkOrder(tx, a, id); return 'Избришано.'; });
  if (r.error) return r;
  redirect('/servis');
}

/* ---------------- vehicles ---------------- */

/**
 * Legacy `cvSave`; from the work order (`back=servis`, „+ Ново возило…“) the new vehicle goes back into that order
 * (`wo` = its id or `new`; the editor restores its unsaved state, `r=1`). A vehicle read from a registration
 * certificate (`vreg` = the AI read) marks the read as used.
 */
export async function saveCustomerVehicleAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('cvSave', P, async ({ tx, a }) => {
    id = await saveCustomerVehicle(tx, a, {
      id: str(f.get('id')) || null, plate: str(f.get('plate')), vin: str(f.get('vin')), make: str(f.get('make')), model: str(f.get('model')), year: num(f.get('year')),
      engine: str(f.get('engine')), fuel: str(f.get('fuel')), partnerId: str(f.get('partner')) || null, km: num(f.get('km')), note: str(f.get('note')),
    });
    const ai = str(f.get('vreg'));
    if (ai) await markAiReadsSaved(tx, a.firmId, [ai]);
    return 'Возилото е зачувано.';
  });
  if (r.error) return r;
  const back = str(f.get('back'));
  const wo = str(f.get('wo'));
  redirect(back === 'servis' ? `/servis?id=${/^[0-9a-f-]{36}$/i.test(wo) ? wo : 'new'}&r=1&veh=${id}` : `/vozila?sel=${id}`);
}

/** Legacy „Возила од Excel“ (`DIG.cveh`): rows = JSON array of arrays, header row first (recognised by name). */
export async function importCustomerVehiclesAction(_p: FormState, f: FormData): Promise<FormState> {
  let aoa: unknown[][];
  try { aoa = JSON.parse(str(f.get('rows')) || '[]') as unknown[][]; } catch { return { error: 'Неважечка датотека.' }; }
  if (!Array.isArray(aoa) || aoa.length < 2 || !aoa.every(Array.isArray)) return { error: 'Датотеката нема редови со податоци.' };
  if (aoa.length > 5001) return { error: 'Премногу редови (најмногу 5000).' };
  return indRun('cvSave', P, async ({ tx, a }) => {
    const r = await importCustomerVehicles(tx, a, aoa);
    return `Внесени ${r.added}${r.skipped.length ? ` · прескокнати ${r.skipped.length}: ${r.skipped.slice(0, 6).join(', ')}` : ''}.`;
  });
}

/* ---------------- reminders ---------------- */

export async function reminderDoneAction(vehicleId: string): Promise<FormState> {
  return indRun('potDone', P, async ({ tx, a }) => { await markVehicleReminded(tx, a, vehicleId, today()); return 'Означено – возилото се крие 30 дена.'; });
}

/**
 * Legacy `potMail` (sent through Gmail MCP in legacy): the reminder is queued in `mail_log` in the same transaction
 * as the contact mark, and sent by the worker.
 */
export async function reminderMailAction(vehicleId: string): Promise<FormState> {
  const ids: string[] = [];
  const r = await indRun('potMail', P, async ({ tx, a, firm, u }) => {
    const [v] = await tx.select().from(customerVehicles).where(and(eq(customerVehicles.id, vehicleId), eq(customerVehicles.firmId, a.firmId))).limit(1);
    if (!v) return 'Возилото не постои.';
    const [p] = v.partnerId ? await tx.select().from(partners).where(eq(partners.id, v.partnerId)).limit(1) : [];
    if (!p?.email || !validAddresses(p.email)) return 'Сопственикот нема важечка е-пошта.';
    const W = await tx.select().from(workOrders).where(and(eq(workOrders.firmId, a.firmId), eq(workOrders.vehicleId, v.id)));
    const x = serviceReminders([v], W, firmAutoConfig(firm), today())[0];
    if (!x) return 'Возилото нема потсетник.';
    const fp = firm.phone ?? '';
    const body = `Почитувани,\n\nВе потсетуваме дека за возилото ${v.plate ?? ''} (${[v.make, v.model].filter(Boolean).join(' ')}) наскоро е потребен ${x.last.nextNote || 'редовен сервис'} (${x.why}).\nПоследен сервис: ${x.last.date.split('-').reverse().join('.')}${x.last.km ? ', ' + x.last.km + ' км' : ''}.\n\nЗакажете термин на ${fp || 'нашиот телефон'}.\n\nСо почит,\n${firm.name}`;
    ids.push(await queueMail(tx, { firmId: a.firmId, to: p.email, subject: `Потсетник за сервис – ${v.plate ?? vehicleLabel(v)}`, html: `<p>${esc(body).replace(/\n/g, '<br>')}</p>`, entityType: 'customer_vehicle', entityId: v.id, userId: u.id }));
    await markVehicleReminded(tx, a, v.id, today(), 'mail');
    return `Испратено на ${p.email}.`;
  });
  if (!r.error) await dispatchMail(ids);
  return r;
}

export async function saveAutoConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('autoCfgSave', P, async ({ tx, a }) => {
    await saveAutoConfig(tx, a, { hr: num(f.get('hr')) ?? 0, km: num(f.get('km')) ?? 15000, mon: num(f.get('mon')) ?? 12 });
    return 'Зачувано.';
  });
}

