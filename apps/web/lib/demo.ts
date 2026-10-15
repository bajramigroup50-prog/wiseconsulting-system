import 'server-only';
/**
 * 🎭 Demo mode in the web app (rules: `@wise/core/demo`, SQL: `@wise/db` `demo/filters`).
 *
 * A demo user (`users.demo`, set only by the office owner in Корисници) works in a sandboxed demo office: it sees only
 * the demo firms (`principal.firms` = demo firm ids, `principal.demo`, `lib/auth.ts`), opens only the views of
 * `DEMO_VIEWS` (`lib/route-guard.ts`, enforced by `proxy.ts` for every request), and every outward side effect is
 * refused here (`refuseDemo`) with „Во демо режим оваа функција е исклучена“.
 *
 * Real users never get demo firms in the office's lists (`firmListSql`); the owner sees them in a separate „ДЕМО“ group.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DEMO_OFF_MSG, demoJobAllowed } from '@wise/core/demo';
import { audit, demoFirmSql, firms, getDemoSettings, realFirmSql, userFirms } from '@wise/db';
import { Forbidden, getUser, type SessionUser } from './auth';
import { db } from './db';

export { DEMO_OFF_MSG };

/** Refusal of a disabled function for a demo user (a `Forbidden`, so every action's error handler shows the text). */
export class DemoOff extends Forbidden {
  constructor() { super('demo'); this.name = 'DemoOff'; this.message = DEMO_OFF_MSG; }
}

export const isDemoUser = (u: Pick<SessionUser, 'principal'> & { demo?: boolean } | null | undefined): boolean =>
  !!u && (u.demo === true || u.principal.demo === true);

/**
 * Throws `DemoOff` for a demo user (mail, УЈП, fiscal printers, portal invites, NBRM, backup / restore, real users,
 * office settings…). Without an argument the signed-in user of the request is checked. The attempt is audited.
 */
export async function refuseDemo(u?: SessionUser | null, what = ''): Promise<void> {
  const user = u === undefined ? await getUser().catch(() => null) : u;
  if (!isDemoUser(user)) return;
  await audit(db(), { userId: user!.id, action: 'demoRefused', data: what ? { what } : undefined }).catch(() => {});
  throw new DemoOff();
}

/** The demo user of this request, if any (no throw). */
export async function demoUser(): Promise<SessionUser | null> {
  const u = await getUser().catch(() => null);
  return isDemoUser(u) ? u : null;
}

/** Background-job gate of `lib/jobs.ts`: a demo user may start only PDF renders, and the AI jobs when the owner allowed them. */
export async function demoJobGate(name: string): Promise<void> {
  const u = await demoUser();
  if (!u) return;
  const on = (await getDemoSettings(db()).catch(() => ({ ai: false }))).ai;
  if (!demoJobAllowed(name, on)) {
    await audit(db(), { userId: u.id, action: 'demoRefused', data: { job: name } }).catch(() => {});
    throw new DemoOff();
  }
}

/**
 * The firm condition for a firm LIST of this user:
 *  - demo user → only its demo firms;
 *  - everybody else → their firms (all / assigned / owned) and never a demo firm, unless `withDemo` (the owner's
 *    separate „ДЕМО“ group of the firm list).
 */
export function firmListSql(u: Pick<SessionUser, 'id' | 'principal'> & { demo?: boolean }, o: { withDemo?: boolean } = {}): SQL | undefined {
  if (isDemoUser(u)) {
    const ids = u.principal.firms.filter((x) => x !== '*');
    return ids.length ? and(inArray(firms.id, ids), demoFirmSql) : sql`false`;
  }
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  return o.withDemo ? scoped : and(scoped, realFirmSql);
}
