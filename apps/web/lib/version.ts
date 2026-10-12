/**
 * Pages left open across a deploy: their server-action ids no longer exist on the new build („Failed to find Server
 * Action … older or newer deployment“). Client-safe helpers: the new-version check (`components/version-check.tsx`
 * against `/api/version`) and the mapping of a failed action call to a clear message instead of an endless spinner.
 */

export const NEW_VERSION_MSG = 'Има нова верзија на програмата';
export const STALE_ACTION_MSG = 'Страницата е од постара верзија – освежете ја (Ctrl+Shift+R) и прикачете повторно.';
/** A read still „чека…“ / „се чита…“ after this long offers „↻ Повторно“. */
export const READ_STUCK_MS = 3 * 60_000;
/** How often an open page asks for the running build (plus on focus). */
export const VERSION_POLL_MS = 60_000;

/** True when the server runs another build than the one this page was rendered with. Unknown ids never count. */
export function versionChanged(rendered: string | null | undefined, current: string | null | undefined): boolean {
  const a = (rendered ?? '').trim(), b = (current ?? '').trim();
  if (!a || !b || a === 'dev' || b === 'dev') return false;
  return a !== b;
}

/** The build id from a `/api/version` response body (null when the answer is not usable). */
export function buildOf(body: unknown): string | null {
  const b = (body as { build?: unknown } | null)?.build;
  return typeof b === 'string' && b.trim() ? b.trim() : null;
}

/**
 * Whether an error thrown by a server-action call means the page is out of date (stale action id, the server
 * answered 404 / 500 / HTML instead of the action result) or the request never got through (network).
 */
export function isStaleActionError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /Server Action|older or newer deployment|unexpected response|was not found on the server|Failed to fetch|NetworkError|Load failed|fetch failed|network|\b(404|500|502|503|504)\b/i.test(m);
}

/** The message shown for a thrown action call: every thrown action call (actions answer `{error}` themselves). */
export function actionFailMsg(_e: unknown): string {
  return STALE_ACTION_MSG;
}

/** Call a server action; a throw (stale id, network, 404 / 500) becomes `{ error: STALE_ACTION_MSG }`. */
export async function safeAction<T extends object>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    const r = await fn();
    // an action that resolved to nothing (HTML / empty answer of a stale deployment) is not a result
    if (r == null || typeof r !== 'object') return { error: STALE_ACTION_MSG };
    return r;
  } catch (e) {
    return { error: actionFailMsg(e) };
  }
}

/** A pending read that has not changed status for `READ_STUCK_MS`. */
export function readStuck(status: string, since: number, now: number): boolean {
  return (status === 'queued' || status === 'reading') && now - since >= READ_STUCK_MS;
}

/** Longest a PDF / export button may stay „се подготвува…“. */
export const PDF_TIMEOUT_MS = 3 * 60_000;

/** Run an export with an overall time limit; resolves to the error message (null = done), never rejects. */
export function pdfWithTimeout(run: () => Promise<string | null | void>, ms = PDF_TIMEOUT_MS): Promise<string | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok('PDF не е подготвен навреме – обидете се повторно или користете „Печати“.'), ms);
    run().then((m) => { clearTimeout(t); ok(m ?? null); }, (e: unknown) => { clearTimeout(t); ok(isStaleActionError(e) ? STALE_ACTION_MSG.replace('прикачете', 'обидете се') : 'PDF не може да се подготви: ' + ((e as Error)?.message || String(e))); });
  });
}
