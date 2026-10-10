'use client';
/**
 * „⬇ PDF“ + „⬇ Excel“ for any screen (shared building block; `Hd` renders it in every page header unless `exp={false}`):
 * PDF = the screen as shown, rendered on the server with the firm head and the screen title (legacy `pdf(name,
 * ph(title) + el.innerHTML)`, e.g. `anPdf`); Excel = every visible table as a sheet (legacy `anXlsx`). The Excel
 * button only appears while the screen has a table. Use it directly with `selector` for one part of a page.
 */
import { useEffect, useState } from 'react';
import { screenPdf, screenXlsx } from '@/lib/pdf-capture';

export function ScreenExport({ title, sub, selector = '#main', landscape, pdf = true, excel = true, className = 'btn' }: {
  title: string; sub?: string; selector?: string; landscape?: boolean; pdf?: boolean; excel?: boolean; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [tables, setTables] = useState(false);
  useEffect(() => {
    if (!excel) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const check = () => setTables(!!el.querySelector('table'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [excel, selector]);
  const name = [title, sub].filter(Boolean).join(' – ');
  return (
    <span className="noprint row" style={{ gap: 6, display: 'inline-flex' }}>
      {pdf && (
        <button type="button" className={className} disabled={busy} title="Екранот како PDF (A4, со заглавие на фирмата)"
          onClick={async () => { setBusy(true); try { await screenPdf({ selector, title, sub, landscape }); } finally { setBusy(false); } }}>
          {busy ? 'PDF се подготвува…' : '⬇ PDF'}
        </button>
      )}
      {excel && tables && (
        <button type="button" className={className} title="Табелите од екранот во Excel"
          onClick={() => { void screenXlsx({ selector, name }); }}>⬇ Excel</button>
      )}
    </span>
  );
}
