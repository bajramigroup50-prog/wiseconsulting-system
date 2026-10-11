/** Legacy `frPdf` → `frPdfHTML` (12070): ЛИСТА НА ФИРМИ (– ДДВ ОБВРЗНИЦИ), landscape, with totals and signatures. */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { FR_F, frCounts, frTitle } from '@wise/core/firms/firmform';
import { requireUser } from '@/lib/auth';
import { firmReport } from '@/lib/firm-list';
import { dmy } from '@/lib/fmt';
import { Sig } from '../firm-head';

export const metadata = { title: 'Листа на фирми' };

export default async function PrintFirmi({ searchParams }: { searchParams: Promise<{ f?: string; ex?: string }> }) {
  const u = await requireUser();
  if (!can(u.principal, 'firms')) notFound();
  const { k, list: L } = await firmReport(u, await searchParams);
  const t = FR_F.find((x) => x[0] === k)![1];
  const c = frCounts(L);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: '14pt', fontWeight: 700 }}>{frTitle(k)}</div>
        <div style={{ fontSize: '9pt' }}>{t} · состојба на {dmy(new Date().toISOString())} · вкупно {L.length}</div>
      </div>
      <table style={{ fontSize: '8.5pt' }}>
        <thead><tr><th>Р.бр</th><th>Назив</th><th>ЕДБ</th><th>ЕМБС</th><th>Седиште</th><th>ДДВ</th><th>Даночен период</th><th>ДДВ од</th><th>Заклучено до</th></tr></thead>
        <tbody>
          {L.map((f, i) => (
            <tr key={f.id}><td>{i + 1}</td><td>{f.name}</td><td>{f.edb ?? ''}</td><td>{f.embs ?? ''}</td><td>{[f.address, f.city].filter(Boolean).join(', ')}</td>
              <td>{f.vatRegistered ? 'Да' : 'Не'}</td><td>{f.vatRegistered ? (f.vatPeriod === 'month' ? 'месечен' : 'тромесечен') : '—'}</td>
              <td>{f.vatFrom ? dmy(f.vatFrom) : ''}</td><td>{f.lockDate ? dmy(f.lockDate) : '—'}</td></tr>
          ))}
          {!L.length && <tr><td colSpan={9}>Нема фирми.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: '8.5pt', marginTop: 6 }}>ДДВ обврзници: {c.ddv} (месечно {c.month}, тромесечно {c.quarter}) · не се обврзници: {c.no}</p>
      <Sig />
    </div>
  );
}
