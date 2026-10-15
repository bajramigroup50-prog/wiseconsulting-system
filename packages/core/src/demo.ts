/**
 * 🎭 Demo mode (pure rules, no DB). A potential buyer logs in as a DEMO user on the production server and must only
 * ever see demo firms / the demo office, never the real office or its clients.
 *
 * - A demo FIRM carries `settings.demo === true` AND its name starts with „ДЕМО“ — both, always (a misflagged real
 *   firm or a real firm whose name happens to start with „ДЕМО“ is never treated as demo, see `isDemoFirm`).
 * - A demo USER (`users.demo`) sees only demo firms, whatever its role / user_firms / all-firms flag.
 * - Outward side effects (mail, УЈП, fiscal printers, portal invites, NBRM, backups…) are refused for demo users with
 *   `DEMO_OFF_MSG`.
 */

export const DEMO_PREFIX = 'ДЕМО';
/** The demo office identity (the accounting office a buyer sees in the demo; never the real office). */
export const DEMO_OFFICE_NAME = 'ДЕМО СМЕТКОВОДСТВО ДООЕЛ';
export const DEMO_FIRM_NAMES = ['ДЕМО ТРГОВИЈА ДООЕЛ', 'ДЕМО ПРОИЗВОДСТВО ДООЕЛ', 'ДЕМО УСЛУГИ ДООЕЛ'] as const;
export const DEMO_OFF_MSG = 'Во демо режим оваа функција е исклучена';
export const DEMO_AI_OFF_MSG = 'Во демо режим AI е исклучено.';
export const DEMO_BANNER = '🎭 ДЕМО верзија – податоците се измислени и се бришат секоја ноќ';
/** `app_settings` key of the owner's demo settings (AI allowed under a monthly cap). */
export const DEMO_SETTINGS_KEY = 'demoSettings';
/** `app_settings` key of the demo office profile (the demo copy of the office profile). */
export const DEMO_OFFICE_KEY = 'demoOffice';
export const DEMO_AI_DEFAULT_LIMIT = 5;
/** `ai_usage.purpose` prefix of every AI call made for a demo firm. */
export const DEMO_AI_PURPOSE = 'demo';

/** `ai`: always off — a demo never spends the AI budget (owner's rule); `nightly`: the 03:30 reset of the demo. */
export interface DemoSettings { ai: boolean; aiLimitUsd: number; nightly: boolean }
export function demoSettingsClean(v: unknown): DemoSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<DemoSettings>;
  const lim = Number(o.aiLimitUsd);
  return { ai: false, aiLimitUsd: Number.isFinite(lim) && lim >= 0 && lim <= 100 ? lim : DEMO_AI_DEFAULT_LIMIT, nightly: o.nightly === true };
}

/** At most this many demo firms in total (the seeded ones and the demo office firm included). */
export const DEMO_MAX_FIRMS = 10;
export const DEMO_LIMIT_MSG = `Дозволени се најмногу ${DEMO_MAX_FIRMS} демо фирми – избришете некоја или ресетирајте го демото.`;
/** The stored name of a firm a demo user creates: „ДЕМО – <name>“ unless it already starts with „ДЕМО“. */
export function demoFirmName(name: string): string {
  const n = name.trim();
  return hasDemoPrefix(n) ? n : `${DEMO_PREFIX} – ${n}`;
}

/** Does the name start with „ДЕМО“ (exactly — the same test as the SQL `name like 'ДЕМО%'` in `@wise/db`)? */
export const hasDemoPrefix = (name: string | null | undefined): boolean => (name ?? '').startsWith(DEMO_PREFIX);

/** A demo firm: flag AND prefix. Anything else is a real firm. */
export const isDemoFirm = (f: { name: string | null | undefined; settings?: unknown } | null | undefined): boolean =>
  !!f && ((f.settings ?? {}) as { demo?: unknown }).demo === true && hasDemoPrefix(f.name);

/** Demo job policy: which background jobs a demo user may start (everything else — mail, УЈП, NBRM, imports… — is off). */
export const DEMO_AI_JOBS: readonly string[] = ['ai.read-document', 'ai.read-firm-resh', 'robot.ask', 'kontrola.ai', 'law.ask', 'law.case', 'firm-report.ai', 'client-report.summary', 'inbox.combine'];
export const DEMO_FREE_JOBS: readonly string[] = ['pdf.render'];
export function demoJobAllowed(name: string, _aiOn?: boolean): boolean {
  // no AI job for a demo user, whatever the settings say: the demo never spends the AI budget
  return DEMO_FREE_JOBS.includes(name);
}

/** Random demo password: 20 chars from an unambiguous alphabet (≈ 115 bits). `rnd(n)` returns n random bytes. */
export function demoPassword(rnd: (n: number) => Uint8Array): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = rnd(40);
  let s = '';
  for (let i = 0; i < b.length && s.length < 20; i++) if (b[i]! < 224) s += A[b[i]! % A.length];
  return s.length === 20 ? s : demoPassword(rnd);
}

/** Expiry choices of a demo link (days). */
export const DEMO_LINK_DAYS = [1, 3, 7, 30] as const;
export const DEMO_LINK_BAD_MSG = 'Линкот не важи – побарајте нов';
/** /demo/<token>: base64url of ≥ 32 random bytes. */
export const isDemoToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(t);

export type DemoLinkState = 'ok' | 'expired' | 'revoked';
export function demoLinkState(l: { expiresAt: Date; revokedAt: Date | null }, now = Date.now()): DemoLinkState {
  if (l.revokedAt) return 'revoked';
  return l.expiresAt.getTime() <= now ? 'expired' : 'ok';
}
