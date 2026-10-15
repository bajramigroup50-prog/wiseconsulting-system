'use server';
/**
 * The default rate of a foreign-currency document (invoice, import purchase): the firm's currency codebook → the office
 * list (NBRM / manual, the last list on or before the date) → the built-in default. Read-only, shared by the document
 * editors (a private folder: every view that edits documents may call it, also 🔒 book-only and 🎭 demo users).
 */
import { fxRate, fxRateSource } from '@wise/core';
import { loadFxSources } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { isDate } from '@/lib/bank';
import { db } from '@/lib/db';

export async function fxDefaultRate(cur: string, date: string): Promise<{ rate: number; src: string }> {
  const u = await requireUser();
  const c = String(cur ?? '').toUpperCase().slice(0, 3);
  if (!c || c === 'MKD' || !isDate(String(date ?? ''))) return { rate: 1, src: '' };
  const S = await loadFxSources(db(), (await currentFirm(u))?.id ?? null);
  return { rate: fxRate(c, date, S), src: fxRateSource(c, date, S) };
}
