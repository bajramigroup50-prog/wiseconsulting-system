import 'server-only';
/**
 * Shared server helpers for the Phase 2 "core books" pages (partners, items, chart, nalozi, trial balance,
 * account cards, opening balance).
 */
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { partners, PostingError, type Firm } from '@wise/db';
import { requireCan, requireUser, Forbidden, type SessionUser } from './auth';
import { currentFirm, currentYear } from './context';
import { db } from './db';
import { viewAllowed } from './nav';

export interface BooksCtx { u: SessionUser; firm: Firm | null; year: number }

/** Page guard: signed in, allowed to open this legacy view; returns the current firm (may be null) and year. */
export async function booksPage(view: string): Promise<BooksCtx> {
  const u = await requireUser();
  if (!viewAllowed(u.role, view)) notFound();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  return { u, firm, year };
}

/**
 * Server-action guard: current firm required, then `requireCan(action, firmId)`.
 * The firm always comes from the session cookie (never from form input).
 */
export async function firmAction(action: string): Promise<{ u: SessionUser; firm: Firm; year: number }> {
  const u0 = await requireUser();
  const firm = await currentFirm(u0);
  if (!firm) throw new Error('Изберете фирма.');
  const u = await requireCan(action, firm.id);
  return { u, firm, year: await currentYear() };
}

export const canDo = (u: SessionUser, action: string, firmId: string) => can(u.principal, action, firmId);

export interface ActionState { error?: string; ok?: string }

/** Turn domain/permission errors into a form state; rethrow anything unexpected (Next redirects included). */
export function actionError(e: unknown): ActionState {
  if (e instanceof PostingError || e instanceof Forbidden) return { error: e.message };
  const m = e instanceof Error ? e.message : '';
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === '23505') return { error: 'Записот веќе постои (дупликат шифра / баркод).' };
  if (cause?.code === '23503') return { error: 'Записот се користи во книжења и не може да се избрише.' };
  if (cause?.code === '23514') return { error: 'Налогот не е изедначен (должи ≠ побарува).' };
  if (m === 'Изберете фирма.') return { error: m };
  throw e;
}

export const yearRange = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });

/** Partners of the firm for selects / datalists. */
export async function partnerOptions(firmId: string) {
  return db().select({ id: partners.id, code: partners.code, name: partners.name, edb: partners.edb, embs: partners.embs })
    .from(partners).where(eq(partners.firmId, firmId)).orderBy(asc(partners.name));
}

/** Clamp a `YYYY-MM-DD` query value into the business year (legacy: from/to only if they start with S.year). */
export const inYearOr = (v: string | undefined, y: number, fallback: string) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v.startsWith(String(y)) ? v : fallback;
