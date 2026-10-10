/**
 * Browser side of the error register (legacy `errLog` listeners 17463–17464): every error is sent once per session,
 * at most 40 per session; ResizeObserver / cross-origin "Script error" are ignored. Installed from
 * `instrumentation-client.ts`, so it runs on every screen without touching the layout.
 */
const SEEN = new Set<string>();
let N = 0;

export function reportError(msg: string, stack: string | undefined, src: string): void {
  try {
    msg = String(msg || 'Непозната грешка').slice(0, 400);
    if (/ResizeObserver loop|Script error\.?$/i.test(msg)) return;
    const key = msg + '|' + String(stack ?? '').split('\n')[1];
    if (SEEN.has(key) || ++N > 40) return;
    SEEN.add(key);
    void fetch('/api/errors', {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ msg, stack: String(stack ?? '').slice(0, 1200), view: location.pathname, src }),
    }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}

export function installErrorListeners(): void {
  window.addEventListener('error', (ev) => reportError(ev.message || ev.error?.message, ev.error?.stack || `${ev.filename ?? ''}:${ev.lineno ?? ''}`, 'error'));
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as { message?: string; code?: string; name?: string; stack?: string } | undefined;
    if (r && (r.code === 'cancelled' || r.name === 'AbortError')) return;
    reportError(r?.message || r?.code || String(r), r?.stack, 'promise');
  });
}
