'use server';
/**
 * „📷 Прочитај патни налози“ (Дневници во странство): the travel orders a transport client made itself are read by AI
 * (worker `ai.read-doc`) → „Креирај патување“ makes the trip with its countries and times → the per diems are computed
 * with the firm's amounts per country and the NBRM rate → „Прокнижи дневници“ (Д 44001 / П 2411).
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { frPerDiems } from '@wise/core/industry';
import { bookTourPerDiems, docReads, TravelReadError, freightTours, loadFxSources, tourFromTravelRead, TRAVEL_READ_JOB } from '@wise/db';
import { fxRate as fxRate2 } from '@wise/core';
import { freightRates } from '@/lib/freight';
import { indRun } from '@/lib/industry';
import { enqueue } from '@/lib/jobs';
import type { FormState } from '@/components/bank-form';

const P = ['/frDnev', '/frTuri'];

export async function readTravelOrdersAction(fileIds: string[]): Promise<FormState> {
  const ids = fileIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { error: 'Прикачете ги патните налози (PDF или слика).' };
  const made: string[] = [];
  const r = await indRun('frDnRead', P, async ({ tx, a }) => {
    // one read per file (a PDF of several pages = one order)
    for (const f of ids) made.push((await tx.insert(docReads).values({ firmId: a.firmId, kind: 'travel', fileIds: [f], createdBy: a.userId }).returning({ id: docReads.id }))[0]!.id);
    return `Се читаат ${ids.length} патни налози (10–60 секунди) – освежете ја страницата.`;
  });
  if (r.error) return r;
  for (const id of made) { try { await enqueue(TRAVEL_READ_JOB, { id }); } catch { /* stays queued */ } }
  return r;
}

export async function tourFromReadAction(readId: string): Promise<FormState> {
  return indRun('frDnRead', P, async ({ tx, a }) => {
    const id = await tourFromTravelRead(tx, a, readId);
    const [t] = await tx.select({ number: freightTours.number }).from(freightTours).where(eq(freightTours.id, id)).limit(1);
    return `Патувањето ${t?.number ?? ''} е креирано – проверете го возачот и државите, па „Прокнижи дневници“.`;
  });
}

export async function bookPerDiemsAction(tourId: string): Promise<FormState> {
  return indRun('frDnBook', P, async ({ tx, a, firm }) => {
    const [t] = await tx.select().from(freightTours).where(and(eq(freightTours.id, tourId), eq(freightTours.firmId, a.firmId))).limit(1);
    if (!t) throw new TravelReadError('Патувањето не постои.');
    const fxs = await loadFxSources(tx, a.firmId);
    const d = frPerDiems({ red: t.red, segs: t.segs, date: t.date }, (c, dd) => { try { return fxRate2(c, dd, fxs) || 0; } catch { return 0; } }, freightRates(firm));
    if (d.miss.length) throw new TravelReadError(`Нема курс за ${d.miss.join(', ')} – внесете го курсот на НБРМ.`);
    const detail = d.rows.map((r) => `${r.c} ${r.u}×${r.amt} ${r.cur}`).join(', ');
    const no = await bookTourPerDiems(tx, a, tourId, d.mkd, detail);
    revalidatePath('/nalozi');
    return `Дневниците (${d.mkd.toLocaleString('de-DE', { minimumFractionDigits: 2 })} ден.) се прокнижени – налог ${no}.`;
  });
}
