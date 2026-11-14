'use server';
/** Server actions of the office's sales CRM (`/crm`) — owner only (`crmAction`). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { CRM_OPEN, crmOfferNormalize, crmOfferNumber, crmStageName, isCrmSource, isCrmStage, type CrmOffer } from '@wise/core/firms/crm';
import { KD_SVC } from '@wise/core/firms/kdog';
import { audit, crmLeads, crmNotes, crmOffers, nextOfficeNumber } from '@wise/db';
import { db } from '@/lib/db';
import { fv, fdate, isUuid, officeError, today } from '@/lib/office';
import type { RowResult } from '@/components/row-action';
import { crmAction } from './lib';

const done = (id?: string) => { revalidatePath('/crm'); if (id) revalidatePath(`/crm?id=${id}`); revalidatePath('/'); };
const intOrNull = (v: string | null) => { const n = Math.round(Number(v)); return v && Number.isFinite(n) && n >= 0 ? n : null; };
const moneyOrNull = (v: string | null) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return v && Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null; };

/** New / edited lead (form of the lead card). */
export async function saveLead(_p: RowResult, f: FormData): Promise<RowResult> {
  let id: string;
  try {
    const u = await crmAction();
    const company = fv(f, 'company');
    if (!company) return { error: 'Внесете назив на фирмата.' };
    const edb = fv(f, 'edb')?.replace(/\s/g, '') ?? null;
    if (edb && !/^(MK)?\d{13}$/i.test(edb)) return { error: 'ЕДБ има 13 цифри (со или без MK).' };
    const src = fv(f, 'source');
    const stage = fv(f, 'stage');
    const v = {
      company: company.slice(0, 300), edb, contact: fv(f, 'contact'), phone: fv(f, 'phone'), email: fv(f, 'email'), city: fv(f, 'city'), address: fv(f, 'address'),
      source: isCrmSource(src) ? src : 'drugo', sourceNote: fv(f, 'sourceNote'), activity: fv(f, 'activity'),
      employees: intOrNull(fv(f, 'employees')), fee: moneyOrNull(fv(f, 'fee')),
      nextStep: fv(f, 'nextStep'), nextDate: fdate(f, 'nextDate'), note: fv(f, 'note'),
    };
    const old = String(f.get('id') ?? '');
    if (isUuid(old)) {
      const [b] = await db().select().from(crmLeads).where(eq(crmLeads.id, old)).limit(1);
      if (!b) return { error: 'Записот не постои.' };
      await db().update(crmLeads).set(v).where(eq(crmLeads.id, old));
      id = old;
    } else {
      const [r] = await db().insert(crmLeads).values({ ...v, stage: isCrmStage(stage) ? stage : 'nov', createdBy: u.id, assignedTo: u.id }).returning({ id: crmLeads.id });
      id = r!.id;
      await audit(db(), { userId: u.id, firmId: null, action: 'crmLead', entityType: 'crm_lead', entityId: id, data: { company } });
    }
  } catch (e) { return officeError(e); }
  done(id);
  redirect(`/crm?id=${id}`);
}

/** Move a lead to another stage (kanban drag / buttons). `Изгубен` takes a reason. */
export async function moveStage(id: string, stage: string, reason?: string): Promise<RowResult> {
  try {
    const u = await crmAction();
    if (!isUuid(id) || !isCrmStage(stage)) return { error: 'Неважечка фаза.' };
    const [b] = await db().select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!b) return { error: 'Записот не постои.' };
    if (b.stage === stage) return {};
    const closed = !(CRM_OPEN as readonly string[]).includes(stage);
    await db().transaction(async (tx) => {
      await tx.update(crmLeads).set({ stage, closedAt: closed ? new Date() : null, lostReason: stage === 'izguben' ? (reason?.trim().slice(0, 500) || b.lostReason) : b.lostReason }).where(eq(crmLeads.id, id));
      await tx.insert(crmNotes).values({ leadId: id, kind: 'stage', text: `${crmStageName(b.stage)} → ${crmStageName(stage)}${stage === 'izguben' && reason?.trim() ? ` (${reason.trim().slice(0, 500)})` : ''}`, createdBy: u.id });
    });
  } catch (e) { return officeError(e); }
  done(id);
  return { ok: 'Фазата е променета.' };
}

export async function moveStageForm(_p: RowResult, f: FormData): Promise<RowResult> {
  return moveStage(String(f.get('id') ?? ''), String(f.get('stage') ?? ''), fv(f, 'reason') ?? undefined);
}

/** Note / call / meeting + optionally the next step with a date (the reminder on the owner's home dashboard). */
export async function addNote(_p: RowResult, f: FormData): Promise<RowResult> {
  const id = String(f.get('id') ?? '');
  try {
    const u = await crmAction();
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    const text = fv(f, 'text');
    const kind = ['note', 'call', 'meeting', 'mail'].includes(String(f.get('kind'))) ? String(f.get('kind')) : 'note';
    const nextStep = fv(f, 'nextStep'), nextDate = fdate(f, 'nextDate');
    if (!text && !nextStep && !nextDate) return { error: 'Внесете белешка или следен чекор.' };
    await db().transaction(async (tx) => {
      if (text) await tx.insert(crmNotes).values({ leadId: id, kind, text: text.slice(0, 4000), createdBy: u.id });
      if (nextStep || nextDate || f.get('clearNext') === 'on') await tx.update(crmLeads).set(f.get('clearNext') === 'on' && !nextStep && !nextDate ? { nextStep: null, nextDate: null } : { nextStep, nextDate }).where(eq(crmLeads.id, id));
    });
  } catch (e) { return officeError(e); }
  done(id);
  return { ok: 'Зачувано.' };
}

/** „✓ Завршено“ on a reminder: clears the next step (logged as a note). */
export async function doneNext(id: string): Promise<RowResult> {
  try {
    const u = await crmAction();
    const [b] = isUuid(id) ? await db().select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1) : [];
    if (!b) return { error: 'Записот не постои.' };
    await db().transaction(async (tx) => {
      if (b.nextStep || b.nextDate) await tx.insert(crmNotes).values({ leadId: id, kind: 'note', text: `✓ Завршено: ${b.nextStep ?? 'следен чекор'}${b.nextDate ? ` (${b.nextDate.split('-').reverse().join('.')})` : ''}`, createdBy: u.id });
      await tx.update(crmLeads).set({ nextStep: null, nextDate: null }).where(eq(crmLeads.id, id));
    });
  } catch (e) { return officeError(e); }
  done(id);
  return { ok: 'Завршено.' };
}

export async function deleteLead(id: string): Promise<RowResult> {
  try {
    const u = await crmAction();
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    const [b] = await db().delete(crmLeads).where(eq(crmLeads.id, id)).returning({ company: crmLeads.company });
    if (b) await audit(db(), { userId: u.id, firmId: null, action: 'crmLeadDelete', entityType: 'crm_lead', entityId: id, data: { company: b.company } });
  } catch (e) { return officeError(e); }
  revalidatePath('/crm');
  redirect('/crm?v=lista');
}

export async function deleteNote(id: string, leadId: string): Promise<RowResult> {
  try {
    await crmAction();
    if (isUuid(id) && isUuid(leadId)) await db().delete(crmNotes).where(and(eq(crmNotes.id, id), eq(crmNotes.leadId, leadId)));
  } catch (e) { return officeError(e); }
  done(leadId);
  return {};
}

/* ---------------- offers ---------------- */

/** Save the offer (new → number ПН-NNN/year from the office counter); the lead moves to „Понуда“ when it was earlier. */
export async function saveOffer(_p: RowResult, f: FormData): Promise<RowResult> {
  const leadId = String(f.get('leadId') ?? '');
  let oid = String(f.get('offerId') ?? '');
  try {
    const u = await crmAction();
    const [l] = isUuid(leadId) ? await db().select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1) : [];
    if (!l) return { error: 'Записот не постои.' };
    const p: CrmOffer = crmOfferNormalize({
      date: fv(f, 'date'), validUntil: fv(f, 'validUntil'), start: fv(f, 'start'), svc: KD_SVC.map(([k]) => k).filter((k) => f.get('svc_' + k) === 'on'),
      extra: fv(f, 'extra'), feeMode: fv(f, 'feeMode'), fee: fv(f, 'fee'), empFree: fv(f, 'empFree'), feeEmp: fv(f, 'feeEmp'), feeYear: fv(f, 'feeYear'), feeHour: fv(f, 'feeHour'),
      docDay: fv(f, 'docDay'), payDay: fv(f, 'payDay'), note: fv(f, 'note'),
    } as never, today());
    if (!p.svc.length && !p.extra) return { error: 'Изберете барем една услуга.' };
    const { number: _n, date, validUntil, ...data } = p;
    await db().transaction(async (tx) => {
      if (isUuid(oid)) {
        const [o] = await tx.select().from(crmOffers).where(and(eq(crmOffers.id, oid), eq(crmOffers.leadId, leadId))).limit(1);
        if (!o) throw new Error('offer');
        await tx.update(crmOffers).set({ date, validUntil, data: data as Record<string, unknown> }).where(eq(crmOffers.id, oid));
      } else {
        const y = Number(date.slice(0, 4));
        const number = crmOfferNumber(await nextOfficeNumber(tx, 'crmPon', y), y);
        const [o] = await tx.insert(crmOffers).values({ leadId, number, date, validUntil, data: data as Record<string, unknown>, createdBy: u.id }).returning({ id: crmOffers.id });
        oid = o!.id;
        await tx.insert(crmNotes).values({ leadId, kind: 'note', text: `📄 Понуда ${number} – ${Number(p.fee) ? p.fee + ' ден. месечно' : 'без месечна цена'}`, createdBy: u.id });
        if (l.stage === 'nov' || l.stage === 'kontakt') {
          await tx.update(crmLeads).set({ stage: 'ponuda' }).where(eq(crmLeads.id, leadId));
          await tx.insert(crmNotes).values({ leadId, kind: 'stage', text: `${crmStageName(l.stage)} → ${crmStageName('ponuda')}`, createdBy: u.id });
        }
      }
      if (Number(p.fee) && !Number(l.fee)) await tx.update(crmLeads).set({ fee: Number(p.fee).toFixed(2) }).where(eq(crmLeads.id, leadId));
    });
  } catch (e) { return officeError(e); }
  done(leadId);
  redirect(`/crm?id=${leadId}&ponuda=${oid}`);
}

/** Offer status: sent / accepted / declined (accepted moves the lead to „Преговори“ when it is still before it). */
export async function setOfferStatus(id: string, status: string): Promise<RowResult> {
  let leadId = '';
  try {
    const u = await crmAction();
    if (!isUuid(id) || !['draft', 'sent', 'accepted', 'declined'].includes(status)) return { error: 'Неважечки статус.' };
    const [o] = await db().select().from(crmOffers).where(eq(crmOffers.id, id)).limit(1);
    if (!o) return { error: 'Понудата не постои.' };
    leadId = o.leadId;
    const L = { draft: 'нацрт', sent: 'испратена', accepted: 'прифатена', declined: 'одбиена' } as Record<string, string>;
    await db().transaction(async (tx) => {
      await tx.update(crmOffers).set({ status }).where(eq(crmOffers.id, id));
      await tx.insert(crmNotes).values({ leadId, kind: 'note', text: `📄 Понуда ${o.number}: ${L[status]}`, createdBy: u.id });
      const [l] = await tx.select({ stage: crmLeads.stage }).from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
      if (status === 'accepted' && l && ['nov', 'kontakt', 'ponuda'].includes(l.stage)) {
        await tx.update(crmLeads).set({ stage: 'pregovori' }).where(eq(crmLeads.id, leadId));
        await tx.insert(crmNotes).values({ leadId, kind: 'stage', text: `${crmStageName(l.stage)} → ${crmStageName('pregovori')}`, createdBy: u.id });
      }
    });
  } catch (e) { return officeError(e); }
  done(leadId);
  return { ok: 'Зачувано.' };
}

export async function deleteOffer(id: string): Promise<RowResult> {
  let leadId = '';
  try {
    await crmAction();
    if (!isUuid(id)) return { error: 'Неважечка понуда.' };
    const [o] = await db().delete(crmOffers).where(eq(crmOffers.id, id)).returning({ leadId: crmOffers.leadId });
    leadId = o?.leadId ?? '';
  } catch (e) { return officeError(e); }
  done(leadId);
  return { ok: 'Понудата е избришана.' };
}
