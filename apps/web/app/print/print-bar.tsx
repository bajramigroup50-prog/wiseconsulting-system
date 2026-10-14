'use client';
/** Toolbar of the print views (hidden when printing): browser print, server PDF, send (share / e-mail / WhatsApp), close. */
import { PdfButton } from '@/components/pdf-button';
import { SharePdf } from '@/components/share-pdf';

export function PrintBar() {
  return (
    <div className="noprint row" style={{ gap: 8, justifyContent: 'center', padding: '10px 0 0' }}>
      <button className="btn pri" type="button" onClick={() => window.print()}>🖨 Печати / PDF</button>
      <PdfButton />
      <SharePdf />
      <button className="btn" type="button" onClick={() => window.close()}>Затвори</button>
    </div>
  );
}
