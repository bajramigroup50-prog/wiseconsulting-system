'use client';
/** Toolbar of the print views (hidden when printing): browser print, server PDF, close. */
import { PdfButton } from '@/components/pdf-button';

export function PrintBar() {
  return (
    <div className="noprint row" style={{ gap: 8, justifyContent: 'center', padding: '10px 0 0' }}>
      <button className="btn pri" type="button" onClick={() => window.print()}>🖨 Печати / PDF</button>
      <PdfButton />
      <button className="btn" type="button" onClick={() => window.close()}>Затвори</button>
    </div>
  );
}
