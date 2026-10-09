/** Legacy `VIEWS.kujna` 9989 — Кујна / шанк: lines sent from the tables and not ready yet (auto-refresh 20 s). */
import Link from 'next/link';
import { listDocs, type RestaurantOrder, type RestaurantTable } from '@wise/db';
import { db } from '@/lib/db';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { readyAction } from '../restoran/actions';

export default async function Kujna() {
  const g = await industryPage('kujna', 'Кујна / шанк');
  if (g.blocked) return g.blocked;
  const T = await listDocs<RestaurantTable>(db(), g.firm.id, 'rtable');
  const O = (await listDocs<RestaurantOrder>(db(), g.firm.id, 'rord', 'open')).filter((o) => o.data.lines.some((l) => l.sent && !l.ready)).sort((a, b) => a.data.opened.localeCompare(b.data.opened));
  return (
    <>
      <meta httpEquiv="refresh" content="20" />
      <Hd t="Кујна / шанк" sub={`${O.length} маси чекаат`}><Link className="btn" href="/restoran">🍽 Маси</Link></Hd>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {O.map((o) => (
          <div key={o.id} className="card" style={{ minWidth: 240, margin: 0 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Маса {T.find((t) => t.id === o.data.tableId)?.data.no} <span className="mini">{o.data.waiter}</span></h2>
            {o.data.lines.map((l, i) => l.sent && !l.ready ? (
              <div key={i} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--line)' }}>
                <span><b>{l.qty} ×</b> {l.name}{l.note && <><br /><span className="mini" style={{ color: 'var(--bad)' }}>{l.note}</span></>}<br /><span className="mini">{String(l.sent).slice(11, 16)}</span></span>
                {g.write && <RowAction className="btn sm pri" action={readyAction.bind(null, o.id, i)} label="✓ Готово" />}
              </div>) : null)}
          </div>
        ))}
        {!O.length && <div className="card empty">Нема нарачки во кујната.</div>}
      </div>
    </>
  );
}
