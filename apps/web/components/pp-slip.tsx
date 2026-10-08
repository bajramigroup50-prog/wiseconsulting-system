/**
 * One payment-order slip 210×99 mm (legacy `ppSlip` 15796): `full` draws the form with labels and boxes on plain
 * paper; `data` prints only the values (for pre-printed forms), shifted by the calibration offset.
 */
import { PP_LAY, ppFieldText, type PaymentOrder } from '@wise/core';

export function PpSlip({ n, mode = 'full', dx = 0, dy = 0 }: { n: PaymentOrder; mode?: 'full' | 'data'; dx?: number; dy?: number }) {
  const L = PP_LAY[n.kind];
  const full = mode !== 'data';
  const C = full ? { dx: 0, dy: 0 } : { dx, dy };
  return (
    <div className="ppslip" style={{ position: 'relative', width: '210mm', height: '99mm', overflow: 'hidden', boxSizing: 'border-box', background: '#fff', color: '#000', ...(full ? { borderBottom: '0.2mm dashed #999' } : {}) }}>
      {full && <>
        <div style={{ position: 'absolute', left: '5mm', top: '3mm', font: 'bold 10.5pt Arial' }}>{L.title}</div>
        <div style={{ position: 'absolute', right: '6mm', top: '3.5mm', font: '7pt Arial' }}>образец {n.kind.replace('pp', 'ПП')}</div>
      </>}
      {L.f.map(([k, label, x, y, w, h, ml, t]) => (
        <div key={k}>
          {full && <>
            <div style={{ position: 'absolute', left: `${x}mm`, top: `${y - 3.2}mm`, font: '5.6pt Arial', color: '#333', whiteSpace: 'nowrap' }}>{label}</div>
            <div style={{ position: 'absolute', left: `${x}mm`, top: `${y}mm`, width: `${w}mm`, height: `${h}mm`, border: '0.25mm solid #444', boxSizing: 'border-box' }} />
          </>}
          {k !== 'sign' && (
            <div style={{
              position: 'absolute', left: `${x + 1 + C.dx}mm`, top: `${y + (ml ? 0.6 : h / 2 - 2) + C.dy}mm`, width: `${w - 2}mm`,
              font: t === 'acc' || t === 'amt' ? 'bold 10pt Consolas, "Courier New", monospace' : '9pt Arial',
              textAlign: t === 'amt' ? 'right' : undefined, whiteSpace: ml ? 'pre-line' : 'nowrap', overflow: 'hidden', lineHeight: 1.15,
            }}>{ppFieldText(n, k, t)}</div>
          )}
        </div>
      ))}
    </div>
  );
}
