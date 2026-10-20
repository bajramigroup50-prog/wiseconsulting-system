/** ✅ Подготвеност за сертификација – per standard the items with ✓ / ◐ / ✗, what is missing and where to fill it in. */
import Link from 'next/link';
import type { ReadySection, ReadyState } from '@wise/core/office/iso-ready';

const IC: Record<ReadyState, [string, string]> = { ok: ['✓', 'var(--good)'], part: ['◐', 'var(--warn)'], miss: ['✗', 'var(--bad)'] };

export function ReadyView({ S, full }: { S: ReadySection[]; full?: boolean }) {
  return (
    <div className="card">
      <div className="hd"><h2 style={{ margin: 0 }}>✅ Подготвеност за сертификација</h2>{!full && <Link className="btn sm" href="/iso?k=ready">Детали →</Link>}</div>
      <p className="note" style={{ marginTop: 4 }}>Канцеларијата сè уште не е сертифицирана – тука е сè што сертификациското тело ќе го побара (задолжителни документирани информации и записи), пресметано од регистрите. ✓ подготвено · ◐ делумно · ✗ недостасува.</p>
      <div className="tiles kpi k4">
        {S.map((s) => (
          <Link key={s.std} href={`/iso?k=ready#r${s.std}`} className="tile kt" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="kh"><span>{s.n}</span></div>
            <b className="num" style={{ color: s.pct >= 90 ? 'var(--good)' : s.pct >= 50 ? 'var(--warn)' : 'var(--bad)' }}>{s.pct}%</b>
            <i>{s.items.filter((x) => x.state === 'ok').length} ✓ · {s.items.filter((x) => x.state === 'part').length} ◐ · {s.items.filter((x) => x.state === 'miss').length} ✗</i>
          </Link>
        ))}
      </div>
      {full && S.map((s) => (
        <div key={s.std} id={`r${s.std}`} style={{ marginTop: 12 }}>
          <h3 style={{ margin: '0 0 4px' }}>{s.n} – {s.pct}%</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th style={{ width: 24 }} /><th>Клаузула</th><th>Барање</th><th>Состојба</th><th /></tr></thead>
            <tbody>{s.items.map((x, i) => (
              <tr key={`${x.id}-${i}`}>
                <td style={{ color: IC[x.state][1], fontWeight: 700, textAlign: 'center' }}>{IC[x.state][0]}</td>
                <td className="mini" style={{ whiteSpace: 'nowrap' }}>{x.clause}</td>
                <td>{x.n}</td>
                <td className="mini" style={{ color: x.state === 'ok' ? undefined : IC[x.state][1] }}>{x.note}</td>
                <td><Link className="btn sm" href={x.href}>{x.state === 'ok' ? 'Види' : 'Пополни'}</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </div>
  );
}
