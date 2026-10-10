/**
 * Route allow-list for the restricted roles (used by `proxy.ts` for every request, page or API).
 *
 * - `klient` may open only the client portal: 🏠 Почетна, Испрати, профил / лозинка, the contract with the office and
 *   the sections the office switched on for the firm (`klAllowedViews`) — plus the print of an outgoing document when
 *   invoices are on, and the shared file / PDF / error endpoints (those check firm access themselves).
 * - `teren` may open only its tasks and travel orders.
 * Everything else redirects to the role's home (`/klHome`, `/mojzad`); API calls get 403.
 * Pure (no DB, no Next imports) so it is unit-tested.
 */

export type GuardRole = 'klient' | 'teren';
export const isGuardRole = (r: unknown): r is GuardRole => r === 'klient' || r === 'teren';

export const ROLE_HOME: Record<GuardRole, string> = { klient: '/klHome', teren: '/mojzad' };

/** Always reachable: auth pages, Next internals, static assets, PWA files, health. */
export function publicPath(p: string): boolean {
  return p.startsWith('/_next/') || p.startsWith('/login') || p.startsWith('/icons/') || p === '/favicon.ico'
    || p === '/manifest.webmanifest' || p.startsWith('/icon') || p.startsWith('/apple-icon') || p === '/api/health'
    // public/forms assets and root-level static files only (a dotted segment deeper down is not a free pass)
    || p.startsWith('/forms/') || /^\/[^/]+\.[a-z0-9]{2,5}$/i.test(p);
}

/** API endpoints every signed-in role may call (each checks the file's / current firm's access itself). */
const SHARED_API = ['/api/files', '/api/pdf', '/api/errors'];

const TEREN_VIEWS = ['mojzad', 'mojpn', 'lozinka', 'izlezF'];

/**
 * `null` = allowed; otherwise where to send the user (`'403'` for an API call).
 * `views` = the view ids the user may open (klient: `klAllowedViews` + `kdogovori`).
 */
export function routeVerdict(role: GuardRole, pathname: string, views: readonly string[]): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (publicPath(p)) return null;
  const allowed = new Set(role === 'teren' ? TEREN_VIEWS : [...views, 'lozinka']);
  if (p.startsWith('/api/')) return SHARED_API.some((a) => p === a || p.startsWith(a + '/')) ? null : '403';
  if (p === '/') return ROLE_HOME[role];
  const seg = p.split('/')[1]!;
  if (seg === 'print') {
    const sub = p.split('/')[2] ?? '';
    // outgoing-document print (invoice, credit note…) when the client sees issued invoices
    if (role === 'klient' && sub === 'doc' && (allowed.has('izlez') || allowed.has('vlez'))) return null;
    return allowed.has(sub) ? null : ROLE_HOME[role];
  }
  return allowed.has(seg) ? null : ROLE_HOME[role];
}
