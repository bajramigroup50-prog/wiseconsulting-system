'use client';
/** „⬇ PDF“ — server-rendered PDF of the print area (next to the browser print button in every print bar). */
import { useState } from 'react';
import { serverPdf } from '@/lib/print-pdf';

export function PdfButton({ selector = '#printArea', title, landscape, className = 'btn' }: {
  selector?: string; title?: string; landscape?: boolean; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} title="PDF изработен на серверот (A4)"
      onClick={async () => {
        setBusy(true);
        try { await serverPdf({ selector, title: title || document.title, landscape }); } finally { setBusy(false); }
      }}>
      {busy ? 'PDF се подготвува…' : '⬇ PDF'}
    </button>
  );
}
