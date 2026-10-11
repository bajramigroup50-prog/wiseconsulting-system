/**
 * Print-only firm header and signature lines for screen reports (legacy `pdf(name, ph(title, sub) + table + sig())`):
 * hidden on screen, shown when the report area is printed (`PrintButton`) or rendered by the server PDF
 * (`ServerPdfButton`, which renders with print media).
 */
import type { Firm } from '@wise/db';
import { FirmHead, Sig } from '@/app/print/firm-head';

const CSS = '.prt-only{display:none}@media print{.prt-only{display:block}}';

type FirmLike = Pick<Firm, 'name' | 'address' | 'city' | 'phone' | 'email' | 'edb' | 'embs'>;

export function PrintHead({ firm, title, sub }: { firm: FirmLike; title: string; sub?: string }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="prt-only pdfdoc" style={{ width: 'auto' }}><FirmHead firm={firm} title={title} sub={sub} /></div>
    </>
  );
}

export function PrintSig({ who }: { who?: string[] }) {
  return <div className="prt-only pdfdoc" style={{ width: 'auto' }}><Sig who={who} /></div>;
}

/** Page break between parts of a multi-part print (legacy `<div class="pb">`). */
export const PageBreak = () => <div style={{ breakAfter: 'page', pageBreakAfter: 'always' }} />;
