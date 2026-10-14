'use client';
/** „🤖 Робот“ — floating button (bottom right) and side panel on every page of the office app (not on /robot itself). */
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RobotChat } from './robot-chat';

const EV = 'wc-robot';
export const robotToggle = () => window.dispatchEvent(new Event(EV));

export function RobotPanel() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener(EV, t);
    return () => window.removeEventListener(EV, t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (path === '/robot') return null;
  return (
    <>
      <style>{'@media print{#robotBtn,#robotPanel{display:none!important}}'}</style>
      {open && (
        <aside id="robotPanel" aria-label="WISE Робот" className="card" style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100vw', zIndex: 960, margin: 0, borderRadius: 0,
          boxShadow: '-10px 0 30px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', padding: 12,
        }}>
          <div className="hd" style={{ marginBottom: 6 }}>
            <b>🤖 WISE Робот</b>
            <button type="button" className="btn sm" onClick={() => setOpen(false)} aria-label="Затвори">✕</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}><RobotChat /></div>
        </aside>
      )}
      {!open && (
        <button type="button" id="robotBtn" className="btn pri" onClick={() => setOpen(true)} title="WISE Робот – прашајте за салда, ДДВ, рокови, закони…"
          style={{ position: 'fixed', right: 14, bottom: 70, zIndex: 900, borderRadius: 22, height: 44, padding: '0 14px', boxShadow: '0 6px 18px rgba(0,0,0,.18)' }}>
          🤖 Робот
        </button>
      )}
    </>
  );
}
