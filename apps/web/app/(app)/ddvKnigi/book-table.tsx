/** VAT book table and export rows (legacy `dkTable` 8898, `dkCsv` 8912), shared by the screen and the print view. */
import { dmy, fmt } from '@/lib/fmt';
import { bookColumns, type VatBookData } from '@/lib/vat-view';

/** Export rows (legacy `dkCsv` 8912). */
export function bookExportRows(B: VatBookData): (string | number)[][] {
  const C = bookColumns(B.t);
  const R = B.rows as unknown as Record<string, string | number>[];
  return [
    ['Р.бр', 'Датум', 'Број', B.t === 'out' ? 'Купувач' : 'Добавувач', 'ЕДБ', ...C.map((c) => c[1]), 'Забелешка'],
    ...R.map((r, i) => [i + 1, dmy(String(r.date)), String(r.no ?? ''), String(r.name ?? ''), String(r.edb ?? ''), ...C.map(([k]) => Number(r[k]) || 0), String(r.note ?? '')]),
    ['', '', '', `Вкупно (${R.length})`, '', ...C.map(([k]) => B.sum[k] ?? 0), ''],
  ];
}

/** Book table (legacy `dkTable` 8898); `pdf` = print layout (note next to the name, no note column). */
export function BookTable({ B, pdf }: { B: VatBookData; pdf?: boolean }) {
  const C = bookColumns(B.t);
  const R = B.rows as unknown as Record<string, string | number>[];
  return (
    <table className="dense">
      <thead><tr><th>Р.бр</th><th>Датум</th><th>Број</th><th>{B.t === 'out' ? 'Купувач' : 'Добавувач'}</th><th>ЕДБ</th>{C.map(([k, n]) => <th key={k} className="n">{n}</th>)}{!pdf && <th>Забелешка</th>}</tr></thead>
      <tbody>
        {R.length ? R.map((r, i) => (
          <tr key={i}>
            <td>{i + 1}</td><td>{dmy(String(r.date))}</td><td>{r.no}</td>
            <td>{r.name}{pdf && r.note ? <> <small>({r.note})</small></> : null}</td><td>{r.edb}</td>
            {C.map(([k]) => <td key={k} className="n">{Number(r[k]) ? fmt(r[k]) : ''}</td>)}
            {!pdf && <td className="mini">{r.note}</td>}
          </tr>
        )) : <tr><td colSpan={C.length + 6} className="empty">Нема фактури во периодот.</td></tr>}
      </tbody>
      <tfoot><tr><td colSpan={5}>Вкупно ({R.length})</td>{C.map(([k]) => <td key={k} className="n">{fmt(B.sum[k])}</td>)}{!pdf && <td />}</tr></tfoot>
    </table>
  );
}

