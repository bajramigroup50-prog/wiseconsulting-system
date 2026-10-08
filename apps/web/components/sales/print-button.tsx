'use client';
/** Toolbar of the print views (hidden when printing, legacy `.al-top`). */
export function PrintBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="al-top row" style={{ gap: 8, padding: '10px 0', justifyContent: 'center' }}>
      <button type="button" className="btn pri" onClick={() => window.print()}>🖨 Печати / зачувај PDF</button>
      {children}
      <button type="button" className="btn" onClick={() => window.close()}>Затвори</button>
    </div>
  );
}
