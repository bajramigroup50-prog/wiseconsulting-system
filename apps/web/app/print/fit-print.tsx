'use client';
/**
 * Every print view on a narrow screen (phone, portal, a small window): the A4 page is wider than the screen and, being
 * centred, its left part could not even be scrolled to. The page is zoomed down to the screen width instead, like a PDF
 * preview. Screen only: the rule sits in `@media screen`, so the browser's print and the server PDF (print media,
 * which copies the style sheets) stay A4 at full size.
 */
import { useEffect } from 'react';

export function FitPrint() {
  useEffect(() => {
    const st = document.createElement('style');
    st.dataset.fitPrint = '1';
    document.head.appendChild(st);
    const fit = () => {
      st.textContent = '';
      const docs = Array.from(document.querySelectorAll<HTMLElement>('.prt .pdfdoc')).filter((d) => !d.parentElement?.closest('.pdfdoc'));
      const w = Math.max(0, ...docs.map((d) => d.offsetWidth));
      const avail = document.documentElement.clientWidth - 8;
      const k = w > 0 ? Math.min(1, avail / w) : 1;
      if (k < 0.999) st.textContent = `@media screen{.prt{align-items:flex-start;padding-left:4px;padding-right:4px}.prt .pdfdoc{zoom:${k.toFixed(4)}}.prt .pdfdoc .pdfdoc{zoom:1}}`;
    };
    fit();
    const t = setTimeout(fit, 800);
    window.addEventListener('resize', fit);
    return () => { clearTimeout(t); window.removeEventListener('resize', fit); st.remove(); };
  }, []);
  return null;
}
