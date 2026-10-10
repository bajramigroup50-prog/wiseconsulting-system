'use client';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { klCredHtml } from '@wise/core/firms/klprofili';
import { UploadField } from '@/components/upload-field';
import { saveResh, startRead, type ReshResult } from './actions';

export function StartForm() {
  const [st, run, busy] = useActionState<ReshResult, FormData>(startRead, {});
  return (
    <form className="card" action={run}>
      {st.error && <div className="callout bad">{st.error}</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <UploadField firmId={null} capture accept=".pdf,image/*" label="📷 Скенирај / 📎 прикачи PDF или слики" />
        <button className="btn pri" disabled={busy}>{busy ? 'Се праќа…' : '🔍 Прочитај го решението'}</button>
      </div>
      <p className="note" style={{ margin: '6px 0 0' }}>Секоја страна се додава посебно; по внесувањето страните се зачувуваат во досието на новата фирма. Без AI – пополнете ги полињата подолу рачно.</p>
    </form>
  );
}

/** Polls while the worker reads (legacy showed progress in the page). */
export function Poll({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => { if (!active) return; const t = setInterval(() => router.refresh(), 3000); return () => clearInterval(t); }, [active, router]);
  return null;
}

export function ReviewForm({ children, readId, exId }: { children: React.ReactNode; readId: string; exId: string }) {
  const [st, run, busy] = useActionState<ReshResult, FormData>(saveResh, {});
  if (st.ok) {
    return (
      <div className="callout good">
        <b>Готово</b>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{st.log?.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {!!st.creds?.length && <p className="mini">Почетна лозинка за <b>{st.creds[0]!.username}</b>: <code>{st.creds[0]!.password}</code> (се прикажува само сега) <button type="button" className="btn sm" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:12mm">${klCredHtml(st.creds!, new Date().toLocaleDateString('mk-MK'))}<script>setTimeout(()=>print(),300)</script>`); w.document.close(); } }}>🖨 Печати</button></p>}
        <div className="row" style={{ gap: 8, marginTop: 8 }}><a className="btn" href={`/firmi?edit=${st.firmId}`}>Отвори го профилот на фирмата</a><a className="btn" href="/firmiResh">+ Следна фирма</a></div>
      </div>
    );
  }
  return (
    <form className="card" style={{ borderColor: 'var(--accent)' }} action={run}>
      {st.error && <div className="callout bad">{st.error}</div>}
      <input type="hidden" name="readId" value={readId} />
      <input type="hidden" name="ex" value={exId} />
      {children}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn pri" disabled={busy}>{busy ? 'Се внесува…' : exId ? 'Дополни постоечка + решение во досие' : '✓ Внеси ја фирмата'}</button>
      </div>
    </form>
  );
}
