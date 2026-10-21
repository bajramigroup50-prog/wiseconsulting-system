'use client';
/**
 * Desktop app only (`window.wiseFiscal` = desktop/preload.js): every link to a file, a PDF or a print view opens in
 * its OWN window. Opened in the program's window, the PDF replaced the program and its ✕ closed the whole program.
 * Downloads (`?dl=1`, `download`) and links that already open elsewhere are left alone.
 */
import { useEffect } from 'react';

/** A file / PDF / print URL that should not replace the program's window. */
export function opensFile(href: string, base: string): boolean {
  let u: URL;
  try { u = new URL(href, base); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.searchParams.get('dl') === '1') return false;
  return /^\/api\/files\//.test(u.pathname) || /^files\./i.test(u.host) || /\.pdf$/i.test(u.pathname) || /^\/print\//.test(u.pathname);
}

export function DesktopPdfGuard() {
  useEffect(() => {
    if (!('wiseFiscal' in window)) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      if (!opensFile(a.getAttribute('href') ?? '', window.location.href)) return;
      e.preventDefault();
      window.open(a.href, '_blank');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
