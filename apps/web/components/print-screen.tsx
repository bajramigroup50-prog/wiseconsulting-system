'use client';
/**
 * Browser printing of a screen (Ctrl+P and every „🖨 Печати“ that calls `window.print()` on an app page): just
 * before the print dialog renders, the sheet (`#main`, or its `.printarea` when the screen marks one) is cloned the
 * same way as for „⬇ PDF“ (`cleanClone`: no menus, buttons, filters, inputs as text) into a `#printArea` under
 * `<body>` with the firm in front; the legacy print CSS then prints only that. Removed after printing.
 * Print views that already have their own `body > #printArea` (`/print/*`) are left alone.
 */
import { useEffect } from 'react';
import { cleanClone, wideContent } from '@/lib/pdf-capture';

const MARK = 'data-print-screen';

export function PrintScreen() {
  useEffect(() => {
    const clear = () => document.querySelectorAll(`[${MARK}]`).forEach((x) => x.remove());
    const before = () => {
      clear();
      if (document.querySelector('body > #printArea')) return;
      const root = document.getElementById('main');
      if (!root) return;
      const el = (root.querySelector('.printarea') as HTMLElement | null) ?? root;
      const c = cleanClone(el, { dropHeader: false });
      const land = wideContent(el);
      const firm = (document.getElementById('firmName')?.textContent ?? '').trim();
      const area = document.createElement('div');
      area.id = 'printArea';
      area.setAttribute(MARK, '');
      const doc = document.createElement('div');
      doc.className = 'pdfdoc' + (land ? ' land' : '');
      if (firm && !c.querySelector('.fh, .ph')) {
        const h = document.createElement('div');
        h.style.cssText = 'font-weight:700;font-size:11pt;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #999';
        h.textContent = firm;
        doc.append(h);
      }
      doc.append(c);
      area.append(doc);
      const st = document.createElement('style');
      st.setAttribute(MARK, '');
      st.textContent = `@page{size:A4${land ? ' landscape' : ''};margin:10mm}`;
      document.head.append(st);
      document.body.append(area);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', clear);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', clear); clear(); };
  }, []);
  return null;
}
