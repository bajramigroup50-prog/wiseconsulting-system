import { requireUser } from '@/lib/auth';

/**
 * Print views (HTML + the browser's print-to-PDF; server-side PDF comes in Phase 9). Legacy `docView` modal markup:
 * `.pdfwrap > .pdfdoc.printarea` with `PDF_CSS` (legacy-injected.css).
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <style>{'@page{size:A4;margin:10mm}@media print{body{background:#fff}.pdfwrap{padding:0!important}}'}</style>
      <div className="pdfwrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16 }}>{children}</div>
    </div>
  );
}
