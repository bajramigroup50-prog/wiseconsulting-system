/**
 * 📋 Изјава за применливост (ISO/IEC 27001:2022 §6.1.3 d): the 93 Annex A controls by theme – applicable, justification,
 * implementation status, evidence (with a link to where it is in the program); the proposal until the office confirms
 * a control; the form of the selected control; the print.
 */
import Link from 'next/link';
import { SOA_STATUS, SOA_THEMES, soaSummary, type SoaControl, type SoaTheme } from '@wise/core/office/iso-soa';
import { ActionForm, Submit } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { soaConfirmAll, soaSave } from './actions';

const ST: Record<string, string> = { 'спроведено': 'good', 'делумно': 'warn', 'планирано': 'bad', 'не се применува': '' };

export function SoaView({ L, sel }: { L: (SoaControl & { confirmed: boolean })[]; sel?: string }) {
  const S = soaSummary(L);
  const c = sel ? L.find((x) => x.id === sel) : undefined;
  return (
    <div className="card">
      <div className="hd"><h2 style={{ margin: 0 }}>📋 Изјава за применливост – ISO/IEC 27001:2022 Анекс А</h2>
        <a className="btn" href="/print/iso?doc=soa" target="_blank" rel="noreferrer">🖨 Печати SoA</a></div>
      <p className="note" style={{ marginTop: 4 }}>За секоја од 93-те контроли: дали се применува, оправдување, состојба на спроведување и доказ. Предлогот е подготвен за сметководствена канцеларија што ја развива својата програма; прегледајте го и потврдете го (✎ по контрола или сите одеднаш). Документот <Link href="/iso?k=policy">СУ-06</Link> се одобрува за целата табела.</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 8px' }}>
        <span className="pill">{S.confirmed} / {S.total} потврдени</span><span className="pill">применливи {S.applicable}</span><span className="pill good">спроведени {S.done}</span>
        <span className="pill warn">делумно {S.partial}</span><span className="pill bad">планирани {S.planned}</span><span className="pill">исклучени {S.excluded}</span>
        {S.confirmed < S.total && <RowAction action={soaConfirmAll} label={`✓ Прифати го предлогот за непотврдените (${S.total - S.confirmed})`} className="btn sm pri" showOk confirm="Предлогот за сите непотврдени контроли ќе се запише како потврден. Продолжи?" />}
      </div>

      {c && (
        <ActionForm action={soaSave} reset={false} className="card" style={{ background: 'var(--accent-soft)' }}>
          <input type="hidden" name="ctrl" value={c.id} />
          <h3 style={{ margin: '0 0 6px' }}>{c.id} {c.n}</h3>
          <div className="row" style={{ gap: '8px 14px', flexWrap: 'wrap' }}>
            <label className="f">Се применува<select name="applicable" defaultValue={c.applicable ? 'yes' : 'no'}><option value="yes">да</option><option value="no">не (исклучена)</option></select></label>
            <label className="f">Состојба<select name="status" defaultValue={c.status}>{SOA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="f" style={{ flex: '1 1 100%' }}>Оправдување (зошто се применува / зошто е исклучена)<textarea name="justification" rows={2} defaultValue={c.justification} required /></label>
            <label className="f" style={{ flex: '1 1 100%' }}>Доказ / како е спроведена<textarea name="evidence" rows={2} defaultValue={c.evidence} /></label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><Submit>✓ Потврди</Submit><Link className="btn" href="/iso?k=soa">Откажи</Link></div>
        </ActionForm>
      )}

      {(Object.keys(SOA_THEMES) as SoaTheme[]).map((t) => (
        <div key={t} style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 4px' }}>{SOA_THEMES[t]}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Контрола</th><th>Се применува</th><th>Оправдување</th><th>Состојба</th><th>Доказ</th><th /></tr></thead>
            <tbody>{L.filter((x) => x.theme === t).map((x) => (
              <tr key={x.id} id={x.id} style={x.confirmed ? undefined : { opacity: 0.75 }}>
                <td style={{ whiteSpace: 'nowrap' }}><b>{x.id}</b><div className="mini" style={{ whiteSpace: 'normal', maxWidth: 240 }}>{x.n}</div></td>
                <td>{x.applicable ? 'да' : <b>не</b>}</td>
                <td className="mini" style={{ maxWidth: 280 }}>{x.justification}</td>
                <td><span className={`pill ${ST[x.status] ?? ''}`}>{x.status}</span>{!x.confirmed && <div className="mini">предлог</div>}</td>
                <td className="mini" style={{ maxWidth: 320 }}>{x.href ? <Link href={x.href}>{x.evidence}</Link> : x.evidence}</td>
                <td><Link className="btn sm" href={`/iso?k=soa&c=${encodeURIComponent(x.id)}`}>✎</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </div>
  );
}
