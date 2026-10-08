import 'server-only';
/**
 * Shared server helpers for the Phase 9 office screens.
 *
 * Every office mutation goes through `officeAction(perm)`: the firm always comes from the session cookie,
 * `requireCan(perm, firmId)` runs server-side. Approvals, settings and anything that is not the client's own
 * entry need `office` — the `klient` role only has `write` (FIX #1: legacy enforced this only in the UI).
 */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { klAllowedViews, todaySkopje, type KlConfig } from '@wise/core/office';
import { fileLinks, files, firms, OfficeError, type Firm, type Tx } from '@wise/db';
import { Forbidden, requireCan, requireUser, type SessionUser } from './auth';
import { currentFirm } from './context';
import { db } from './db';
import { viewAllowed } from './nav';
import type { ActionState } from './books';

export const today = () => todaySkopje();

export interface OfficeCtx { u: SessionUser; firm: Firm | null }

/** Page guard: signed in, view allowed for the role, and for clients only the sections the office enabled. */
export async function officePage(view: string, opts: { perm?: string } = {}): Promise<OfficeCtx> {
  const u = await requireUser();
  if (!viewAllowed(u.role, view)) notFound();
  const firm = await currentFirm(u);
  if (u.role === 'klient' && firm && !klAllowedViews((firm.settings as { kl?: KlConfig }).kl).includes(view)) notFound();
  if (opts.perm && !can(u.principal, opts.perm, firm?.id ?? null)) notFound();
  return { u, firm };
}

/** Server-action guard for firm-scoped office work. */
export async function officeAction(perm: string): Promise<{ u: SessionUser; firm: Firm }> {
  const u0 = await requireUser();
  const firm = await currentFirm(u0);
  if (!firm) throw new OfficeError('Изберете фирма.');
  const u = await requireCan(perm, firm.id);
  return { u, firm };
}

/** Server-action guard for office-wide work (no firm). */
export const officeGlobal = (perm = 'office') => requireCan(perm, null);

export function officeError(e: unknown): ActionState {
  if (e instanceof OfficeError || e instanceof Forbidden) return { error: e.message };
  const cause = (e as { cause?: { code?: string } })?.cause;
  if (cause?.code === '23505') return { error: 'Записот веќе постои.' };
  throw e;
}

/** `string` form field, trimmed, `null` when empty. */
export const fv = (f: FormData, k: string): string | null => { const v = String(f.get(k) ?? '').trim(); return v || null; };
export const fdate = (f: FormData, k: string): string | null => { const v = fv(f, k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
export const fnum = (f: FormData, k: string): number => { const v = Number(String(f.get(k) ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/**
 * Attach uploaded files (ids from the browser upload) to an office entity. Only ready files of the same
 * firm (or office-wide files for office entities) uploaded by this user or already in the firm are accepted.
 */
export async function linkFiles(tx: Tx, ids: unknown[], firmId: string | null, entityType: string, entityId: string, role = 'attachment'): Promise<number> {
  const want = [...new Set(ids.filter(isUuid))];
  if (!want.length) return 0;
  const ok = await tx.select({ id: files.id, firmId: files.firmId }).from(files).where(and(inArray(files.id, want), eq(files.status, 'ready')));
  const good = ok.filter((f) => f.firmId === firmId);
  if (good.length) await tx.insert(fileLinks).values(good.map((f) => ({ fileId: f.id, entityType, entityId, role }))).onConflictDoNothing();
  return good.length;
}

/** Linked files per entity id. */
export async function filesOf(entityType: string, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; mime: string; size: number }[]>();
  const rows = await db().select({ e: fileLinks.entityId, id: files.id, name: files.name, mime: files.mime, size: files.size })
    .from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, entityType), inArray(fileLinks.entityId, ids)));
  const M = new Map<string, { id: string; name: string; mime: string; size: number }[]>();
  for (const r of rows) M.set(r.e, [...(M.get(r.e) ?? []), { id: r.id, name: r.name, mime: r.mime, size: r.size }]);
  return M;
}

/** Firms the user may see, for office-wide lists. */
export async function allowedFirms(u: SessionUser) {
  const L = await db().select().from(firms).where(eq(firms.active, true));
  return L.filter((f) => firmAllowed(u.principal, f.id, f.ownerId)).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
}
