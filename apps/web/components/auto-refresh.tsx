'use client';
/** Re-render the server page every `seconds` while it is visible (legacy `pnLive` 30 s timer). */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ seconds }: { seconds: number }) {
  const r = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') r.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [r, seconds]);
  return null;
}
