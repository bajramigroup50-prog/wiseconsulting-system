'use client';
/**
 * 🧪 Тест: брз наспроти детален AI модел (legacy `aiCmp` / `aiCmpGo` 14412–14416, admin only): the same purchase
 * invoice is read twice (quick and detailed model) by the worker (`ai_documents.kind = 'cmp'`) and the results are
 * compared. Nothing is saved.
 */
import Link from 'next/link';
import { scanConsistent, type ScanInvoice } from '@wise/core/sales';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';

type One = { data: (ScanInvoice & { invoices?: ScanInvoice[] }) | null; model: string; cost: number; error: string | null };
const n2 = (x: number) => Number(x || 0).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sum(r0: One['data']) {
  if (!r0) return null;
  const r = Array.isArray(r0.invoices) && r0.invoices.length ? r0.invoices[0]! : r0;
  const L = r.lines ?? [];
  const G = (r.groups ?? []).filter((g) => Number(g.base));
  return {
    sup: r.supplierName ?? '', edb: r.supplierEdb ?? '', no: r.number ?? '', date: r.date ?? '', total: Number(r.total) || 0,
    base: G.reduce((a, g) => a + (Number(g.base) || 0), 0), vat: G.reduce((a, g) => a + (Number(g.vat) || 0), 0),
    lines: L.length, lsum: L.reduce((a, l) => a + (Number(l.amount) || (Number(l.qty) || 0) * (Number(l.price) || 0)), 0), ok: scanConsistent(r),
  };
}

export function AiCompare({ firmId }: { firmId: string }) {
  const { docs, msg, busy, read } = useAiRead(firmId);
  const done = docs.filter((d) => d.status === 'done');
  return (
    <div className="card" style={{ maxWidth: 1100 }}>
      <div className="hd"><h2>🧪 Тест: брз наспроти детален AI модел</h2><Link className="btn" href="/skan">Затвори</Link></div>
      <p className="note">Изберете влезна фактура (PDF или слика). Истата фактура се чита <b>двапати</b> – со брзиот (поевтин) и со деталниот модел – и резултатите се споредуваат. Ништо не се зачувува.</p>
      <AiDrop small disabled={busy} onFiles={(f) => void read('cmp', f)} label={<b>▶ Спореди – изберете датотеки</b>} />
      <AiReadList docs={docs} msg={msg} />
      {done.map((d) => {
        const R = d.result as { quick: One; deep: One } | null;
        if (!R) return null;
        const q = sum(R.quick.data), x = sum(R.deep.data);
        const rows: [string, (s: NonNullable<ReturnType<typeof sum>>) => string][] = [
          ['Добавувач', (s) => s.sup], ['ЕДБ', (s) => s.edb], ['Број', (s) => s.no], ['Датум', (s) => s.date], ['Основица', (s) => n2(s.base)],
          ['ДДВ', (s) => n2(s.vat)], ['Вкупно', (s) => n2(s.total)], ['Ставки', (s) => String(s.lines)], ['Збир ставки', (s) => n2(s.lsum)],
          ['Износите се совпаѓаат', (s) => (s.ok ? '✓' : '✗')],
        ];
        return (
          <div key={d.id} className="card" style={{ margin: '8px 0' }}>
            <b>{d.name}</b>
            <div className="tw"><table className="dense"><thead><tr><th></th><th>Брз ({R.quick.model || '—'})</th><th>Детален ({R.deep.model || '—'})</th></tr></thead>
              <tbody>{rows.map(([l, f]) => {
                const a = q ? f(q) : R.quick.error ?? '—', b = x ? f(x) : R.deep.error ?? '—';
                return <tr key={l}><td>{l}</td><td style={a !== b ? { color: 'var(--bad)' } : undefined}>{a}</td><td>{b}</td></tr>;
              })}
                <tr><td>Трошок (USD)</td><td>{R.quick.cost.toFixed(4)}</td><td>{R.deep.cost.toFixed(4)}</td></tr></tbody></table></div>
          </div>);
      })}
    </div>
  );
}
