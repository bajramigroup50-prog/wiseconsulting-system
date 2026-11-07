'use client';
/** „📷 Прочитај патни налози“: upload the client's travel orders, the reads with their status, create the trip, book. */
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadField } from '@/components/upload-field';
import { RowAction } from '@/components/row-action';
import { bookPerDiemsAction, readTravelOrdersAction, tourFromReadAction } from './actions';

export interface ReadRow {
  id: string; status: string; error: string | null; at: string; refId: string | null; tourNo: string | null; booked: boolean;
  r: { number?: string; driver?: string; plate?: string; route?: string; departure?: string; ret?: string; segs?: { c: string; in: string; out: string }[]; unknown?: string[] } | null;
}

const dm = (s?: string) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + (s.length > 10 ? ' ' + s.slice(11, 16) : '') : '');

export function TravelReadBox({ firmId, rows, names }: { firmId: string; rows: ReadRow[]; names: Record<string, string> }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (fd: FormData) => start(async () => {
    const r = await readTravelOrdersAction(fd.getAll('fileIds').map(String));
    setMsg(r.error ? { error: r.error } : { ok: r.ok ?? 'Се чита…' });
    router.refresh();
  });
  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>📷 Прочитај патни налози од клиентот</h2>
      <p className="note" style={{ marginTop: 0 }}>Прикачете ги патните налози што ги направил клиентот (PDF или слика, со граничните премини). Програмот ги чита возачот, возилото и <b>секоја држава со влез и излез</b>, ги пресметува дневниците според износите по држава и ги книжи (Д 44001 / П 2411).</p>
      <form action={go}>
        <UploadField firmId={firmId} capture accept="image/*,application/pdf" label="📎 Избери патни налози (може повеќе)" />
        <button className="btn pri" disabled={pending} style={{ marginTop: 6 }}>{pending ? 'Се праќа…' : '🤖 Прочитај'}</button>
      </form>
      {msg && <div className={`callout ${msg.error ? 'warn' : 'good'}`} style={{ marginTop: 8 }}>{msg.error ?? msg.ok}</div>}
      {rows.length > 0 && (
        <div className="tw" style={{ marginTop: 10 }}><table className="dense">
          <thead><tr><th>Прикачено</th><th>Налог</th><th>Возач / возило</th><th>Држави (влез – излез)</th><th>Статус</th><th /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id}>
              <td className="mini">{x.at}</td>
              <td>{x.r?.number ?? ''}<div className="mini">{x.r?.route ?? ''}</div></td>
              <td>{x.r?.driver ?? ''}<div className="mini">{x.r?.plate ?? ''}</div></td>
              <td className="mini">{(x.r?.segs ?? []).map((g, i) => <div key={i}><b>{names[g.c] ?? g.c}</b> {dm(g.in)} – {dm(g.out)}</div>)}{x.r?.unknown?.length ? <div style={{ color: 'var(--bad)' }}>непознато: {x.r.unknown.join(', ')}</div> : null}</td>
              <td className="mini">{x.status === 'queued' || x.status === 'reading' ? '⏳ се чита…' : x.status === 'error' ? <span style={{ color: 'var(--bad)' }}>✕ {x.error}</span> : x.status === 'used' ? <>✓ патување <Link href={`/frTuri?id=${x.refId}&dn=1`}>{x.tourNo}</Link>{x.booked ? ' · прокнижено' : ''}</> : '✓ прочитано'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {x.status === 'done' && <RowAction action={tourFromReadAction.bind(null, x.id)} label="➕ Креирај патување" className="btn sm pri" showOk />}
                {x.status === 'used' && x.refId && <><Link className="btn sm" href={`/frTuri?id=${x.refId}&dn=1`}>✎ Провери</Link>{' '}
                  <RowAction action={bookPerDiemsAction.bind(null, x.refId)} label={x.booked ? '↻ Прокнижи повторно' : '📒 Прокнижи дневници'} className={'btn sm' + (x.booked ? '' : ' pri')} showOk /></>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
