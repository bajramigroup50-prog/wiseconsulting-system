'use server';
/**
 * „📁 Досие на патување“ (🚛 Излез – транспорт): attach the CMR / travel order / other papers to a trip, link its
 * transport invoice, read its road-expense receipts (any country, AI), and book the whole trip in one nalog.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { frPerDiems } from '@wise/core/industry';
import { fxRate as fxRate2 } from '@wise/core';
import { bookTrip, docReads, fileLinks, freightTours, invoices, loadFxSources, TRAVEL_READ_JOB, TRIP_FILE_ENTITY, TripError } from '@wise/db';
import { freightRates } from '@/lib/freight';
import { indRun } from '@/lib/industry';
import { enqueue } from '@/lib/jobs';
import { todayIso } from '@/lib/fmt';
import type { FormState } from '@/components/bank-form';

const P = ['/izlezTr', '/frTuri', '/frDnev'];
const ids = (L: string[]) => L.filter((x) => /^[0-9a-f-]{36}$/i.test(x));

async function ownTour(tx: Parameters<Parameters<typeof indRun>[2]>[0]['tx'], firmId: string, tourId: string) {
  const [t] = await tx.select().from(freightTours).where(and(eq(freightTours.id, tourId), eq(freightTours.firmId, firmId))).limit(1);
  if (!t) throw new TripError('Патувањето не постои.');
  return t;
}

/** CMR / travel order / other paper of the trip (`role`), from the upload field. */
export async function attachTripFilesAction(tourId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const role0 = String(fd.get('role') ?? 'cmr');
  const role = role0 === 'travel' || role0 === 'doc' ? role0 : 'cmr';
  const F = ids(fd.getAll('fileIds').map(String));
  if (!F.length) return { error: 'Изберете датотеки.' };
  return indRun('frDnRead', P, async ({ tx, a }) => {
    await ownTour(tx, a.firmId, tourId);
    for (const f of F) await tx.insert(fileLinks).values({ fileId: f, entityType: TRIP_FILE_ENTITY, entityId: tourId, role }).onConflictDoNothing();
    return `Прикачено: ${F.length}.`;
  });
}

export async function detachTripFileAction(tourId: string, fileId: string, role: string): Promise<FormState> {
  return indRun('frDnRead', P, async ({ tx, a }) => {
    await ownTour(tx, a.firmId, tourId);
    await tx.delete(fileLinks).where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.entityType, TRIP_FILE_ENTITY), eq(fileLinks.entityId, tourId), eq(fileLinks.role, role)));
    return 'Отстрането.';
  });
}

/** Fuel / toll / parking … receipts of the trip, any country: one AI read per file. */
export async function readTripCostsAction(tourId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const F = ids(fd.getAll('fileIds').map(String));
  if (!F.length) return { error: 'Прикачете ги фискалните сметки (фото или PDF).' };
  const made: string[] = [];
  const r = await indRun('frDnRead', P, async ({ tx, a }) => {
    await ownTour(tx, a.firmId, tourId);
    for (const f of F) made.push((await tx.insert(docReads).values({ firmId: a.firmId, kind: 'tripcost', fileIds: [f], refId: tourId, createdBy: a.userId }).returning({ id: docReads.id }))[0]!.id);
    return `Се читаат ${F.length} датотеки со сметки (10–60 секунди) – освежете ја страницата.`;
  });
  if (r.error) return r;
  for (const id of made) { try { await enqueue(TRAVEL_READ_JOB, { id }); } catch { /* stays queued */ } }
  return r;
}

export async function deleteTripCostAction(readId: string): Promise<FormState> {
  return indRun('frDnRead', P, async ({ tx, a }) => {
    await tx.delete(docReads).where(and(eq(docReads.id, readId), eq(docReads.firmId, a.firmId), eq(docReads.kind, 'tripcost')));
    return 'Избришано – прокнижете го патувањето повторно ако веќе беше прокнижено.';
  });
}

export async function retryTripCostAction(readId: string): Promise<FormState> {
  const r = await indRun('frDnRead', P, async ({ tx, a }) => {
    await tx.update(docReads).set({ status: 'queued', error: null }).where(and(eq(docReads.id, readId), eq(docReads.firmId, a.firmId), eq(docReads.kind, 'tripcost')));
    return 'Се чита повторно…';
  });
  if (!r.error) { try { await enqueue(TRAVEL_READ_JOB, { id: readId }); } catch { /* stays queued */ } }
  return r;
}

/** The transport invoice of the trip ('' = none). */
export async function setTripInvoiceAction(tourId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const inv = String(fd.get('invoiceId') ?? '');
  return indRun('frDnRead', P, async ({ tx, a }) => {
    await ownTour(tx, a.firmId, tourId);
    if (inv) {
      const [i] = await tx.select({ id: invoices.id, partnerId: invoices.partnerId }).from(invoices).where(and(eq(invoices.id, inv), eq(invoices.firmId, a.firmId))).limit(1);
      if (!i) throw new TripError('Фактурата не постои.');
      await tx.update(freightTours).set({ invoiceId: i.id, partnerId: i.partnerId ?? undefined }).where(eq(freightTours.id, tourId));
      return 'Фактурата е поврзана со патувањето.';
    }
    await tx.update(freightTours).set({ invoiceId: null }).where(eq(freightTours.id, tourId));
    return 'Фактурата е одврзана.';
  });
}

/** „📒 Книжи го патувањето“: per diems + road expenses + the invoice in ONE nalog „ПАТ <број>“. */
export async function bookTripAction(tourId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const payK = String(fd.get('payK') ?? '2411');
  return indRun('frDnBook', [...P, '/nalozi', '/ddv'], async ({ tx, a, firm }) => {
    const t = await ownTour(tx, a.firmId, tourId);
    const fx = await loadFxSources(tx, a.firmId);
    const d = frPerDiems({ red: t.red, segs: t.segs, date: t.date }, (c, dd) => { try { return fxRate2(c, dd, fx) || 0; } catch { return 0; } }, freightRates(firm));
    if (d.miss.length) throw new TripError(`Нема курс за ${d.miss.join(', ')} – внесете го курсот на НБРМ.`);
    const r = await bookTrip(tx, a, tourId, { perDiem: { mkd: d.mkd, detail: d.rows.map((x) => `${x.c} ${x.u}×${x.amt} ${x.cur}`).join(', ') }, payK, fx, today: todayIso() });
    if (!r.perDiems && !r.costs) throw new TripError('Нема што да се книжи: внесете ги државите (патен налог) или прикачете ги сметките од патот.');
    const f = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Налог ${r.nalog}: дневници ${f(r.perDiems)} ден. · трошоци ${f(r.costs)} ден.${r.invoice ? ` · фактура ${r.invoice}` : ''}${r.skipped.length ? `. Не се книжени: ${r.skipped.slice(0, 5).join('; ')}.` : ''}`;
  });
}
