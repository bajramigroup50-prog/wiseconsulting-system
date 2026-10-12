'use client';
/**
 * After a deploy, a page left open calls server actions that no longer exist. This checks the running build
 * (`/api/version`) on focus and every minute; when it differs from the build the page was rendered with, a sticky
 * banner offers one-click reload.
 */
import { useEffect, useState } from 'react';
import { buildOf, NEW_VERSION_MSG, VERSION_POLL_MS, versionChanged } from '@/lib/version';

export function VersionCheck({ build }: { build: string }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (stale || build === 'dev') return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (r.ok && versionChanged(build, buildOf(await r.json()))) setStale(true);
      } catch { /* offline / restarting: next round */ } finally { busy = false; }
    };
    const t = setInterval(check, VERSION_POLL_MS);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [build, stale]);
  if (!stale) return null;
  return (
    <div role="alert" style={{
      position: 'sticky', top: 0, zIndex: 1000, background: '#d1fadf', color: '#054f31', borderBottom: '2px solid #12b76a',
      padding: '6px 16px', fontWeight: 700, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span>{NEW_VERSION_MSG} –</span>
      <button type="button" className="btn sm pri" onClick={() => window.location.reload()}>🔄 Освежи</button>
    </div>
  );
}
