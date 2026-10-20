/** The signed-in employee's IESBA declaration of the year, for signing on paper (the scan is attached to the declaration). */
import { notFound } from 'next/navigation';
import { ethicsText } from '@wise/core/office/ifac';
import { ifacGet } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';
import { loadProvider } from '../../(app)/kdogovori/lib';

export const metadata = { title: 'Изјава за етика' };

export default async function PrintIfacEt({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'ifac')) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : new Date().getFullYear();
  const [r, P] = await Promise.all([db().transaction((tx) => ifacGet(tx, 'ethics', year, u.id)), loadProvider(u)]);
  const T = ethicsText(P.O.name ?? '', u.name, year, { clients: (r?.data.clients as string[]) ?? [], conflicts: String(r?.data.conflicts ?? '') });
  return (
    <div className="pdfdoc" style={{ fontFamily: 'Times New Roman, serif', fontSize: '12pt', lineHeight: 1.55 }}>
      <div style={{ textAlign: 'center', fontSize: '9pt' }}>{P.O.name}</div>
      <h1 style={{ textAlign: 'center', fontSize: '15pt', margin: '4mm 0 1mm' }}>ИЗЈАВА</h1>
      <p style={{ textAlign: 'center', margin: '0 0 6mm' }}>за етика, независност и доверливост за {year} година (Кодекс на етика IESBA)</p>
      {T.map((t, i) => <p key={i} style={{ textAlign: 'justify', margin: '0 0 3mm' }}>{t}</p>)}
      <table style={{ width: '100%', marginTop: '14mm' }}><tbody><tr>
        <td>Датум: {r ? dmy(String(r.data.at ?? '')) : '_______________'}</td>
        <td style={{ textAlign: 'center' }}><div style={{ borderTop: '1px solid #111', width: '70mm', margin: '0 auto', paddingTop: 2 }}>{u.name}<br /><small>(потпис)</small></div></td>
      </tr></tbody></table>
    </div>
  );
}
