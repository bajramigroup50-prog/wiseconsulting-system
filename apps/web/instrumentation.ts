/**
 * Server instrumentation: errors in server components, route handlers and server actions are stored in the error
 * register (`/greski`, legacy `errLog`), with the path; the user is not known here (no request scope).
 */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routeType: string; routePath: string }): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const e = err as { message?: string; stack?: string; digest?: string };
    const { logAppError } = await import('./lib/errlog');
    await logAppError(null, null, {
      msg: (e?.message || String(err)) + (e?.digest ? ` (digest ${e.digest})` : ''),
      stack: e?.stack ?? null,
      view: `${request.method} ${request.path}`.slice(0, 200),
      src: `server:${context.routeType}`,
    });
  } catch { /* the register must never break a request */ }
}
