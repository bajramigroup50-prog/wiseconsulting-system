'use client';
/**
 * Notification reminders — legacy `alStartup` (8582), `alPopup` (8587), `alSpeak` (8576), `alSettingsHTML` (8592) and the
 * daily e-mail. Settings are per browser (legacy `alLS`, keys `al_*`), as in legacy.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AlItem } from '@wise/core/firms/picker';
import { alertItems, mailAlerts } from '@/app/(app)/top-actions';
import { alLS, alSpeak } from './al-settings';

export { alLS, alSpeak, AlSettings, AlVoiceButton } from './al-settings';

const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });

/** Legacy `alStartup`: once a day — popup (or a short notice on busy screens), optional voice and e-mail. */
export function AlStartup() {
  const path = usePathname();
  const [pop, setPop] = useState<AlItem[] | null>(null);
  const [toast, setToast] = useState('');
  const [noPop, setNoPop] = useState(false);
  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      const td = todayStr();
      const wantPop = alLS.get('popup') !== 'off' && alLS.get('popDay') !== td;
      const to = alLS.get('mail');
      const wantMail = alLS.get('auto') === 'on' && !!to && alLS.get('mailDay') !== td;
      const wantVoice = alLS.get('voice') === 'on' && alLS.get('voiceDay') !== td;
      if (!wantPop && !wantMail && !wantVoice) return;
      let I: AlItem[] = [];
      try { I = await alertItems(); } catch { return; }
      if (off) return;
      const bad = I.filter((a) => a.lvl === 'bad').length, warn = I.filter((a) => a.lvl === 'warn').length;
      if (!bad && !warn) return;
      if (wantPop) {
        alLS.set('popDay', td);
        if (['/', '/firmi', '/izvestuvanja'].includes(window.location.pathname)) setPop(I);
        else { setToast(`🔔 ${bad} итни и ${warn} известувања за внимание – Фирми → Известувања`); setTimeout(() => setToast(''), 6000); }
      }
      if (wantMail && to) {
        const r = await mailAlerts(to, true);
        if (r.ok) { alLS.set('mailDay', td); setToast('🔔 Известувањата се испратени на ' + to); setTimeout(() => setToast(''), 6000); }
      }
      if (wantVoice) { alLS.set('voiceDay', td); setTimeout(() => alSpeak(I), 800); }
    }, 2500);
    return () => { off = true; clearTimeout(t); };
  }, []);
  useEffect(() => { if (path === '/izvestuvanja') setPop(null); }, [path]);
  const bad = pop?.filter((a) => a.lvl === 'bad') ?? [], warn = pop?.filter((a) => a.lvl === 'warn') ?? [];
  return (
    <>
      {toast && <div className="toast" role="status" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 950 }}>{toast}</div>}
      {pop && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
          <div className="card" style={{ maxWidth: 680, width: '100%' }}>
            <div className="hd"><h2>🔔 Потсетник: {bad.length} итни · {warn.length} за внимание</h2><button type="button" className="btn" onClick={() => setPop(null)}>Затвори</button></div>
            <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
              {[...bad, ...warn].slice(0, 25).map((a, i) => (
                <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}><span className={`pill ${a.lvl}`}>{a.lvl === 'bad' ? '🔴' : '🟠'}</span> <b>{a.firm}</b> – {a.txt}</div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Link className="btn pri" href="/izvestuvanja" onClick={() => setPop(null)}>Отвори ги сите</Link>
              <button type="button" className="btn" onClick={() => { const m = alSpeak(pop); if (m) alert(m); }}>🔊 Прочитај на глас</button>
              <span style={{ flex: 1 }} />
              <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={noPop} onChange={(e) => { setNoPop(e.target.checked); alLS.set('popup', e.target.checked ? 'off' : 'on'); }} /> не прикажувај при отворање</label>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
