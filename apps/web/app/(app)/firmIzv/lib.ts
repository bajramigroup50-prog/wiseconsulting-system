import 'server-only';
/**
 * „🗂 Целосен извештај за фирма“ — server helpers: the OWNER-only guards (page / print / Word route and every server
 * action), the query parameters, and loading the report of the CHOSEN firm. The firm is read by its id explicitly,
 * after the owner check, never from the selected-firm cookie (the owner sees every firm; the cookie, the firm guard and
 * its headers stay as they are).
 *
 * 🎭 A demo admin is the owner of the demo office (`lib/demo-office.ts`): it picks and reports on DEMO firms only (a real
 * firm id gives „Фирмата не постои.“), the contract / fees are the demo office's, and only demo users are named.
 */
import { asc, eq } from 'drizzle-orm';
import { firmReportHtml, type FirmReport, type FrAiView, type FrMode } from '@wise/core/office/firm-report';
import { computeFirmReport, firmReportAiState, firms, OfficeError } from '@wise/db';
import { getUser, requireUser, type SessionUser } from '@/lib/auth';
import { calendarYear } from '@/lib/context';
import { db } from '@/lib/db';
import { NAV_LBL } from '@/lib/nav';
import { isUuid, today } from '@/lib/office';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { isDemoUser } from '@/lib/demo';
import { firmOnSide, firmSideSql, isDemoOwner } from '@/lib/demo-office';

export const FI_TITLE = '🗂 Целосен извештај за фирма';

/** The signed-in user when they are the office owner (or 🎭 the demo office's owner), else `null` (page, print view, Word route). */
export async function fiOwnerUser(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && u.role === 'admin' && (isDemoOwner(u) || (await isOfficeOwner(u))) ? u : null;
}

/** Server-action guard: only the office owner (or 🎭 the demo office's owner, on demo firms only). */
export async function fiOwnerAction(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isDemoOwner(u) && !(await isOfficeOwner(u))) throw new OfficeError(OWNER_ONLY_MSG);
  return u;
}

export interface FiParams { f: string | null; y: number; to: string | null }

/** `?f=<firm id>&y=<year>&do=<YYYY-MM-DD>` — defaults: the current year, up to today. */
export function fiParams(sp: Record<string, string | string[] | undefined>): FiParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const f = one('f');
  const y = Number(one('y'));
  const d = one('do');
  return { f: isUuid(f) ? f : null, y: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : calendarYear(), to: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null };
}

export const fiQuery = (p: { f: string; y: number; to?: string | null }) => `f=${p.f}&y=${p.y}${p.to ? `&do=${p.to}` : ''}`;

/** Every firm of the owner's side (active first), for the searchable picker: 🎭 demo firms for a demo admin, real firms otherwise. */
export async function fiFirms(u: SessionUser) {
  const F = await db().select({ id: firms.id, name: firms.name, edb: firms.edb, city: firms.city, active: firms.active }).from(firms).where(firmSideSql(u)).orderBy(asc(firms.name));
  return F.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'mk'));
}

/** The report of the chosen firm (owner already checked by the caller) — a firm of the owner's side only. */
export async function fiReport(u: SessionUser, p: FiParams & { f: string }): Promise<FirmReport | null> {
  const [f] = await db().select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(eq(firms.id, p.f)).limit(1);
  if (!f || !firmOnSide(u, f)) return null;
  return computeFirmReport(db(), { firmId: p.f, year: p.y, to: p.to, today: today(), owner: true, userId: u.id, demo: isDemoUser(u) });
}

/** The stored AI analysis, as the report shows it (without the request payload). */
export async function fiAi(firmId: string, year: number): Promise<FrAiView | null> {
  const s = await firmReportAiState(db(), firmId, year).catch(() => null);
  if (!s) return null;
  return { status: s.status, text: s.text ?? null, error: s.error ?? null, model: s.model ?? null, at: s.at ?? null, unverified: s.unverified ?? [], costUsd: s.costUsd ?? null };
}

export const fiHtml = (R: FirmReport, mode: FrMode, ai: FrAiView | null, by: string) =>
  firmReportHtml(R, { mode, ai, by, label: (v) => NAV_LBL[v] });
