/**
 * Print views (HTML + the browser's print-to-PDF or the server PDF button, legacy `pdf()` output). The toolbar is a separate body child, so
 * the legacy print rule `body>*:not(#printArea){display:none}` hides it on paper.
 */
import { PdfButton } from '@/components/pdf-button';
import { PrintButton } from '@/components/yearend/go-button';

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="row" style={{ padding: '10px 16px', gap: 8, borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <PrintButton />
        <PdfButton />
        <span className="note">„⬇ PDF“ ја изработува PDF датотеката на серверот; или во дијалогот за печатење изберете „Зачувај како PDF“. Формат A4.</span>
      </div>
      <div id="printArea" style={{ display: 'block', background: '#fff', color: '#000' }}>
        <div className="card" style={{ background: '#fff', color: '#000', maxWidth: '210mm', margin: '10px auto', padding: '10mm', boxShadow: 'none' }}>
          <div className="pdfdoc">{children}</div>
        </div>
      </div>
    </>
  );
}
