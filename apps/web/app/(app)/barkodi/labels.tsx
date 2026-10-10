'use client';
/**
 * Label selection and printing (legacy `barkodi` table + `bkLabelsHTML` / `eanPNG` 9195–9217): A4 70 × 37 mm labels with
 * name, EAN-13 bars (SVG), retail price with VAT, unit, firm and code. Scanning a barcode in the search field adds a label.
 */
import { useMemo, useState } from 'react';
import { EAN_GUARDS, eanBits } from '@wise/core/retail';
import { fmt, fq } from '@/lib/fmt';

export interface LabelRow { id: string; code: string; name: string; unit: string; barcode: string; valid: boolean; price: number; qty: number }

function Ean({ code }: { code: string }) {
  const bits = eanBits(code);
  if (!bits) return null;
  const n = bits.length, mw = 1, q = 9, h = 50;
  return (
    <svg viewBox={`0 0 ${n + 2 * q} ${h + 10}`} width="100%" style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      {[...bits].map((b, i) => (b === '1' ? <rect key={i} x={q + i * mw} y={0} width={mw} height={EAN_GUARDS.has(i) ? h + 5 : h} fill="#000" /> : null))}
      <text x={q / 2} y={h + 9} fontSize="8" fontFamily="Arial" textAnchor="middle">{code[0]}</text>
      <text x={q + 24} y={h + 9} fontSize="8" fontFamily="Arial" textAnchor="middle">{code.slice(1, 7)}</text>
      <text x={q + 70} y={h + 9} fontSize="8" fontFamily="Arial" textAnchor="middle">{code.slice(7)}</text>
    </svg>
  );
}

export function Labels({ rows, firmName }: { rows: LabelRow[]; firmName: string }) {
  const [sel, setSel] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const n = Object.values(sel).reduce((a, v) => a + (v || 0), 0);
  const vis = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => !s || `${r.name} ${r.code} ${r.barcode}`.toLowerCase().includes(s)).slice(0, 500);
  }, [rows, q]);
  const out = rows.flatMap((r) => (r.valid ? Array.from({ length: sel[r.id] || 0 }, () => r) : []));
  const print = () => {
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  };
  return (
    <>
      <div className="card"><div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Назив, шифра или скенирај баркод" style={{ width: 280 }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const it = rows.find((r) => r.barcode === q.trim() || r.code === q.trim());
            if (it && it.valid) { setSel((x) => ({ ...x, [it.id]: (x[it.id] || 0) + 1 })); setQ(''); }
          }} />
        <button type="button" className="btn pri" disabled={!n} onClick={print}>🏷 Печати {n} етикети</button>
        <button type="button" className="btn sm" onClick={() => setSel(Object.fromEntries(rows.filter((r) => r.valid && Math.round(r.qty) > 0).map((r) => [r.id, Math.round(r.qty)])))}>Етикети = залиха</button>
        <button type="button" className="btn sm" onClick={() => setSel(Object.fromEntries(rows.filter((r) => r.valid).map((r) => [r.id, 1])))}>По 1 етикета</button>
        <button type="button" className="btn sm" onClick={() => setSel({})}>Исчисти</button>
      </div></div>
      <div className="tw noprint"><table className="dense">
        <thead><tr><th>Шифра</th><th>Назив</th><th>Баркод</th><th className="n">Цена со ДДВ</th><th className="n">Залиха</th><th className="n">Етикети</th></tr></thead>
        <tbody>{vis.map((r) => (
          <tr key={r.id}>
            <td>{r.code}</td><td>{r.name}</td>
            <td>{r.barcode ? <>{r.barcode}{!r.valid && <> <span className="pill warn" title="Не е EAN-13 – етикета не може да се печати">не е EAN-13</span></>}</> : <span className="mini" style={{ color: 'var(--muted)' }}>нема</span>}</td>
            <td className="n">{fmt(r.price)}</td><td className="n">{fq(r.qty)}</td>
            <td className="n"><input type="number" min={0} step={1} value={sel[r.id] || ''} disabled={!r.valid} style={{ width: 70, textAlign: 'right' }}
              onChange={(e) => setSel((x) => ({ ...x, [r.id]: Math.max(0, parseInt(e.target.value, 10) || 0) }))} /></td>
          </tr>
        ))}{!vis.length && <tr><td colSpan={6} className="note">Нема артикли.</td></tr>}</tbody>
      </table></div>
      <div className="printarea" style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
        {out.map((it, i) => (
          <div key={i} style={{ width: '70mm', height: '37mm', boxSizing: 'border-box', padding: '2.5mm 4mm', border: '1px dashed #bbb', overflow: 'hidden', fontFamily: 'Arial', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#fff', color: '#000' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, lineHeight: 1.15, maxHeight: '21pt', overflow: 'hidden' }}>{it.name}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3mm' }}>
              <div style={{ width: '38mm' }}><Ean code={it.barcode} /></div>
              <div style={{ flex: 1, textAlign: 'right' }}><div style={{ fontSize: '16pt', fontWeight: 900, lineHeight: 1 }}>{fmt(it.price)}</div><div style={{ fontSize: '6.5pt' }}>ден. со ДДВ · {it.unit || 'ком'}</div></div>
            </div>
            <div style={{ fontSize: '6pt', color: '#555' }}>{firmName}{it.code ? ' · шифра ' + it.code : ''}</div>
          </div>
        ))}
      </div>
    </>
  );
}
