/**
 * Tables shared by the screens and their print views: item card (legacy `kartTable` 4979), МЕТГ (`metgHTML` 5045),
 * and the Excel rows of both.
 */
import type { ItemCard, MetgCard, StockItem } from '@wise/core';
import { dmy, fmt, fq } from '@/lib/fmt';

const neg = (v: number) => (v < 0 ? { color: '#c0392b' } : undefined);

export function KartTable({ k, retail }: { k: ItemCard; retail: boolean }) {
  return (
    <table className="kart">
      <thead><tr><th>Датум</th><th>Документ</th><th className="n">Влез</th><th className="n">Излез</th><th className="n">{retail ? 'МПЦ' : 'Цена'}</th><th className="n">Вредност влез</th><th className="n">Вредност излез</th><th className="n">Состојба</th><th className="n">Вредност</th></tr></thead>
      <tbody>
        {k.rows.map((r, i) => r.open
          ? <tr key={i} className="sub"><td>{dmy(k.from)}</td><td>Почетна состојба</td><td /><td /><td /><td /><td /><td className="n">{fq(r.q)}</td><td className="n">{fmt(r.v)}</td></tr>
          : (
            <tr key={i}>
              <td>{dmy(r.move.date)}</td><td>{r.move.label || r.move.type}</td>
              <td className="n">{r.in ? fq(r.in) : ''}</td><td className="n">{r.out ? fq(r.out) : ''}</td><td className="n">{fmt(r.price)}</td>
              <td className="n">{r.vin ? fmt(r.vin) : ''}</td><td className="n">{r.vout ? fmt(r.vout) : ''}</td><td className="n">{fq(r.q)}</td><td className="n">{fmt(r.v)}</td>
            </tr>
          ))}
      </tbody>
      <tfoot><tr><td colSpan={2}>Вкупно</td><td className="n">{fq(k.totals.in)}</td><td className="n">{fq(k.totals.out)}</td><td /><td className="n">{fmt(k.totals.vin)}</td><td className="n">{fmt(k.totals.vout)}</td><td className="n">{fq(k.totals.q)}</td><td className="n">{fmt(k.totals.v)}</td></tr></tfoot>
    </table>
  );
}

export function kartAoa(k: ItemCard, retail: boolean): (string | number)[][] {
  return [
    ['Датум', 'Документ', 'Влез', 'Излез', retail ? 'МПЦ' : 'Цена', 'Вредност влез', 'Вредност излез', 'Состојба', 'Вредност'],
    ...k.rows.map((r) => (r.open ? [dmy(k.from), 'Почетна состојба', '', '', '', '', '', r.q, r.v] : [dmy(r.move.date), r.move.label || r.move.type, r.in || '', r.out || '', r.price, r.vin || '', r.vout || '', r.q, r.v])),
    ['', 'Вкупно', k.totals.in, k.totals.out, '', k.totals.vin, k.totals.vout, k.totals.q, k.totals.v],
  ];
}

export function MetgTable({ it, D, whName, from, to }: { it: StockItem; D: MetgCard; whName: string; from: string; to: string }) {
  return (
    <>
      <div className="grid2">
        <div className="box"><b>Назив на стоката:</b> {it.name}<br /><b>Шифра:</b> {it.code} · <b>Ед. мера:</b> {it.unit}</div>
        <div className="box"><b>Магацин:</b> {whName}<br /><b>Период:</b> {dmy(from)} – {dmy(to)}</div>
      </div>
      <table>
        <thead>
          <tr><th>Реден број</th><th>Датум на книжење</th><th>Број на документ</th><th>Датум на документ</th><th>Назив на документ / комитент</th><th className="n">Количина набавена</th><th className="n">Количина продадена</th><th className="n">Крајна состојба</th></tr>
          <tr>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr>
        </thead>
        <tbody>
          <tr className="sub"><td /><td>{dmy(from)}</td><td colSpan={3}>Почетна состојба / пренос</td><td /><td /><td className="n">{fq(D.open)}</td></tr>
          {D.rows.map((r, i) => (
            <tr key={i}><td>{i + 1}</td><td>{dmy(r.date)}</td><td>{r.no}</td><td>{dmy(r.ddate)}</td><td>{r.name}</td>
              <td className="n">{r.in ? fq(r.in) : ''}</td><td className="n">{r.out ? fq(r.out) : ''}</td><td className="n" style={neg(r.bal)}>{fq(r.bal)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fq(D.totals.in)}</td><td className="n">{fq(D.totals.out)}</td><td className="n">{fq(D.totals.bal)}</td></tr></tfoot>
      </table>
    </>
  );
}

export function metgAoa(D: MetgCard, from: string): (string | number)[][] {
  return [
    ['Реден број', 'Датум на книжење', 'Број на документ', 'Датум на документ', 'Назив на документ / комитент', 'Количина набавена', 'Количина продадена', 'Крајна состојба'],
    ['', dmy(from), 'Почетна состојба / пренос', '', '', '', '', D.open],
    ...D.rows.map((r, i) => [i + 1, dmy(r.date), r.no, dmy(r.ddate), r.name, r.in || '', r.out || '', r.bal]),
    ['', '', 'Вкупно', '', '', D.totals.in, D.totals.out, D.totals.bal],
  ];
}
