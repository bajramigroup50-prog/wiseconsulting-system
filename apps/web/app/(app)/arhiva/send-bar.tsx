'use client';
/**
 * „Избрани документи“ in the archive: the rows ticked in the `data-arsel` checkboxes (their file ids) — „⬇ Преземи (ZIP)“,
 * „🖨 Печати (архивски примерок)“, „✉ Gmail“ (compose opens, the ZIP downloads to attach), „💬 WhatsApp / Viber“ (the
 * message with the list, the ZIP downloads).
 */
import { useEffect, useState } from 'react';

const picked = () => [...document.querySelectorAll<HTMLInputElement>('input[data-arsel]:checked')];

export function ArSendBar({ firm }: { firm: string }) {
  const [n, setN] = useState(0);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const f = () => setN(picked().length);
    document.addEventListener('change', f);
    return () => document.removeEventListener('change', f);
  }, []);
  const ids = () => picked().map((x) => x.value).join(',');
  const names = () => picked().map((x) => x.dataset.arsel ?? '').filter(Boolean);
  const qs = () => 'f=' + encodeURIComponent(ids());
  const need = () => { if (!n) { setMsg('Штиклирајте документи (кутичката лево).'); return false; } setMsg(''); return true; };
  const zip = () => { if (need()) window.location.href = '/arhiva/zip?' + qs(); };
  const print = () => { if (need()) window.open('/print/arhiva?' + qs(), '_blank', 'noopener'); };
  const text = () => `Почитувани,\n\nВо прилог Ви ги доставуваме документите (архивски примерок):\n${names().map((x) => '• ' + x).join('\n')}\n\n${firm}`;
  const gmail = () => {
    if (!need()) return;
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent('Документи – ' + firm)}&body=${encodeURIComponent(text())}`, '_blank', 'noopener');
    window.location.href = '/arhiva/zip?' + qs();
    setMsg('Gmail е отворен – прикачете го преземениот ZIP и испратете.');
  };
  const wa = () => {
    if (!need()) return;
    window.open('https://wa.me/?text=' + encodeURIComponent(text()), '_blank', 'noopener');
    window.location.href = '/arhiva/zip?' + qs();
    setMsg('WhatsApp е отворен – прикачете го преземениот ZIP со 📎.');
  };
  const all = (on: boolean) => { for (const x of document.querySelectorAll<HTMLInputElement>('input[data-arsel]')) x.checked = on; setN(on ? document.querySelectorAll('input[data-arsel]').length : 0); };
  return (
    <div className="card noprint" style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>Избрани: {n}</b>
      <button type="button" className="btn sm ghost" onClick={() => all(true)}>☑ сите</button>
      <button type="button" className="btn sm ghost" onClick={() => all(false)}>☐ ниеден</button>
      <button type="button" className="btn" onClick={zip}>⬇ Преземи (ZIP)</button>
      <button type="button" className="btn" onClick={print}>🖨 Печати – архивски примерок</button>
      <input type="email" placeholder="е-пошта на примачот" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 220 }} />
      <button type="button" className="btn" onClick={gmail}>✉ Gmail</button>
      <button type="button" className="btn" style={{ borderColor: '#25D366' }} onClick={wa}>💬 WhatsApp / Viber</button>
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}
