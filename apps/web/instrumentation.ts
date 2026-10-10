/**
 * Server errors (rendering, server actions, route handlers) → „Регистар на грешки“ (`app_errors`), like legacy
 * `errLog` for the browser. Loaded only in the Node.js runtime; a failure to record never affects the request.
 */
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const e = err as Error & { digest?: string };
    const { recordError, getDb } = await import('@wise/db');
    await recordError(getDb(), {
      msg: e?.message ?? String(err), stack: e?.stack ?? null, digest: e?.digest ?? null,
      src: `server:${context.routeType}`, view: request.path.split('?')[0] ?? null,
    });
  } catch { /* never fail the request because of the error log */ }
};
