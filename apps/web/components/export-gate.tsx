'use client';
/**
 * 🔒 Data exports only for the office owner: for everybody else the list exports (⬇ Excel / ⬇ PDF) are hidden, any
 * download of a data file (Excel, CSV, ZIP, JSON) is stopped (tax XML files – МПИН, ДДВ-04, е-фактура – stay allowed), and copying a table or a long text is blocked.
 * Printing and the PDF of a single document (an invoice for the client) stay allowed. The server routes that build
 * whole-data exports check the same rule (`lib/export-rule.ts`).
 */
import { createContext, useContext, useEffect } from 'react';

const Ctx = createContext(true);
export const useExportAllowed = () => useContext(Ctx);

const DATA = /\.(xlsx|xlsm|xls|csv|zip|json|sql|dump)$/i;
const MSG = 'Извозот и копирањето на податоци се дозволени само за сопственикот на канцеларијата.';

export function ExportGate({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (allowed) return;
    // downloads: every <a download> (the Excel / CSV / ZIP buttons all end in one) with a data file name
    const click = HTMLAnchorElement.prototype.click;
    const blocked = (a: HTMLAnchorElement) => a.hasAttribute('download') && (DATA.test(a.download || '') || DATA.test(a.pathname || ''));
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (blocked(this)) { window.alert(MSG); return; }
      return click.call(this);
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (a instanceof HTMLAnchorElement && (blocked(a) || /\/(zip|export|paket)(\?|$)/.test(a.pathname))) { e.preventDefault(); e.stopPropagation(); window.alert(MSG); }
    };
    // copying: a selection inside a table, or a long text
    const onCopy = (e: ClipboardEvent) => {
      const s = window.getSelection();
      const txt = s?.toString() ?? '';
      const inTable = !!s && s.rangeCount > 0 && !!(s.getRangeAt(0).commonAncestorContainer as Element).parentElement?.closest?.('table, thead, tbody, tr');
      if (txt.length > 200 || /\t/.test(txt) || (inTable && txt.length > 40)) { e.preventDefault(); window.alert(MSG); }
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('copy', onCopy, true);
    document.body.classList.add('noexp');
    return () => {
      HTMLAnchorElement.prototype.click = click;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('copy', onCopy, true);
      document.body.classList.remove('noexp');
    };
  }, [allowed]);
  return <Ctx.Provider value={allowed}>{children}</Ctx.Provider>;
}
