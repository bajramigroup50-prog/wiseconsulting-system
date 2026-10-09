/**
 * Print views (HTML + legacy print CSS `.pdfdoc`): the browser's print dialog, or the server PDF (`PdfButton`,
 * Phase 9 `pdf.render`).
 *
 * The page area is `#printArea`: legacy.css hides every other `<body>` child when printing
 * (`body>*:not(#printArea)`), which used to blank these pages on paper. The inline `display` overrides the
 * screen rule `#printArea{display:none}`.
 */
import { PrintBar } from './print-bar';

const CSS = `
body{background:#e9e9e9}
.prt{display:flex;flex-direction:column;align-items:center;padding:16px 0 32px}
.prt .pdfdoc{padding:10mm;box-shadow:0 1px 6px rgba(0,0,0,.15)}
@media print{body{background:#fff}.prt{padding:0;display:block!important}.prt .pdfdoc{padding:0;box-shadow:none;margin:0 auto}.noprint{display:none!important}}
`;

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <PrintBar />
      <div className="prt" id="printArea" style={{ display: 'flex' }}>{children}</div>
    </>
  );
}
