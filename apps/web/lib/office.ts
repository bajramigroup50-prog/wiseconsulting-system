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
import { can, firmAllowed, hasPerm, type Perm } from '@wise/core';
import { klAllowedViews, todaySkopje, tplVars, type KlConfig } from '@wise/core/office';
import { demoFirmSql, fileLinks, files, firmListedIn, firms, officeProfileForFirm, OfficeError, PostingError, realFirmSql, StockDocError, type Firm, type Tx } from '@wise/db';
import { isDemoUser } from './demo';
import { Forbidden, requireCan, requireUser, type SessionUser } from './auth';
import { currentFirm, currentYear } from './context';
import { db } from './db';
import { viewAllowed } from './nav';
import type { ActionState } from './books';
import { isDemoFirm } from '@wise/core/demo';

export const today = () => todaySkopje();

export interface OfficeCtx { u: SessionUser; firm: Firm | null }

/**
 * Page guard: signed in, view allowed for the role, and for clients only the sections the office enabled.
 * `demoGlobal`: an office-wide view whose data is scoped by side (`lib/demo-office.ts`) — a 🎭 demo user with the
 * role's permission opens it without a selected firm (its office-wide `can(…, null)` is otherwise refused).
 */
export async function officePage(view: string, opts: { perm?: string; demoGlobal?: boolean } = {}): Promise<OfficeCtx> {
  const u = await requireUser();
  if (!viewAllowed(u.role, view)) notFound();
  const firm = await currentFirm(u);
  if (u.role === 'klient' && firm && !klAllowedViews((firm.settings as { kl?: KlConfig }).kl, firm.mods).includes(view)) notFound();
  if (opts.perm && !can(u.principal, opts.perm, firm?.id ?? null)
    && !(opts.demoGlobal && !firm && isDemoUser(u) && hasPerm(u.principal, opts.perm as Perm))) notFound();
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

/**
 * Office-wide work whose rows are scoped by side (`lib/demo-office.ts`): a 🎭 demo user passes on the role's permission
 * (it then works on demo firms / demo users only — every caller re-checks the rows it touches); everybody else
 * `requireCan(perm, null)`.
 */
export async function officeGlobalSide(perm = 'office'): Promise<SessionUser> {
  const u = await requireUser();
  if (isDemoUser(u)) {
    if (!hasPerm(u.principal, perm as Perm)) throw new Forbidden(perm);
    return u;
  }
  return requireCan(perm, null);
}

export function officeError(e: unknown): ActionState {
  // PostingError covers the document services' DocumentError (approving a client entry books it); StockDocError the daily sales
  if (e instanceof OfficeError || e instanceof Forbidden || e instanceof PostingError || e instanceof StockDocError) return { error: e.message };
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

/**
 * Firms the user may see, for office-wide lists: only the firms working in the selected year (`wc_year`,
 * `@wise/core/firms/years`) unless `year: 'all'`. 🎭 By side: a demo user gets the demo firms only (also by
 * `principal.firms`), a real user never a demo firm (`realFirmSql`; the owner sees them only in the firm list's „ДЕМО“ group).
 */
export async function allowedFirms(u: SessionUser, o: { year?: number | 'all' } = {}) {
  const y = o.year ?? await currentYear();
  const L = await db().select().from(firms).where(and(y === 'all' ? eq(firms.active, true) : firmListedIn(y), isDemoUser(u) ? demoFirmSql : realFirmSql));
  // 🎭 a demo user: only its demo firms (`firmAllowed`); everybody else: never a demo firm in an office-wide list
  const demo = !!u.principal.demo;
  return L.filter((f) => firmAllowed(u.principal, f.id, f.ownerId) && (demo ? isDemoFirm(f) : !isDemoFirm(f))).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
}

/** Firm settings fields the office documents use (kept in `firms.settings` until a module owns them). */
export interface FirmOfficeSettings { short?: string; nkd?: string; manager?: string; signer?: string; bankAccount?: string; bankName?: string; regDate?: string }

/** Template variables for a firm (legacy `tplVars` common part) + extra document values. */
export async function firmTemplateVars(firm: Firm, extra: Record<string, string | number | null | undefined> = {}) {
  // 🎭 a demo firm's documents name the demo office, never the real one
  const O = await officeProfileForFirm(db(), firm);
  const s = firm.settings as FirmOfficeSettings;
  return tplVars(
    { name: firm.name, edb: firm.edb, embs: firm.embs, address: firm.address, city: firm.city, email: firm.email, activity: firm.activity, nkd: s.nkd, manager: s.manager ?? s.signer, bankAccount: s.bankAccount, bankName: s.bankName },
    { name: O.name, edb: O.edb, address: O.address, city: O.city, rep: O.rep },
    today(), extra,
  );
}
