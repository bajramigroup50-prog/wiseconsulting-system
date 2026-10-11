'use client';
/**
 * Extra ways to send the ticked documents, next to the server e-mail (legacy `dosMail` / `dosWa` / `zyMail` dialogs):
 * „Само нацрт во Gmail“ (Gmail compose with recipient, subject and text — attach the files there), „📤 Сподели ги
 * PDF-овите (WhatsApp, Viber…)“ (the phone's share sheet with the files; on a computer the ZIP downloads), the
 * recipient's phone for WhatsApp, and „Врати го стандардниот текст“. Reads the surrounding form when clicked.
 */
import { useRef, useState } from 'react';

export function SendExtras({ files, selName, defaultBody, zipHref }: {
  /** checkbox value → its files */
  files: Record<string, { id: string; name: string }[]>;
  /** name of the checkboxes in the form (`sel`, `docId`, …) */
  selName: string;
  defaultBody: string;
  /** ZIP of the selected documents (`?id=` appended per checkbox value), for computers without a share sheet */
  zipHref?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const form = () => ref.current?.closest('form') ?? null;
  const val = (n: string) => String((form()?.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '');
  const picked = () => {
    const f = form();
    return f ? [...f.querySelectorAll<HTMLInputElement>(`input[name="${selName}"]:checked`)].map((x) => x.value) : [];
  };
  const pickedFiles = () => picked().flatMap((k) => files[k] ?? []);
  const text = () => `${val('subject')}\n\n${val('body') || val('note')}`.trim();

  function draft() {
    const F = pickedFiles();
    const body = `${val('body') || val('note')}${F.length ? `\n\n(Прилози: ${F.map((x) => x.name).join(', ')})` : ''}`;
    const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(val('to'))}&su=${encodeURIComponent(val('subject'))}&body=${encodeURIComponent(body)}`;
    window.open(u, '_blank', 'noopener');
    setMsg(F.length ? `Нацртот е отворен во Gmail – прикачете ги ${F.length} датотеки (⬇ Преземи).` : 'Нацртот е отворен во Gmail.');
  }
  async function share() {
    const F = pickedFiles();
    if (!F.length) { setMsg('Штиклирајте барем еден документ.'); return; }
    setMsg('Се подготвуваат датотеките…');
    try {
      const blobs = await Promise.all(F.map(async (x) => { const r = await fetch(`/api/files/${x.id}`); if (!r.ok) throw new Error(x.name); return new File([await r.blob()], x.name, { type: r.headers.get('content-type') ?? 'application/octet-stream' }); }));
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: blobs })) { await nav.share({ files: blobs, text: text() }); setMsg('✓ Споделено.'); return; }
    } catch { /* fall back to the ZIP */ }
    if (zipHref) window.location.href = zipHref + (zipHref.includes('?') ? '&' : '?') + picked().map((k) => 'id=' + encodeURIComponent(k)).join('&');
    setMsg('На компјутер: ZIP се презема – прикачете го во WhatsApp / Viber со 📎.');
  }
  function wa() {
    const p = phone.replace(/\D/g, '').replace(/^0/, '389');
    if (phone && p.length < 8) { setMsg('Внесете валиден број.'); return; }
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text())}`, '_blank', 'noopener');
  }
  function reset() {
    const b = (form()?.elements.namedItem('body') ?? form()?.elements.namedItem('note')) as HTMLTextAreaElement | null;
    if (b) b.value = defaultBody;
  }
  return (
    <div ref={ref} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
      <button type="button" className="btn sm ghost" onClick={reset}>Врати го стандардниот текст</button>
      <button type="button" className="btn" onClick={draft}>Само нацрт во Gmail</button>
      <button type="button" className="btn" onClick={() => void share()} style={{ borderColor: '#25D366' }}>📤 Сподели ги PDF-овите (WhatsApp, Viber…)</button>
      <label className="f" style={{ margin: 0 }}>Телефон на примачот (на пр. 070123456)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" style={{ width: 170 }} /></label>
      <button type="button" className="btn" onClick={wa}>💬 WhatsApp</button>
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}
