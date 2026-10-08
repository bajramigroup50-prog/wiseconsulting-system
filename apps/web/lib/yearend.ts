import 'server-only';
/**
 * Shared server helpers for the Phase 8 year-end screens (Завршна сметка): page guard, the loaded year, the phase
 * bar data. Every year-end sub-view (`zsKontrola`, `zs_db`, `mbyllja`, `zs_bs`, …) is reached from the menu item
 * `zsProc`, so it is guarded with that view id.
 */
import { notFound } from 'next/navigation';
import { yeViewFor } from '@wise/core';
import { effectiveChart, loadYear, yearFindings, type LoadedYear } from '@wise/db';
import { booksPage, type BooksCtx } from './books';
import { db } from './db';

export const ZS_MENU_VIEW = 'zsProc';

/** Today's date in Skopje (the bank year-end check only runs on/after 31.12). */
export const todayMk = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });

export interface YePageCtx extends BooksCtx {
  L: LoadedYear;
  findings: Awaited<ReturnType<typeof yearFindings>>;
}

/**
 * Guard + load. Returns null when no firm is selected. `view` is the legacy sub-view; it 404s when the firm's entity
 * type does not have that view (legacy `ENT_V`).
 */
export async function yePage(view: string, guardView = ZS_MENU_VIEW): Promise<(YePageCtx & { firm: NonNullable<BooksCtx['firm']> }) | null> {
  const ctx = await booksPage(guardView);
  if (!ctx.firm) return null;
  const L = await loadYear(db(), ctx.firm.id, ctx.year);
  if (!yeViewFor(view, L.ent)) notFound();
  const findings = await yearFindings(db(), L, todayMk());
  return { ...ctx, firm: ctx.firm, L, findings };
}

export async function accountNames(firmId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await effectiveChart(db(), firmId)).map((a) => [a.code, a.name]));
}

/** Phase-bar "done" ticks (legacy `zsPhDone`). */
export function phaseDone(L: LoadedYear): Record<string, boolean> {
  return {
    zs_db: !!L.statement && Object.keys(L.statement.dbAdj).length > 0,
    mbyllja: !!L.closeJournal,
    zsBel: !!L.statement && Object.keys(L.statement.notes).length > 0,
    zsXml: !!L.statement && (L.statement.status === 'submitted' || L.statement.status === 'accepted'),
    prenos: !!L.openJournal,
  };
}
