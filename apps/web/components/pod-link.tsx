/**
 * Legacy `ACT.docView` patch 9486: in the invoice preview a button „🚚 Испорачано dd.mm hh:mm ✍“ opens the delivery
 * confirmation when the invoice was delivered on a travel order (`podFor`). Server component; renders nothing otherwise.
 */
import Link from 'next/link';
import { skDateTime } from '@wise/core/industry';
import { podOfInvoice } from '@wise/db';
import { db } from '@/lib/db';

export async function PodLink({ firmId, invoiceId }: { firmId: string; invoiceId: string }) {
  const P = await podOfInvoice(db(), firmId, invoiceId);
  if (!P) return null;
  const s = P.x.stops[P.i] as { at?: string | null; sig?: string | null } | undefined;
  const t = skDateTime(s?.at);
  return (
    <div className="noprint row" style={{ justifyContent: 'center', margin: '4px 0' }}>
      <Link className="btn" href={`/pnalozi/pod?id=${P.x.id}&i=${P.i}`} target="_blank" title={`Патен налог ${P.x.number}`}>🚚 Испорачано {t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)} ${t.slice(11)}` : ''}{s?.sig ? ' ✍' : ''}</Link>
    </div>
  );
}
