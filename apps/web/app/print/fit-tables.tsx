'use client';
/**
 * Every print view: a table wider than its page (many columns, long names, monospace amounts) is shrunk until it fits
 * the `.pdfdoc` width – smaller font and padding, down to 6 px – instead of running past the paper's right edge.
 * Runs after render and again when the content changes (tables filled later, a switched layout).
 */
import { useEffect } from 'react';

function fit(): void {
  for (const doc of Array.from(document.querySelectorAll<HTMLElement>('.pdfdoc'))) {
    const W = doc.clientWidth - parseFloat(getComputedStyle(doc).paddingLeft || '0') - parseFloat(getComputedStyle(doc).paddingRight || '0');
    if (!(W > 0)) continue;
    for (const t of Array.from(doc.querySelectorAll<HTMLTableElement>('table'))) {
      if (t.scrollWidth <= W + 1) continue;
      const cells = Array.from(t.querySelectorAll<HTMLElement>('th, td'));
      let fs = parseFloat(getComputedStyle(t).fontSize) || 10;
      for (let i = 0; i < 16 && t.scrollWidth > W + 1 && fs > 6; i++) {
        fs = Math.max(6, fs - 0.5);
        t.style.fontSize = fs + 'px';
        const pad = fs < 8 ? '1.5px 2px' : '2px 3px';
        for (const c of cells) { c.style.fontSize = fs + 'px'; c.style.padding = pad; }
      }
      /* still too wide: let the long text cells wrap (amounts stay on one line) */
      if (t.scrollWidth > W + 1) for (const c of cells) if (!c.classList.contains('n')) c.style.wordBreak = 'break-word';
    }
  }
}

export function FitTables() {
  useEffect(() => {
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    run();
    const area = document.getElementById('printArea');
    const mo = area ? new MutationObserver(run) : null;
    if (area && mo) mo.observe(area, { childList: true, subtree: true });
    window.addEventListener('beforeprint', fit);
    return () => { cancelAnimationFrame(raf); mo?.disconnect(); window.removeEventListener('beforeprint', fit); };
  }, []);
  return null;
}
