/**
 * „Прилог кон ДДВ-04 – промет по членови“: the invoices behind fields 07–11 (export, exempt with / without deduction,
 * non-resident, чл. 32-а), one section per non-zero field. Built by `ddvFieldDocs` (@wise/core) from the same
 * computation as the form, so each section's total is exactly its field (the whole-denar rounding shown when any).
 * Used on the ДДВ-04 screen (expandable sections, the field amounts link here) and on `/print/ddv04Prilog`.
 */
import type { DdvFieldSection } from '@wise/core';

const f2 = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => (d ? d.split('-').reverse().join('.') : '');
const KIND: Record<string, string> = { invoice: 'Фактура', credit: 'Одобрение', sales: 'Дневен промет' };

/** Rows for Excel / CSV: one block per field, with its total, the rounding and the field. */
export function annexSheet(S: readonly DdvFieldSection[], period: string): (string | number)[][] {
  const out: (string | number)[][] = [[`Прилог кон ДДВ-04 – промет по членови, период ${period}`]];
  for (const s of S) {
    out.push([], [`Поле ${s.field}`, s.label], ['Вид', 'Број на фактура', 'Датум', 'Комитент', 'ЕДБ', 'Основица (ден.)', 'Основ / член']);
    for (const r of s.rows) out.push([KIND[r.kind] ?? r.kind, r.number, dmy(r.date), r.name, r.edb, r.base, r.basis]);
    out.push(['', '', '', '', 'Вкупно', s.sum, '']);
    if (s.rounding) out.push(['', '', '', '', 'Заокружување на цели денари', s.rounding, '']);
    out.push(['', '', '', '', `Поле ${s.field} во ДДВ-04`, s.value, '']);
  }
  return out;
}

export function DdvAnnex({ sections: S, expandable = false, open }: { sections: readonly DdvFieldSection[]; expandable?: boolean; open?: string }) {
  if (!S.length) return expandable ? null : <p>Во периодот нема промет во полињата 07–11.</p>;
  return (
    <>
      {S.map((s) => {
        const table = (
          <div className="tw"><table className="dense">
            <thead><tr><th>Вид</th><th>Број на фактура</th><th>Датум</th><th>Комитент</th><th>ЕДБ</th><th className="n">Основица</th><th>Основ / член</th></tr></thead>
            <tbody>{s.rows.map((r, i) => (
              <tr key={i}><td>{KIND[r.kind] ?? r.kind}</td><td>{r.number}</td><td>{dmy(r.date)}</td><td>{r.name}</td><td>{r.edb}</td>
                <td className="n" style={r.base < 0 ? { color: 'var(--bad, #b00)' } : undefined}>{f2(r.base)}</td><td>{r.basis}</td></tr>
            ))}</tbody>
            <tfoot>
              <tr><td colSpan={5}>Вкупно ({s.rows.length})</td><td className="n"><b>{f2(s.sum)}</b></td><td /></tr>
              {!!s.rounding && <tr><td colSpan={5}>Заокружување на цели денари</td><td className="n">{f2(s.rounding)}</td><td /></tr>}
              <tr><td colSpan={5}>Поле {s.field} во ДДВ-04</td><td className="n"><b>{f2(s.value)}</b></td><td /></tr>
            </tfoot>
          </table></div>
        );
        return expandable
          ? <details key={s.field} id={'annex-' + s.field} className="card" open={open === s.field}><summary style={{ cursor: 'pointer' }}><b>Поле {s.field}</b> – {s.label}: <b>{f2(s.value)}</b> ден. · {s.rows.length} документи</summary>{table}</details>
          : <section key={s.field} style={{ breakInside: 'avoid-page', marginBottom: 14 }}><h3 style={{ margin: '10px 0 4px' }}>Поле {s.field} – {s.label}</h3>{table}</section>;
      })}
    </>
  );
}
