/**
 * Print views (HTML + legacy print CSS `.pdfdoc`; the browser's "Save as PDF" replaces legacy `pdf()`).
 * Server-side PDF rendering comes in Phase 9.
 */
import { PrintBar } from './print-bar';

const CSS = `
body{background:#e9e9e9}
.prt{display:flex;justify-content:center;padding:16px 0 32px}
.prt .pdfdoc{padding:10mm;box-shadow:0 1px 6px rgba(0,0,0,.15)}
@media print{body{background:#fff}.prt{padding:0;display:block}.prt .pdfdoc{padding:0;box-shadow:none;margin:0 auto}.noprint{display:none!important}}
`;

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <PrintBar />
      <div className="prt">{children}</div>
    </>
  );
}
