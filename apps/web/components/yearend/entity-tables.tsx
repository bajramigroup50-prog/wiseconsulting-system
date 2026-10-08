/**
 * Entity variants of the annual account:
 *  - sole trader / self-employed: Образец „Б“ + ДЛД-ДБ (legacy `VIEWS.zsTP` 10499, `tpData` 10497)
 *  - non-profit: Биланс на приходи и расходи, Биланс на состојба, ДБ-НП (legacy `VIEWS.zsNPO` 10463, `npoTable` 10462)
 * With `print` the tables render without inputs for the print view.
 */
import { NPO_BS, NPO_PR, r2, type NpoResult, type TpResult } from '@wise/core';
import type { Firm } from '@wise/db';
import { fmt } from '@/lib/fmt';

const In = ({ name, v, print }: { name: string; v: number | string | undefined; print?: boolean }) =>
  print ? <>{fmt(+(v ?? 0) || 0)}</> : <input name={name} type="number" step="any" defaultValue={v ? String(v) : ''} style={{ width: 120, textAlign: 'right' }} />;

export function TpTables({ T, firm, year, print }: { T: TpResult; firm: Firm; year: number; print?: boolean }) {
  return (
    <>
      {print && <div className="ph"><div><div className="pt">Образец „Б“ и ДЛД-ДБ</div><div className="ps">за {year} година</div></div><div className="pm">{firm.name}<br />ЕДБ {firm.edb}</div></div>}
      <div className={print ? '' : 'cols'} style={{ alignItems: 'start' }}>
        <div className={print ? '' : 'card'}>
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Образец „Б“ – Биланс на приходи и расходи</h2>
          <table className="dense"><tbody>
            <tr className="sub"><td colSpan={2}><b>ПРИХОДИ</b></td></tr>
            {T.I.map(([n, v]) => <tr key={n}><td>{n}</td><td className="n">{fmt(v)}</td></tr>)}
            <tr className="tot"><td>Вкупно приходи</td><td className="n">{fmt(T.inc)}</td></tr>
            <tr className="sub"><td colSpan={2}><b>РАСХОДИ</b></td></tr>
            {T.E.map(([n, v]) => <tr key={n}><td>{n}</td><td className="n">{fmt(v)}</td></tr>)}
            <tr className="tot"><td>Вкупно расходи</td><td className="n">{fmt(T.exp)}</td></tr>
            <tr className="tot"><td>{T.res >= 0 ? 'Нето доход (добивка)' : 'Загуба'}</td><td className="n">{fmt(Math.abs(T.res))}</td></tr>
          </tbody></table>
        </div>
        <div className={print ? '' : 'card'}>
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>ДЛД-ДБ – Годишен даночен биланс (данок на личен доход од самостојна дејност)</h2>
          <table className="dense"><tbody>
            <tr><td>01</td><td>Нето-доход пред оданочување</td><td className="n">{fmt(Math.max(0, T.res))}</td></tr>
            <tr><td>02</td><td>Загуба</td><td className="n">{fmt(Math.max(0, -T.res))}</td></tr>
            <tr className="sub"><td colSpan={3}><b>03 Непризнаени расходи за даночни цели</b></td></tr>
            {T.ND.map((x) => <tr key={x.k}><td /><td>{x.n}</td><td className="n"><In name={'dld' + x.k} v={x.v} print={print} /></td></tr>)}
            <tr className="tot"><td>03</td><td>Вкупно непризнаени расходи</td><td className="n">{fmt(T.nd)}</td></tr>
            <tr className="tot"><td>22</td><td>Даночна основа (01 − 02 + 03)</td><td className="n">{fmt(T.base)}</td></tr>
            <tr><td>23</td><td>Намалување на даночната основа (вложувања и сл.)</td><td className="n"><In name="dldred" v={T.red} print={print} /></td></tr>
            <tr className="tot"><td>28</td><td>Основа за пресметување на данокот</td><td className="n">{fmt(T.b2)}</td></tr>
            <tr className="tot"><td>37</td><td>Годишен данок (10%)</td><td className="n">{fmt(T.tax)}</td></tr>
            <tr><td>38</td><td>Платени аконтации во годината</td><td className="n"><In name="dldak" v={T.ak} print={print} /></td></tr>
            <tr className="tot"><td>39</td><td>{T.diff >= 0 ? 'За доплата' : 'Повеќе платено'}</td><td className="n">{fmt(Math.abs(T.diff))}</td></tr>
          </tbody></table>
          <p className="note">Месечна аконтација за {year + 1}: <b>{fmt(r2(T.tax / 12))}</b> ден. (1/12 од годишниот данок), до 15-ти во месецот за претходниот месец.</p>
        </div>
      </div>
    </>
  );
}

function NpoTable({ R, V, year }: { R: typeof NPO_PR; V: Record<string, number>; year: number }) {
  return (
    <div className="tw"><table className="dense">
      <thead><tr><th style={{ width: 60 }}>АОП</th><th>Позиција</th><th className="n">{year}</th></tr></thead>
      <tbody>{R.map((row) => row.length === 3
        ? <tr className="sub" key={row[0]}><td colSpan={3}><b>{row[2]}</b></td></tr>
        : <tr key={row[0]} className={!row[3] || /^[IVX]+\.|ВКУПН/.test(row[2]) ? 'tot' : ''}><td className="num" style={{ textAlign: 'left' }}>{row[1]}</td><td>{row[2]}</td><td className="n">{fmt(V[row[0]] || 0)}</td></tr>)}
      </tbody>
    </table></div>
  );
}

export function NpoTables({ N, firm, year, print }: { N: NpoResult; firm: Firm; year: number; print?: boolean }) {
  const d = N.dbnp;
  return (
    <>
      {print && <div className="ph"><div><div className="pt">Годишна сметка – непрофитна организација</div><div className="ps">за {year} година</div></div><div className="pm">{firm.name}<br />ЕМБС {firm.embs}</div></div>}
      <h2>Биланс на приходи и расходи</h2>
      <NpoTable R={NPO_PR} V={N.V} year={year} />
      <p className="note">Контрола: 239 = {fmt(N.V['239'])} · 252 = {fmt(N.V['252'])} {Math.abs((N.V['239'] || 0) - (N.V['252'] || 0)) < 0.01 ? <span className="pill good">се совпаѓаат</span> : <span className="pill bad">разлика</span>}</p>
      <h2>Биланс на состојба</h2>
      <NpoTable R={NPO_BS} V={N.V} year={year} />
      <p className="note">{Math.abs((N.V['042'] || 0) - (N.V['069'] || 0)) < 0.01 ? <span className="pill good">Актива = Пасива</span> : <span className="pill bad">Актива {fmt(N.V['042'])} ≠ Пасива {fmt(N.V['069'])}</span>}{N.closed ? '' : ' · годината не е затворена: тековниот вишок е прикажан во 067 (недостигот во 037).'}</p>
      <h2>ДБ-НП/ВП – данок на приходи од стопанска дејност</h2>
      <div className="tw"><table className="dense"><tbody>
        <tr className="tot"><td>05</td><td>Вкупен приход од стопанска дејност</td><td className="n">{fmt(d.econ)}</td></tr>
        <tr><td>06</td><td>Намалување на приходот за 1.000.000 денари</td><td className="n">{fmt(d.red)}</td></tr>
        <tr className="tot"><td>07</td><td>Даночна основа (05 − 06)</td><td className="n">{fmt(d.base)}</td></tr>
        <tr className="tot"><td>08</td><td>Годишен данок (07 × 1%)</td><td className="n">{fmt(d.tax)}</td></tr>
      </tbody></table></div>
      <p className="note">{d.econ > 1_000_000 ? '⚠ Приходот од стопанска дејност е над 1.000.000 денари – ДБ-НП/ВП се поднесува до УЈП (е-Даноци) до крајот на февруари.' : '✓ Приходот од стопанска дејност не е над 1.000.000 денари – нема обврска за ДБ-НП/ВП.'} Членарините, донациите, грантовите и подароците не се оданочуваат.</p>
      {N.un.length > 0 && !print && <div className="callout warn">Конта со салдо што не се распоредени во образците: {N.un.map((x) => `${x.k} (${fmt(x.s)})`).join(', ')}</div>}
    </>
  );
}
