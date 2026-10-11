'use server';
/** Legacy appointment ACT (10136) and client cards (10166). Reminders go through the Phase 6 mail queue. */
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { apptReminder } from '@wise/core/industry';
import {
  appointments, deleteDoc, firmApptConfig, invoiceAppointment, payApptAtTill, saveAppointment, saveDoc, saveIndustryConfig, setApptStatus, type ClientNote,
} from '@wise/db';
import { indRun, num, str, today } from '@/lib/industry';
import { importClients } from '@wise/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import type { FormState } from '@/components/bank-form';

const P = ['/termini', '/kartoni', '/izlez', '/kasa'];

export async function saveApptAction(_p: FormState, f: FormData): Promise<FormState> {
  let date = '';
  const r = await indRun('apSaveB', P, async ({ tx, a }) => {
    date = str(f.get('date'));
    const x = await saveAppointment(tx, a, {
      id: str(f.get('id')) || null, date, time: str(f.get('time')), dur: num(f.get('dur')), res: str(f.get('res')), partnerId: str(f.get('partner')) || null,
      client: str(f.get('client')), phone: str(f.get('phone')), email: str(f.get('email')), svc: str(f.get('svc')), itemId: str(f.get('item')) || null, price: num(f.get('price')),
      status: (str(f.get('status')) || 'booked') as 'booked', note: str(f.get('note')),
    });
    return x.clash ? `Зачувано. ⚠ Се преклопува со термин во ${x.clash}.` : 'Терминот е зачуван.';
  });
  if (r.error || r.ok?.includes('⚠')) return r;
  redirect(`/termini?d=${date}`);
}

export async function apptStepAction(id: string, step: 'cancel' | 'inv' | 'till' | 'rem' | 'remwa'): Promise<FormState> {
  const mail: string[] = [];
  const r = await indRun(step === 'inv' ? 'apInv' : step === 'cancel' ? 'apCancel' : 'apSaveB', P, async ({ tx, a, firm, u }) => {
    if (step === 'cancel') { await setApptStatus(tx, a, id, 'cancel'); return 'Терминот е откажан.'; }
    if (step === 'inv') return `Издадена е фактура ${(await invoiceAppointment(tx, a, id, today())).number}.`;
    if (step === 'till') { await payApptAtTill(tx, a, id, today()); return 'Наплатено на каса (дневен промет).'; }
    const [x] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.firmId, a.firmId))).limit(1);
    // legacy `apRemOne`: e-mail when there is one, else WhatsApp (marked as reminded), else „Нема телефон ни е-пошта.“
    if (step === 'remwa') { await setApptStatus(tx, a, id, 'reminded'); return 'Означено како потсетено (WhatsApp).'; }
    if (!x?.email || !validAddresses(x.email)) return x?.phone ? 'Клиентот нема е-пошта – испратете го потсетникот преку WhatsApp.' : 'Нема телефон ни е-пошта.';
    const res = firmApptConfig(firm).res.find((y) => y.id === x.res)?.name ?? '';
    mail.push(await queueMail(tx, { firmId: firm.id, to: x.email, subject: `Потсетник за термин ${x.date.split('-').reverse().join('.')} ${x.time}`, html: `<p>${apptReminder(x, res, firm)}</p>`, entityType: 'appointment', entityId: x.id, userId: u.id }));
    await setApptStatus(tx, a, id, 'reminded');
    return `Потсетникот е испратен на ${x.email}.`;
  });
  if (mail.length) await dispatchMail(mail);
  return r;
}

export async function saveApptConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('svCfgSave', P, async ({ tx, a, firm }) => {
    const old = firmApptConfig(firm).res;
    const res = str(f.get('res')).split('\n').map((x) => x.trim()).filter(Boolean).map((n) => old.find((r) => r.name === n) ?? { id: randomUUID(), name: n });
    await saveIndustryConfig(tx, a, 'appt', { from: str(f.get('from')) || '08:00', to: str(f.get('to')) || '20:00', step: Number(f.get('step')) || 30, res, rate: Number(f.get('rate')) || 18 });
    return 'Зачувано.';
  });
}

export async function saveNoteAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('kcSave', P, async ({ tx, a, u }) => {
    const text = String(f.get('text') ?? ''), title = str(f.get('title'));
    if (!text.trim() && !title) return 'Внесете текст.';
    await saveDoc<ClientNote>(tx, a, 'cnote', { id: str(f.get('id')) || null, date: str(f.get('date')) || today(), data: { partnerId: str(f.get('partner')), title, text, conf: f.get('conf') === 'on', by: u.name } });
    return 'Белешката е зачувана.';
  });
}
export async function deleteNoteAction(id: string): Promise<FormState> {
  return indRun('kcSave', P, async ({ tx, a }) => { await deleteDoc(tx, a, 'cnote', id); return 'Избришано.'; });
}

/** Clients / patients from Excel (partners matched by name / ЕДБ; birth date and note → client card). */
export async function importClientsAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('apSaveB', ['/kartoni', '/termini', '/partneri'], async ({ tx, a }) => {
    let rows: unknown = [];
    try { rows = JSON.parse(String(f.get('rows') ?? '[]')); } catch { rows = []; }
    const r = await importClients(tx, a, (Array.isArray(rows) ? rows : []).filter(Array.isArray) as (string | number | null)[][]);
    return `Додадени ${r.added}, ажурирани ${r.updated}.${r.errors.length ? ' Грешки: ' + r.errors.slice(0, 5).join(' ') : ''}`;
  });
}
