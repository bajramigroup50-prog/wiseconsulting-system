import 'server-only';
/**
 * Office-wide status shown in the top bar and on the dashboard (legacy `alBell` 8607, `msgTop` 14015 / `ainbRender`
 * 13997, `lawBadge` 14321, `alFirmBadge` 8606). Scoped to the firms the user may open; cached per request.
 */
import { cache } from 'react';
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  autopilotFindings, autopilotMessages, autopilotRuns, bankAccounts, fileLinks, inboxItems, lawChanges, lawSeen, mpinAcks, OFFICE_FILE_ENTITY, recurringInvoices,
  yearClosings,
} from '@wise/db';
import { fgData, type FpFirm } from '@wise/core/firms/picker';
import type { SessionUser } from './auth';
import { db } from './db';
import { allowedFirms, today } from './office';
import { rokBadge } from './rokovi';

export interface AinbItem { id: string; fid: string; firm: string; at: string; from: string; note: string; nf: number }
export interface TopStatus {
  /** Notifications bell; `null` = no autopilot run yet (legacy hides the bell). */
  bell: { bad: number; warn: number; firstFirm: string | null } | null;
  /** Undone client messages (legacy `S.ainb`), newest first. */
  ainb: AinbItem[];
  /** New law changes for this user (legacy `lawNew().length`); `null` = not shown for the role. */
  law: number | null;
  /** 📅 open deadlines this week / overdue in the user's scope (`lib/rokovi.ts`); `null` = none for the role. */
  rok?: { week: number; late: number; mine: boolean } | null;
}

const officeRole = (u: SessionUser) => u.role !== 'klient' && u.role !== 'teren';

export const firmScope = cache(async (u: SessionUser) => allowedFirms(u));

export const topStatus = cache(async (u: SessionUser): Promise<TopStatus> => {
  if (!officeRole(u)) return { bell: null, ainb: [], law: null };
  const F = await firmScope(u);
  const ids = F.map((f) => f.id);
  const name = new Map(F.map((f) => [f.id, f.name]));
  // the deadlines badge needs only the firm ids: started now, awaited at the end
  const rokP = rokBadge(u, ids).catch(() => null);
  const [run, find, inbox, seen] = await Promise.all([
    db().select({ id: autopilotRuns.id }).from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1),
    ids.length ? db().select({ f: autopilotFindings.firmId, lvl: autopilotFindings.lvl }).from(autopilotFindings)
      .where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), ne(autopilotFindings.lvl, 'info'))) : Promise.resolve([]),
    ids.length ? db().select().from(inboxItems).where(and(inArray(inboxItems.firmId, ids), eq(inboxItems.done, false), eq(inboxItems.fromOffice, false)))
      .orderBy(desc(inboxItems.createdAt)).limit(200) : Promise.resolve([]),
    db().select({ at: lawSeen.seenAt }).from(lawSeen).where(eq(lawSeen.userId, u.id)).limit(1),
  ]);
  const [[lawN], NF] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(lawChanges).where(seen[0] ? gt(lawChanges.createdAt, seen[0].at) : undefined),
    inbox.length
      ? db().select({ id: fileLinks.entityId, n: sql<number>`count(*)::int` }).from(fileLinks)
        .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.inbox), inArray(fileLinks.entityId, inbox.map((i) => i.id)))).groupBy(fileLinks.entityId)
      : Promise.resolve([]),
  ]);
  const nf = new Map<string, number>(NF.map((r) => [r.id, r.n]));
  const bad = find.filter((x) => x.lvl === 'bad');
  return {
    bell: run[0] ? { bad: bad.length, warn: find.length - bad.length, firstFirm: (bad[0] ?? find[0])?.f ?? null } : null,
    ainb: inbox.map((i) => ({
      id: i.id, fid: i.firmId, firm: name.get(i.firmId) ?? '', at: i.createdAt.toISOString(), from: i.fromName ?? '',
      note: [i.subject, i.note].filter(Boolean).join('\n'), nf: nf.get(i.id) ?? 0,
    })),
    law: lawN?.n ?? 0,
    rok: await rokP,
  };
});

/** Per-firm open notifications (legacy `alFirmBadge`): `null` when the autopilot never ran. */
export const firmBadges = cache(async (u: SessionUser): Promise<Map<string, { n: number; bad: number; txt: string[] }> | null> => {
  const F = await firmScope(u);
  const ids = F.map((f) => f.id);
  const [run] = await db().select({ id: autopilotRuns.id }).from(autopilotRuns).limit(1);
  if (!run) return null;
  const L = ids.length ? await db().select({ f: autopilotFindings.firmId, lvl: autopilotFindings.lvl, txt: autopilotFindings.txt }).from(autopilotFindings)
    .where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), ne(autopilotFindings.lvl, 'info'))) : [];
  const M = new Map<string, { n: number; bad: number; txt: string[] }>();
  for (const x of L) {
    const r = M.get(x.f) ?? { n: 0, bad: 0, txt: [] };
    r.n++; if (x.lvl === 'bad') r.bad++; if (r.txt.length < 6) r.txt.push(x.txt);
    M.set(x.f, r);
  }
  return M;
});

/**
 * Rows for the firm picker (legacy `firmPicker` data: firm fields + `alFirmBadge` + `recNext` + `accFee` + МПИН index)
 * and the old-program grid columns of the selected `year` (`fgData`). Fixed number of queries whatever the number of
 * firms: the firms (`firmScope`), badges, recurring invoices, МПИН, bank accounts and the year closings — never per row.
 */
export async function pickerFirms(u: SessionUser, year?: number): Promise<{ rows: FpFirm[]; badges: boolean }> {
  const F = await firmScope(u);
  const ids = F.map((f) => f.id);
  const [B, rec, mp, ba, yc] = await Promise.all([
    firmBadges(u),
    ids.length ? db().select({ f: recurringInvoices.firmId, next: sql<string>`min(${recurringInvoices.next})` }).from(recurringInvoices)
      .where(and(inArray(recurringInvoices.firmId, ids), eq(recurringInvoices.active, true))).groupBy(recurringInvoices.firmId) : Promise.resolve([]),
    ids.length ? db().select({ f: mpinAcks.firmId, month: sql<string>`max(${mpinAcks.month})` }).from(mpinAcks).where(inArray(mpinAcks.firmId, ids)).groupBy(mpinAcks.firmId) : Promise.resolve([]),
    ids.length && year != null ? db().select({ f: bankAccounts.firmId, account: bankAccounts.account, name: bankAccounts.name }).from(bankAccounts)
      .where(and(inArray(bankAccounts.firmId, ids), eq(bankAccounts.active, true))).orderBy(bankAccounts.firmId, bankAccounts.sort) : Promise.resolve([]),
    ids.length && year != null ? db().select({ f: yearClosings.firmId, status: yearClosings.status, entity: yearClosings.entity }).from(yearClosings)
      .where(and(inArray(yearClosings.firmId, ids), eq(yearClosings.year, year))) : Promise.resolve([]),
  ]);
  const R = new Map(rec.map((r) => [r.f, r.next]));
  const MP = new Map(mp.map((r) => [r.f, r.month]));
  const BA = new Map<string, { account: string | null; name: string }[]>();
  for (const b of ba) BA.set(b.f, [...(BA.get(b.f) ?? []), b]);
  const YC = new Map(yc.map((r) => [r.f, r]));
  const s = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]) : null);
  return {
    badges: !!B,
    rows: F.map((f) => {
      const st = f.settings as Record<string, unknown>;
      const fee = Number(st.accFee);
      const g = year != null ? fgData(f, year, BA.get(f.id) ?? [], YC.get(f.id)) : null;
      return {
        id: f.id, name: f.name, code: g ? g.code || null : f.code, edb: f.edb, embs: f.embs, city: f.city, address: f.address, email: f.email, phone: f.phone,
        phone2: s(st, 'phone2'), contact: s(st, 'contact') ?? s(st, 'dc_name') ?? ([s(st, 'dc_first'), s(st, 'dc_last')].filter(Boolean).join(' ') || s(st, 'manager')),
        vat: f.vatRegistered, month: f.vatPeriod === 'month', example: st.example === true, ddvNo: s(st, 'ddvNo') ?? s(st, 'vatNo'),
        recNext: R.get(f.id) ?? null, fee: Number.isFinite(fee) ? fee : 0,
        al: B ? B.get(f.id) ?? { n: 0, bad: 0, txt: [] } : null,
        mp: MP.get(f.id) ? { month: MP.get(f.id)!, no: null } : null,
        ...(g ? { g: (({ code: _c, ...x }) => x)(g) } : {}),
      };
    }),
  };
}

/** Unsent autopilot client messages (legacy `apTile` „📨 N пораки“). */
export async function apUnsent(firmIds: string[]): Promise<number> {
  if (!firmIds.length) return 0;
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(autopilotMessages)
    .where(and(inArray(autopilotMessages.firmId, firmIds), eq(autopilotMessages.status, 'proposed')));
  return r?.n ?? 0;
}

/** Recurring invoices due today or earlier, per firm (legacy `recFirmsDue`). */
export async function recFirmsDue(firmIds: string[]) {
  if (!firmIds.length) return [];
  return db().select({ f: recurringInvoices.firmId, next: sql<string>`min(${recurringInvoices.next})`, n: sql<number>`count(*)::int` }).from(recurringInvoices)
    .where(and(inArray(recurringInvoices.firmId, firmIds), eq(recurringInvoices.active, true), lte(recurringInvoices.next, today()))).groupBy(recurringInvoices.firmId);
}
