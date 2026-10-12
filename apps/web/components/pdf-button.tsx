'use client';
/**
 * „⬇ PDF“ — server-rendered PDF of the print area (next to the browser print button in every print bar). Never spins
 * forever: the server's refusal (firm / year changed in another window), an older page after a deploy, the network
 * and a 3-minute limit are shown next to the button.
 */
import { useState } from 'react';
import { serverPdf } from '@/lib/print-pdf';
import { pdfWithTimeout } from '@/lib/version';

export function PdfButton({ selector = '#printArea', title, landscape, className = 'btn' }: {
  selector?: string; title?: string; landscape?: boolean; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button type="button" className={className} disabled={busy} title="PDF изработен на серверот (A4)"
        onClick={async () => {
          setBusy(true); setErr('');
          try { setErr((await pdfWithTimeout(() => serverPdf({ selector, title: title || document.title, landscape, alert: false }))) ?? ''); } finally { setBusy(false); }
        }}>
        {busy ? 'PDF се подготвува…' : '⬇ PDF'}
      </button>
      {err && <span className="pill bad noprint" role="alert" style={{ marginLeft: 6 }}>{err}</span>}
    </>
  );
}
