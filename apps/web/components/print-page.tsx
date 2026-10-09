'use client';
/**
 * HTML print view with the legacy print CSS: `#printArea` is a direct child of `<body>` (legacy.css hides every
 * other body child when printing). Used by pages in the `(print)` route group: the browser's print dialog, or the
 * server PDF (`PdfButton` → Phase 9 `pdf.render`).
 */
import { useEffect } from 'react';
import { PdfButton } from './pdf-button';

export function PrintPage({ children, title, auto, onPrinted, landscape }: {
  children: React.ReactNode; title: string; auto?: boolean; onPrinted?: () => Promise<unknown>; landscape?: boolean;
}) {
  useEffect(() => {
    document.title = title;
    if (auto) setTimeout(() => window.print(), 300);
  }, [auto, title]);
  return (
    <>
      <div className="noprint" style={{ padding: 10, display: 'flex', gap: 8, background: 'var(--soft)', borderBottom: '1px solid var(--line)' }}>
        <button className="btn pri" type="button" onClick={async () => { window.print(); if (onPrinted) await onPrinted(); }}>🖨 Печати / PDF</button>
        <PdfButton title={title} landscape={landscape} />
        <button className="btn" type="button" onClick={() => window.close()}>Затвори</button>
      </div>
      {landscape && <style>{'@page{size:A4 landscape}'}</style>}
      <div id="printArea" style={{ display: 'block', padding: 16, background: '#fff' }}>{children}</div>
    </>
  );
}
