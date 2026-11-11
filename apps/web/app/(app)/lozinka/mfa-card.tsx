'use client';
/** 🔐 Хyрjа во 2 чекори: QR for Google / Microsoft Authenticator, confirm with a code, the recovery codes shown once. */
import { useActionState, useState, useTransition } from 'react';
import { mfaBeginAction, mfaConfirmAction, mfaOffAction, mfaRequiredAction, mfaResetAction, type MfaSetup } from './mfa-actions';

export function MfaCard({ on, at, codesLeft, must, admin, required, colleagues }: {
  on: boolean; at: string | null; codesLeft: number; must: boolean;
  admin: boolean; required: boolean; colleagues: { id: string; name: string; on: boolean }[];
}) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [busy, start] = useTransition();
  const [conf, confirm, cp] = useActionState(mfaConfirmAction, {});
  const [off, turnOff, op] = useActionState(mfaOffAction, {});
  const [msg, setMsg] = useState('');
  const done = conf.codes?.length ? conf : null;
  return (
    <div className="card" id="mfa">
      <h2>🔐 Најава во 2 чекори</h2>
      {must && !on && !done && <div className="callout bad">Канцеларијата бара најава во 2 чекори – вклучете ја сега (2 минути).</div>}
      <p className="note">По лозинката, програмата бара и 6-цифрен код од апликацијата на Вашиот телефон (Google Authenticator или Microsoft Authenticator). Така никој не може да влезе само со украдена лозинка.</p>

      {done ? (
        <div className="callout good">
          <b>✓ Вклучено.</b> Резервни кодови – запишете ги или испечатете ги и чувајте ги на сигурно место. Секој важи само еднаш, ако го изгубите телефонот. <b>Нема да се прикажат повторно.</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '6px 18px', fontFamily: 'monospace', fontSize: 16, margin: '10px 0' }}>
            {done.codes!.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button type="button" className="btn" onClick={() => window.print()}>🖨 Печати</button>
        </div>
      ) : on ? (
        <>
          <p><span className="pill good">✓ Вклучено</span>{at && <span className="mini"> од {new Date(at).toLocaleDateString('mk-MK')}</span>} · резервни кодови: <b>{codesLeft}</b></p>
          <details><summary className="mini">Исклучи (потребен е код од телефонот)</summary>
            <form action={turnOff} className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
              <input name="code" inputMode="numeric" placeholder="код" style={{ width: 130 }} required />
              <button className="btn" disabled={op}>Исклучи</button>
              {off.error && <span className="pill bad">{off.error}</span>}
            </form>
          </details>
        </>
      ) : setup?.qr ? (
        <form action={confirm}>
          <ol style={{ paddingLeft: 18, margin: '4px 0 8px' }}>
            <li>На телефонот инсталирајте <b>Google Authenticator</b> или <b>Microsoft Authenticator</b>.</li>
            <li>Во апликацијата: <b>+</b> → „Скенирај QR код“ и скенирајте го кодот подолу.</li>
            <li>Внесете го 6-цифрениот код што го покажува апликацијата.</li>
          </ol>
          <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR за апликацијата" style={{ width: 190, height: 190, imageRendering: 'pixelated', border: '6px solid #fff' }} />
            <div>
              <p className="mini">Не може да скенирате? Внесете го клучот рачно:<br /><code style={{ fontSize: 14 }}>{setup.secret}</code></p>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" required autoFocus style={{ width: 140, fontSize: 20, letterSpacing: '.2em', textAlign: 'center' }} />
                <button className="btn pri" disabled={cp}>{cp ? '…' : 'Потврди и вклучи'}</button>
              </div>
              {conf.error && <p className="pill bad" role="alert">{conf.error}</p>}
            </div>
          </div>
        </form>
      ) : (
        <button type="button" className="btn pri" disabled={busy} onClick={() => start(async () => setSetup(await mfaBeginAction()))}>🔐 Вклучи најава во 2 чекори</button>
      )}
      {setup?.error && <p className="pill bad">{setup.error}</p>}

      {admin && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Канцеларија (администратор)</h3>
          <label className="chk"><input type="checkbox" defaultChecked={required} style={{ width: 'auto' }}
            onChange={(e) => start(async () => { const r = await mfaRequiredAction(e.target.checked); setMsg(r.ok ?? r.error ?? ''); })} /> Задолжително за сите колеги (клиентите не)</label>
          <table className="dense" style={{ marginTop: 6 }}><tbody>
            {colleagues.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{c.on ? <span className="pill good">✓ вклучено</span> : <span className="pill warn">не</span>}</td>
                <td>{c.on && <button type="button" className="btn sm" disabled={busy} title="Изгубен телефон: исклучи, па нека го вклучи повторно"
                  onClick={() => { if (window.confirm(`Да се исклучи најавата во 2 чекори за ${c.name}?`)) start(async () => { const r = await mfaResetAction(c.id); setMsg(r.ok ?? r.error ?? ''); }); }}>Исклучи (изгубен телефон)</button>}</td></tr>
            ))}
          </tbody></table>
          {msg && <p className="mini">{msg}</p>}
        </div>
      )}
    </div>
  );
}
