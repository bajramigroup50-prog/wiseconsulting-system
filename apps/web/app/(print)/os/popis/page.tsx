/**
 * Пописна листа на основни средства (Helix „Преглед по основни средства“ / попис): every asset not disposed by the
 * date, grouped by location, with cost, accumulated depreciation and present value to 31.12 of the year, empty columns
 * „Затечено“ / „Забелешка“ for the inventory commission and the commission's signatures.
 */
import { notFound } from 'next/navigation';
import { osCmp } from '@wise/core/yearend/assets-io';
import { depreciationFor } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';

export default async function OsPopis() {
  const { firm, year } = await booksPage('os');
  if (!firm) notFound();
  const d = await depreciationFor(db(), firm.id, year);
  const end = `${year}-12-31`;
  const by = new Map(d.rows.map((r) => [r.id, r]));
  const A = d.assets.filter((a) => a.date <= end && !(a.disposed && a.disposed <= end)).sort(osCmp);
  const G = new Map<string, typeof A>();
  for (const a of A) { const k = (a.location ?? '').trim() || 'Без локација'; (G.get(k) ?? G.set(k, []).get(k)!).push(a); }
  const sum = (L: typeof A, f: (a: (typeof A)[number]) => number) => L.reduce((s, a) => s + f(a), 0);
  const acc = (a: (typeof A)[number]) => by.get(a.id)?.acc ?? 0;
  const th = { border: '1px solid #333', padding: '3px 5px', background: '#eee' } as const, td = { border: '1px solid #333', padding: '3px 5px' } as const;
  const n = { ...td, textAlign: 'right' as const };
  return (
    <div style={{ font: '9.5pt Arial', padding: '8mm' }}>
      <title>{`Popis_osnovni_sredstva_${year}`}</title>
      <style>{'@page{size:A4 landscape;margin:10mm}table{border-collapse:collapse;width:100%;margin-bottom:6mm}h1{font-size:14pt;margin:0}h2{font-size:11pt;margin:4mm 0 1mm}'}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{firm.name}</b><span>ЕДБ {firm.edb ?? ''}</span></div>
      <h1 style={{ textAlign: 'center', margin: '4mm 0' }}>ПОПИСНА ЛИСТА НА ОСНОВНИ СРЕДСТВА со состојба на {dmy(end)}</h1>
      {A.length ? [...G].map(([loc, L]) => (
        <div key={loc}>
          <h2>Локација: {loc}</h2>
          <table>
            <thead><tr><th style={th}>Р.бр.</th><th style={th}>Инв. бр.</th><th style={th}>Назив</th><th style={th}>Сериски број</th><th style={th}>Конто</th><th style={th}>Набавено</th>
              <th style={th}>Набавна вредност</th><th style={th}>Отпис</th><th style={th}>Сегашна вредност</th><th style={{ ...th, width: '18mm' }}>Затечено (да / не)</th><th style={{ ...th, width: '40mm' }}>Забелешка</th></tr></thead>
            <tbody>{L.map((a, i) => (
              <tr key={a.id}><td style={td}>{i + 1}</td><td style={td}>{a.invNo}</td><td style={td}>{a.name}</td><td style={td}>{a.serial}</td><td style={td}>{a.konto}</td><td style={td}>{dmy(a.date)}</td>
                <td style={n}>{fmt(Number(a.cost))}</td><td style={n}>{fmt(acc(a))}</td><td style={n}>{fmt(Number(a.cost) - acc(a))}</td><td style={td} /><td style={td} /></tr>
            ))}</tbody>
            <tfoot><tr><td style={td} colSpan={6}><b>Вкупно {loc}</b></td><td style={n}><b>{fmt(sum(L, (a) => Number(a.cost)))}</b></td><td style={n}><b>{fmt(sum(L, acc))}</b></td><td style={n}><b>{fmt(sum(L, (a) => Number(a.cost) - acc(a)))}</b></td><td style={td} colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )) : <p>Нема основни средства.</p>}
      {A.length > 0 && <p><b>Вкупно: набавна {fmt(sum(A, (a) => Number(a.cost)))} · отпис {fmt(sum(A, acc))} · сегашна вредност {fmt(sum(A, (a) => Number(a.cost) - acc(a)))} ден.</b></p>}
      <div style={{ display: 'flex', gap: '12mm', marginTop: '12mm', textAlign: 'center' }}>
        {['Претседател на пописната комисија', 'Член', 'Член', 'Одговорно лице'].map((t, i) => <div key={i} style={{ flex: 1 }}><div style={{ height: '14mm' }} /><div style={{ borderTop: '1px solid #111', paddingTop: 2 }}>{t}</div></div>)}
      </div>
    </div>
  );
}
