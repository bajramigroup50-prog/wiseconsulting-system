'use client';
/** 🎭 The owner's demo card (Корисници): demo firms + login, reset, demo links, demo AI / nightly reset. */
import { useActionState, useEffect, useState } from 'react';
import { DEMO_LINK_DAYS, DEMO_MAX_FIRMS, type DemoSettings } from '@wise/core/demo';
import { RowAction } from '@/components/row-action';
import {
  createDemoAction, demoPasswordAction, demoSettingsAction, newDemoLinkAction, resetDemoAction, revokeDemoLinkAction, type DemoState,
} from './demo-actions';

export interface DemoLinkRow { id: string; note: string | null; createdAt: string; expiresAt: string; lastUsedAt: string | null; uses: number; revoked: boolean; expired: boolean }

const dt = (s: string | null) => (s ? new Date(s).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function Result({ st }: { st: DemoState }) {
  if (st.error) return <div className="callout bad" role="alert">{st.error}</div>;
  if (!st.ok) return null;
  return (
    <div className="callout good" role="status">
      {st.ok}
      {st.password && <div style={{ marginTop: 6 }}>Лозинка: <code data-testid="demo-password" style={{ fontSize: 16, userSelect: 'all' }}>{st.password}</code> <span className="mini">– запишете ја, не се прикажува повторно.</span></div>}
      {st.link && <div style={{ marginTop: 6, wordBreak: 'break-all' }}><code data-testid="demo-link" style={{ userSelect: 'all' }}>{st.link}</code></div>}
    </div>
  );
}

export function DemoPanel({ firms, total = firms.length, created = 0, hasLogin, links, settings }: { firms: string[]; total?: number; created?: number; hasLogin: boolean; links: DemoLinkRow[]; settings: DemoSettings }) {
  const [c, create, cp] = useActionState(createDemoAction, {});
  const [r, reset, rp] = useActionState(resetDemoAction, {});
  const [p, pass, pp] = useActionState(demoPasswordAction, {});
  const [l, link, lp] = useActionState(newDemoLinkAction, {});
  const [s, save, sp] = useActionState(demoSettingsAction, {});
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return (
    <div className="card" id="demo" style={{ borderColor: '#facc15' }}>
      <h2>🎭 Демо за презентација</h2>
      <p className="note">Демо корисникот гледа само ДЕМО фирми (измислени податоци), без пошта, УЈП, фискален апарат, резервни копии и (освен ако дозволите) AI. Вистинските фирми и колеги никогаш не се гледаат.</p>
      <p>Демо фирми: {firms.length ? firms.join(' · ') : <span className="mut">нема</span>}</p>
      {total > 0 && <p className="callout warn" data-testid="demo-count">Демо фирми: <b>{total} / {DEMO_MAX_FIRMS}</b>{created > 0 && <> · од нив <b>{created}</b> ги креирал демо корисникот</>}. Фирмите што ги креира демо корисникот („ДЕМО – …“) се бришат при ресетирање на демото (рачно или ноќно).</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!firms.length && <form action={create}><button className="btn pri" disabled={cp}>{cp ? 'Се креира…' : '🎭 Креирај демо фирми'}</button></form>}
        {firms.length > 0 && <form action={reset} onSubmit={(e) => { if (!window.confirm('Да се избришат демо фирмите (само оние со ознака ДЕМО) и да се креираат одново?')) e.preventDefault(); }}>
          <button className="btn" disabled={rp}>{rp ? 'Се ресетира…' : '↺ Ресетирај демо'}</button></form>}
        {hasLogin && <form action={pass}><button className="btn" disabled={pp}>🔑 Нова лозинка за „demo“</button></form>}
      </div>
      <Result st={c} /><Result st={r} /><Result st={p} />

      <h3 style={{ margin: '14px 0 6px' }}>🔗 Демо линкови (без корисничко име и лозинка)</h3>
      <form action={link} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <input type="hidden" name="origin" value={origin} />
        <label className="f">Важи<select name="days" defaultValue="7">{DEMO_LINK_DAYS.map((d) => <option key={d} value={d}>{d} {d === 1 ? 'ден' : 'дена'}</option>)}</select></label>
        <label className="f" style={{ flex: 1, minWidth: 200 }}>Белешка (на пр. купувач)<input name="note" maxLength={200} /></label>
        <button className="btn pri" disabled={lp || !hasLogin}>🔗 Нов демо линк</button>
      </form>
      <Result st={l} />
      {links.length > 0 && <div className="tw"><table className="dense">
        <thead><tr><th>Белешка</th><th>Креиран</th><th>Важи до</th><th>Последно отворен</th><th>Отворања</th><th></th></tr></thead>
        <tbody>{links.map((x) => <tr key={x.id}>
          <td>{x.note ?? '—'}</td><td>{dt(x.createdAt)}</td><td>{dt(x.expiresAt)}</td><td>{dt(x.lastUsedAt)}</td><td>{x.uses}</td>
          <td>{x.revoked ? <span className="pill">откажан</span> : x.expired ? <span className="pill">истечен</span>
            : <RowAction action={revokeDemoLinkAction.bind(null, x.id)} label="✕ Откажи" confirm="Да се откаже линкот? Отворените сесии веднаш завршуваат." />}</td>
        </tr>)}</tbody>
      </table></div>}

      <h3 style={{ margin: '14px 0 6px' }}>Поставки</h3>
      <form action={save} className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted">AI во демо: секогаш исклучено (не троши буџет)</span>
        <label className="chk"><input type="checkbox" name="nightly" defaultChecked={settings.nightly} style={{ width: 'auto' }} /> Ресетирај го демото секоја ноќ во 03:30</label>
        <button className="btn" disabled={sp}>Зачувај</button>
      </form>
      <Result st={s} />
    </div>
  );
}
