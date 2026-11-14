'use client';
/**
 * Installable app (PWA): registers `/sw.js` (static files only, public/sw.js) and, on a phone / tablet that has not
 * installed the app yet, shows „📲 Додај на почетен екран“ — Android / Chrome: the browser's install dialog
 * (`beforeinstallprompt`); iPhone / iPad Safari: the two taps (Сподели ⎋ → „Add to Home Screen“).
 * „Не сега“ hides it for 30 days (this browser only). Not shown in the WISE desktop app or when already installed.
 */
import { useEffect, useState } from 'react';

interface BIP extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = 'wise-pwa-hint';
const DAYS30 = 30 * 864e5;

export function PwaSetup() {
  const [ev, setEv] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Electron/i.test(ua)) return;
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* not supported / blocked */ });
    }
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const touch = matchMedia('(pointer: coarse)').matches;
    let snoozed = false;
    try { snoozed = Date.now() - Number(localStorage.getItem(KEY) || 0) < DAYS30; } catch { /* no storage */ }
    if (standalone || !touch || snoozed) return;
    const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (isIos) { setIos(true); setShow(true); return; }
    const on = (e: Event) => { e.preventDefault(); setEv(e as BIP); setShow(true); };
    const done = () => setShow(false);
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done); };
  }, []);

  if (!show) return null;
  const later = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* no storage */ } setShow(false); };
  return (
    <div className="pwa-hint noprint" role="status">
      <span className="pwa-i" aria-hidden="true">📲</span>
      <div className="pwa-t">
        <b>Додај на почетен екран</b>
        {ios ? <small>Допрете <b>Сподели</b> ⎋ долу, па <b>„Add to Home Screen“ / „Додај на почетен екран“</b>.</small>
          : <small>WISE како апликација на телефонот – отвора се со еден допир.</small>}
      </div>
      {!ios && ev && (
        <button type="button" className="btn pri" onClick={async () => { await ev.prompt(); const c = await ev.userChoice.catch(() => null); if (c?.outcome !== 'accepted') later(); else setShow(false); setEv(null); }}>Инсталирај</button>
      )}
      <button type="button" className="btn ghost" onClick={later} aria-label="Не сега">Не сега</button>
    </div>
  );
}
