'use client';
/**
 * Every report screen: a print / PDF link (`/print/…`) that carries a period (`from` / `to`, `od` / `do`) takes the
 * dates typed in the screen's filter form at the moment of the click — dates changed without „Прикажи“ still print
 * the chosen period (30.06.2026, not 31.12.2026). Only the period parameters the link already has are replaced, so a
 * document print or a link without a period is never changed.
 */
import { useEffect } from 'react';

const KEYS = ['from', 'to', 'od', 'do'];

/** The value typed in a date field of the page's filter forms (the first form that has it). */
function typed(name: string): string {
  for (const f of Array.from(document.forms)) {
    const el = f.elements.namedItem(name);
    if (el instanceof HTMLInputElement && el.value) return el.value;
  }
  return '';
}

export function PrintDates() {
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href*="/print/"]');
      if (!(a instanceof HTMLAnchorElement)) return;
      const u = new URL(a.href, window.location.origin);
      let changed = false;
      for (const k of KEYS) {
        if (!u.searchParams.has(k)) continue;
        const v = typed(k);
        if (v && v !== u.searchParams.get(k)) { u.searchParams.set(k, v); changed = true; }
      }
      if (!changed) return;
      e.preventDefault();
      window.open(u.pathname + u.search, '_blank', 'noopener');
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  return null;
}
