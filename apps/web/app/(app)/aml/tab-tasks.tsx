/** 📋 Задачи — dashboard of the open AML tasks per firm and for the office (`amlTasks`). */
import { AML_LV, amlTasks, type AmlCdd, type AmlLevel } from '@wise/core/office';
import { Pill } from '@/components/file-chips';
import { FirmGo } from '@/components/firm-go';
import { dmy } from '@/components/hd';
import type { AmlOffice } from '@/lib/aml';
import type { AmlFirm, AmlRec, AmlRep } from './report-form';

export function TabTasks({ clients, records, reports, office, today, firmId }: { clients: AmlFirm[]; records: AmlRec[]; reports: AmlRep[]; office: AmlOffice; today: string; firmId: string | null }) {
  const T = amlTasks({
    today, office,
    clients: clients.map((c) => {
      const r = records.find((x) => x.firmId === c.id);
      return { id: c.id, name: c.name, rec: r ? { data: r.data as AmlCdd, level: r.level as AmlLevel, nextReview: r.nextReview } : null };
    }),
    reports: reports.map((r) => ({ id: r.id, firmId: r.firmId, firmName: r.firmName, status: r.status, data: r.data, createdAt: r.createdAt.toISOString() })),
  });
  const cnt = (s: string) => T.filter((t) => t.sev === s).length;
  const lv = (l: AmlLevel) => records.filter((r) => r.level === l && clients.some((c) => c.id === r.firmId)).length;
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 0 10px', alignItems: 'stretch' }}>
        <div className="card" style={{ flex: 1, minWidth: 140, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Итни / доцнат</div><div style={{ fontSize: 22, fontWeight: 700, color: cnt('bad') ? 'var(--bad)' : undefined }}>{cnt('bad')}</div></div>
        <div className="card" style={{ flex: 1, minWidth: 140, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Предупредувања</div><div style={{ fontSize: 22, fontWeight: 700 }}>{cnt('warn')}</div></div>
        {(['high', 'midhi', 'mid', 'low'] as const).map((l) => <div key={l} className="card" style={{ flex: 1, minWidth: 120, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{AML_LV[l][0]} ризик</div><div style={{ fontSize: 22, fontWeight: 700 }}>{lv(l)}</div></div>)}
        <div className="card" style={{ flex: 1, minWidth: 120, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Без анализа</div><div style={{ fontSize: 22, fontWeight: 700 }}>{clients.filter((c) => !records.some((r) => r.firmId === c.id)).length}</div></div>
      </div>
      <div className="card tw">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Отворени задачи ({T.length})</h2>
        {T.length ? <table className="dense">
          <thead><tr><th></th><th>Фирма</th><th>Задача</th><th>Рок</th><th></th></tr></thead>
          <tbody>{T.map((t, i) => (
            <tr key={i}>
              <td><Pill c={t.sev}>{t.sev === 'bad' ? 'итно' : t.sev === 'warn' ? 'да се среди' : 'инфо'}</Pill></td>
              <td>{t.firm}</td><td>{t.text}</td>
              <td style={t.due && t.due < today ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(t.due)}</td>
              <td className="noprint">{t.firmId && t.tab === 'cl'
                ? <FirmGo fid={t.firmId} current={firmId} to="/aml?tab=cl" className="btn sm">Отвори</FirmGo>
                : <a className="btn sm" href={`/aml?tab=${t.tab}`}>Отвори</a>}</td>
            </tr>
          ))}</tbody>
        </table> : <div className="empty">Нема отворени задачи. ✓</div>}
      </div>
    </>
  );
}
