/**
 * „📅 Календар на рокови“ — services shared by the web app and the worker:
 * - `syncRokovi`: generate the deadlines of every firm (`@wise/core/office/rokovi` `rokGenerate`) from its settings and
 *   data (VAT payer / period, entity, employees, dossier documents with a validity date, the service contract, the
 *   manual firm deadlines), upsert them into `rokovi`, and mark them done automatically when the program sees the work
 *   done: ДДВ-04 → the VAT period is closed (`vat_periods.status = closed`); МПИН → an accepted МПИН is recorded
 *   (`mpin_acks`); year-end forms → the annual account is submitted / accepted (`annual_statements`); М1 → the
 *   employee's М1 date is entered. A reopened VAT period un-marks an automatic „done“.
 * - `dispatchRokReminders`: reminders for the responsible colleagues (users assigned to the firm) N days before, and
 *   the client reminders on the configured day — written to `reminders` and delivered by `dispatchReminders`
 *   (portal message / e-mail through `mail_log`).
 * - `markRok`: a colleague marks a deadline done / not done (audited).
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  rokClientDue, rokClientText, rokDays, rokGenerate, rokReminderText, rokRemindDue, type Rok, type RokFirm, type RokSettings,
} from '@wise/core/office/rokovi';
import { addDays, todaySkopje } from '@wise/core/office';
import { kdOfficeFirm } from '@wise/core/firms/kdog';
import { audit, type Tx } from './audit';
import { getOfficeProfile, OfficeError } from './office';
import { firmEntity } from './yearend';
import {
  annualStatements, dossierDocs, employees, firmDeadlines, firms, mpinAcks, reminders, rokovi, serviceContracts, userFirms, users, vatPeriods,
} from './schema/index';

export interface RokSyncResult { firms: number; rows: number; autoDone: number; autoUndone: number; gone: number }

const isExample = (s: unknown) => !!(s as { example?: boolean; archived?: boolean } | null)?.example || !!(s as { archived?: boolean } | null)?.archived;

/** Firm facts for `rokGenerate` (one query per table for all firms). */
export async function loadRokFirms(db: Tx, o: { from: string; to: string; firmIds?: readonly string[] }): Promise<RokFirm[]> {
  const F = (await db.select().from(firms).where(and(eq(firms.active, true), o.firmIds ? inArray(firms.id, [...o.firmIds, '00000000-0000-0000-0000-000000000000']) : undefined)))
    .filter((f) => !isExample(f.settings));
  if (!F.length) return [];
  const ids = F.map((f) => f.id);
  const [E, D, C, M] = await Promise.all([
    db.select({ firmId: employees.firmId, id: employees.id, name: employees.name, start: employees.start, end: employees.end, m1Date: employees.m1Date, active: employees.active })
      .from(employees).where(inArray(employees.firmId, ids)),
    db.select({ firmId: dossierDocs.firmId, id: dossierDocs.id, title: dossierDocs.title, category: dossierDocs.category, validTo: dossierDocs.validTo })
      .from(dossierDocs).where(and(inArray(dossierDocs.firmId, ids), gte(dossierDocs.validTo, o.from), lte(dossierDocs.validTo, o.to))),
    db.select({ firmId: serviceContracts.firmId, number: serviceContracts.number, end: serviceContracts.end, status: serviceContracts.status })
      .from(serviceContracts).where(and(inArray(serviceContracts.firmId, ids), gte(serviceContracts.end, o.from), lte(serviceContracts.end, o.to))),
    db.select().from(firmDeadlines).where(and(inArray(firmDeadlines.firmId, ids), gte(firmDeadlines.due, o.from), lte(firmDeadlines.due, o.to))),
  ]);
  const O = await getOfficeProfile(db);
  const off = kdOfficeFirm(F, O as never);
  return F.map((f) => {
    const s = (f.settings ?? {}) as { akont?: boolean };
    const k = C.filter((c) => c.firmId === f.id && c.status !== 'draft' && c.end).sort((a, b) => String(b.end).localeCompare(String(a.end)))[0];
    return {
      id: f.id, name: f.name, vatRegistered: f.vatRegistered, vatPeriod: f.vatPeriod, entity: firmEntity(f), akont: s.akont !== false,
      // inactive employees count only up to their end date (МПИН of the last month, М2)
      employees: E.filter((e) => e.firmId === f.id && (e.active || e.end)).map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end, m1Date: e.m1Date })),
      docs: D.filter((d) => d.firmId === f.id && d.validTo).map((d) => ({ id: d.id, title: d.title || d.category, validTo: d.validTo! })),
      // the office firm has no contract with itself; the contract rows are shown only on the owner's calendar
      contract: k && f.id !== off?.id ? { no: k.number, end: k.end! } : null,
      manual: M.filter((m) => m.firmId === f.id).map((m) => ({ id: m.id, title: m.title, due: m.due, done: m.done, note: m.note })),
    };
  });
}

/** Keys of deadlines the program sees done: `firmId|key`. */
async function doneFacts(db: Tx, R: readonly Rok[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(R.map((r) => r.firmId))];
  if (!ids.length) return out;
  const want = (t: string) => R.filter((r) => r.type === t);
  const [V, A, S] = await Promise.all([
    want('ddv').length ? db.select({ f: vatPeriods.firmId, p: vatPeriods.period }).from(vatPeriods)
      .where(and(inArray(vatPeriods.firmId, ids), eq(vatPeriods.status, 'closed'), inArray(vatPeriods.period, [...new Set(want('ddv').map((r) => r.period))]))) : [],
    want('mpin').length ? db.select({ f: mpinAcks.firmId, m: mpinAcks.month }).from(mpinAcks)
      .where(and(inArray(mpinAcks.firmId, ids), inArray(mpinAcks.month, [...new Set(want('mpin').map((r) => r.period))]))) : [],
    R.some((r) => r.type.startsWith('ye_') || r.type === 'dzs') ? db.select({ f: annualStatements.firmId, y: annualStatements.year }).from(annualStatements)
      .where(and(inArray(annualStatements.firmId, ids), inArray(annualStatements.status, ['submitted', 'accepted']))) : [],
  ]);
  for (const v of V) out.add(`${v.f}|ddv:${v.p}`);
  for (const a of A) out.add(`${a.f}|mpin:${a.m}`);
  for (const s of S) for (const t of ['ye_db', 'ye_crm', 'ye_tp', 'ye_npo', 'dzs']) out.add(`${s.f}|${t}:${s.y}`);
  for (const r of R) if (r.type === 'm1' && r.done) out.add(`${r.firmId}|${r.key}`);
  return out;
}

/**
 * Generate and store the deadlines due in `[from, to]` for all (or the given) firms; mark done / un-mark the automatic
 * ones; rows no longer generated in the window are flagged `gone` (hidden, kept for the history).
 */
export async function syncRokovi(db: Tx, o: { from: string; to: string; firmIds?: readonly string[]; now?: Date } = { from: '', to: '' }): Promise<RokSyncResult> {
  const now = o.now ?? new Date();
  const F = await loadRokFirms(db, o);
  const R = F.flatMap((f) => rokGenerate(f, o.from, o.to));
  for (let i = 0; i < R.length; i += 400) {
    const chunk = R.slice(i, i + 400);
    await db.insert(rokovi).values(chunk.map((r) => ({
      firmId: r.firmId, key: r.key, type: r.type, title: r.title, period: r.period, due: r.due, legalDue: r.legal, link: r.link, verified: r.verified,
      note: r.note ?? null, done: !!r.done, ...(r.done ? { doneAt: now } : {}), gone: false,
    }))).onConflictDoUpdate({
      target: [rokovi.firmId, rokovi.key],
      set: {
        type: sql`excluded.type`, title: sql`excluded.title`, period: sql`excluded.period`, due: sql`excluded.due`, legalDue: sql`excluded.legal_due`,
        link: sql`excluded.link`, verified: sql`excluded.verified`, note: sql`excluded.note`, gone: sql`false`, updatedAt: now,
        // a manual firm deadline keeps its done flag in `firm_deadlines` (the dossier); everything else keeps the stored status
        done: sql`case when ${rokovi.type} = 'firm' then excluded.done else ${rokovi.done} end`,
      },
    });
  }
  const facts = await doneFacts(db, R);
  let autoDone = 0, autoUndone = 0, gone = 0;
  const ids = F.map((f) => f.id);
  if (ids.length) {
    const stored = await db.select({ id: rokovi.id, firmId: rokovi.firmId, key: rokovi.key, type: rokovi.type, done: rokovi.done, auto: rokovi.auto }).from(rokovi)
      .where(and(inArray(rokovi.firmId, ids), gte(rokovi.due, o.from), lte(rokovi.due, o.to)));
    const gen = new Set(R.map((r) => `${r.firmId}|${r.key}`));
    const toDone = stored.filter((s) => !s.done && facts.has(`${s.firmId}|${s.key}`)).map((s) => s.id);
    const toUndo = stored.filter((s) => s.done && s.auto && gen.has(`${s.firmId}|${s.key}`) && !facts.has(`${s.firmId}|${s.key}`)).map((s) => s.id);
    const toGone = stored.filter((s) => !gen.has(`${s.firmId}|${s.key}`)).map((s) => s.id);
    if (toDone.length) autoDone = (await db.update(rokovi).set({ done: true, auto: true, doneAt: now, doneBy: null }).where(inArray(rokovi.id, toDone)).returning({ id: rokovi.id })).length;
    if (toUndo.length) autoUndone = (await db.update(rokovi).set({ done: false, auto: false, doneAt: null }).where(inArray(rokovi.id, toUndo)).returning({ id: rokovi.id })).length;
    if (toGone.length) gone = (await db.update(rokovi).set({ gone: true }).where(and(inArray(rokovi.id, toGone), eq(rokovi.gone, false))).returning({ id: rokovi.id })).length;
  }
  return { firms: F.length, rows: R.length, autoDone, autoUndone, gone };
}

/** The window the worker keeps fresh: 40 days back, 100 days ahead (+ the whole year-end season). */
export const rokWindow = (today: string): { from: string; to: string } => ({ from: addDays(today, -40), to: addDays(today, 100) });

/** A colleague marks a deadline done / open (manual firm deadlines also in the dossier). */
export async function markRok(tx: Tx, a: { id: string; done: boolean; userId: string; firmAllowed: (firmId: string) => boolean }): Promise<void> {
  const [r] = await tx.select().from(rokovi).where(eq(rokovi.id, a.id)).for('update').limit(1);
  if (!r || !a.firmAllowed(r.firmId)) throw new OfficeError('Рокот не постои.');
  await tx.update(rokovi).set({ done: a.done, auto: false, doneAt: a.done ? new Date() : null, doneBy: a.done ? a.userId : null }).where(eq(rokovi.id, r.id));
  if (r.type === 'firm') await tx.update(firmDeadlines).set({ done: a.done }).where(and(eq(firmDeadlines.id, r.key.slice(5)), eq(firmDeadlines.firmId, r.firmId)));
  await audit(tx, { userId: a.userId, firmId: r.firmId, action: a.done ? 'rokDone' : 'rokOpen', entityType: 'rok', entityId: r.id, data: { key: r.key, title: r.title, due: r.due } });
}

export interface RokDispatchResult { colleague: number; client: number }

/**
 * Write the reminders due today to `reminders` (deduped by key; `dispatchReminders` delivers them):
 * - e-mail to each responsible colleague (users assigned to the firm with an e-mail) `days` before an open deadline,
 *   when `mail` (SMTP configured) and the office setting `rok.mail` are on;
 * - the client reminder for the previous month (portal message and / or e-mail to the firm) on the configured day.
 * The in-app reminder is the 📅 counter of the top bar (deadlines within `days`), read from `rokovi`.
 */
export async function dispatchRokReminders(db: Tx, o: { today?: string; mail: boolean; now?: Date }): Promise<RokDispatchResult> {
  const now = o.now ?? new Date();
  const today = o.today ?? todaySkopje(now);
  const P = await getOfficeProfile(db);
  const S = ((P as { rok?: RokSettings }).rok ?? {}) as RokSettings;
  const days = rokDays(S);
  let colleague = 0, client = 0;
  if (o.mail && S.mail !== false) {
    const R = (await db.select().from(rokovi).where(and(eq(rokovi.done, false), eq(rokovi.gone, false), gte(rokovi.due, addDays(today, -30)), lte(rokovi.due, addDays(today, days)))))
      .filter((r) => rokRemindDue(today, r, days));
    const ids = [...new Set(R.map((r) => r.firmId))];
    const U = ids.length ? await db.select({ firmId: userFirms.firmId, userId: users.id, email: users.email, role: users.role, active: users.active }).from(userFirms)
      .innerJoin(users, eq(users.id, userFirms.userId)).where(inArray(userFirms.firmId, ids)) : [];
    const N = ids.length ? new Map((await db.select({ id: firms.id, name: firms.name }).from(firms).where(inArray(firms.id, ids))).map((f) => [f.id, f.name])) : new Map<string, string>();
    for (const r of R) {
      for (const u of U.filter((x) => x.firmId === r.firmId && x.email && x.active !== false && x.role !== 'klient' && x.role !== 'teren')) {
        const t = rokReminderText(r, N.get(r.firmId) ?? '');
        const ins = await db.insert(reminders).values({ firmId: r.firmId, userId: u.userId, title: t.subject, body: t.body, dueAt: now, channel: 'mail', key: `rok:${r.id}:${r.due}:${u.userId}` })
          .onConflictDoNothing().returning({ id: reminders.id });
        colleague += ins.length;
      }
    }
  }
  const ym = rokClientDue(today, S);
  if (ym) {
    const F = (await db.select().from(firms).where(eq(firms.active, true))).filter((f) => !isExample(f.settings) && (f.settings as { rokClient?: boolean }).rokClient !== false);
    const off = kdOfficeFirm(F, P as never);
    for (const f of F) {
      if (f.id === off?.id) continue;
      const t = rokClientText(ym, { firm: f.name, office: P.name ?? off?.name ?? null });
      const ch: ('portal' | 'mail')[] = [...(S.client?.portal !== false ? ['portal' as const] : []), ...(S.client?.mail !== false && o.mail && f.email ? ['mail' as const] : [])];
      for (const c of ch) {
        const ins = await db.insert(reminders).values({ firmId: f.id, title: t.subject, body: t.body, dueAt: now, channel: c, key: `rokcl:${f.id}:${ym}:${c}` })
          .onConflictDoNothing().returning({ id: reminders.id });
        client += ins.length;
      }
    }
  }
  return { colleague, client };
}
