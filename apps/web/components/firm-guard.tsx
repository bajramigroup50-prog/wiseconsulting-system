'use client';
/**
 * Browser half of the tab / window guard (`lib/firm-guard.ts`): the firm cookie and the year cookie are shared by every
 * tab and window, so a page remembers the firm + year it was rendered for and
 * - adds them (`x-wise-firm`, `x-wise-year`) to every same-origin mutation it sends — server actions (React / Next call
 *   `fetch`), uploads and API posts — so the server refuses a post from a page of another firm / year;
 * - shows a banner „Фирмата / Годината е променета во друг прозорец – освежете ја страницата.“ when another tab
 *   announces another firm / year (BroadcastChannel), when the window gets the focus and the session has another
 *   firm / year (`/api/firm-now`), or when the server flagged a post (`x-wise-firm-mismatch`);
 * - gives the upload / import zones the firm name („Се прикачува во: ФИРМА“, `UploadTarget`).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import {
  FIRM_CHANGED_MSG, FIRM_CHANNEL, FIRM_HEADER, FIRM_MISMATCH_HEADER, YEAR_CHANGED_MSG, YEAR_HEADER,
} from '@/lib/firm-guard';

type Stale = 'firm' | 'year';
interface Rendered { firm: string; year: string }

/** What this tab was rendered for (read by the `fetch` wrapper at send time). */
const R: Rendered = { firm: '', year: '' };
/** The props `FirmGuard` was last rendered with (null = never). */
const P: { firm: string | null; year: string | null } = { firm: null, year: null };
const listeners = new Set<(k: Stale) => void>();
const flag = (k: Stale) => { for (const l of listeners) l(k); };

declare global { interface Window { __wiseFirmFetch?: boolean } }

/** Same-origin, non-GET request → add the rendered firm / year headers; read the server's mismatch flag. */
function install() {
  if (typeof window === 'undefined' || window.__wiseFirmFetch) return;
  window.__wiseFirmFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const req = input instanceof Request ? input : null;
      const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      const url = new URL(req ? req.url : String(input), window.location.href);
      // never on other origins (the presigned PUT to the storage must stay as signed)
      if (method !== 'GET' && method !== 'HEAD' && url.origin === window.location.origin && (R.firm || R.year)) {
        const h = new Headers(init?.headers ?? req?.headers);
        if (R.firm && !h.has(FIRM_HEADER)) h.set(FIRM_HEADER, R.firm);
        if (R.year && !h.has(YEAR_HEADER)) h.set(YEAR_HEADER, R.year);
        init = { ...init, headers: h };
      }
    } catch { /* never break a request */ }
    return orig(input, init).then((res) => {
      const s = res.headers.get(FIRM_MISMATCH_HEADER);
      if (s === 'firm' || s === 'year') flag(s);
      return res;
    });
  };
}
install();

/**
 * This tab has just chosen a firm / year (`selectFirm` / `setYear` resolved): its next posts go with the new values
 * right away — not only once the re-rendered layout arrives (a soft navigation whose refresh is late or failed would
 * otherwise get every following action refused as „променета во друг прозорец“).
 */
export function noteRendered(c: { firm?: string; year?: number }): void {
  if (c.firm) R.firm = c.firm;
  if (c.year) R.year = String(c.year);
}
/** Headers the next mutation of this tab carries (tests). */
export const renderedNow = (): Readonly<Rendered> => ({ ...R });

export interface GuardFirm { id: string; name: string }
const Ctx = createContext<{ firm: GuardFirm | null; year: number } | null>(null);

/** The firm / year this page was rendered for (null outside the app layout). */
export const useRenderedFirm = () => useContext(Ctx);

export function FirmGuard({ firm, year, children }: { firm: GuardFirm | null; year: number; children: React.ReactNode }) {
  // set while rendering: the headers must be right before any effect or click of the children sends something —
  // only when the rendered props change, so a re-render with the old props cannot undo `noteRendered` of a choice
  const pf = firm?.id ?? '', py = String(year);
  if (P.firm !== pf) { P.firm = pf; R.firm = pf; }
  if (P.year !== py) { P.year = py; R.year = py; }
  const [stale, setStale] = useState<Stale | null>(null);

  useEffect(() => {
    // a new firm / year rendered here (chosen in this tab, or reloaded): nothing stale any more
    setStale(null);
    const check = (f: string, y: string) => {
      // a page without a firm (firm list, office-wide screens) posts nothing of a firm: only the year matters there
      if (R.firm && f !== R.firm) setStale('firm');
      else if (y && y !== R.year) setStale('year');
      else setStale(null);
    };
    const onFlag = (k: Stale) => setStale(k);
    listeners.add(onFlag);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(FIRM_CHANNEL);
      ch.onmessage = (e: MessageEvent<Rendered>) => { if (e.data && typeof e.data.firm === 'string') check(e.data.firm, e.data.year); };
      ch.postMessage({ firm: R.firm, year: R.year } satisfies Rendered);
    } catch { /* old browser: focus check and server flag only */ }
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/firm-now', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d: Rendered | null) => {
        if (d && typeof d.firm === 'string') check(d.firm, String(d.year ?? ''));
      }).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      listeners.delete(onFlag);
      ch?.close();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [firm?.id, year]);

  return (
    <Ctx.Provider value={{ firm, year }}>
      {stale && (
        <div role="alert" id="firmStale" style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#b42318', color: '#fff', padding: '10px 16px',
          display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', fontWeight: 700, fontSize: 15,
        }}>
          <span>⚠ {stale === 'firm' ? FIRM_CHANGED_MSG : YEAR_CHANGED_MSG}</span>
          <button type="button" className="btn sm" onClick={() => window.location.reload()}>⟳ Освежи</button>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

/** „Се прикачува во: ФИРМА · година“ — on every upload / import zone, so it is always visible where the files go. */
export function UploadTarget({ compact }: { compact?: boolean }) {
  const c = useRenderedFirm();
  if (!c?.firm) return null;
  return compact
    ? <small className="note upload-target">Се прикачува во: <b>{c.firm.name}</b> · {c.year}</small>
    : (
      <div className="callout upload-target" style={{ margin: '6px 0', borderColor: 'var(--accent)', fontSize: 15 }}>
        📂 Се прикачува во: <b>{c.firm.name}</b> · година <b>{c.year}</b>
      </div>
    );
}
