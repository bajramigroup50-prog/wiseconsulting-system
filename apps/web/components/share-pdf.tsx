'use client';
/**
 * „📤 Испрати“ next to „⬇ PDF“ in every print bar: the print area is rendered to PDF on the server and handed to
 * the system share sheet (WhatsApp, Viber, Outlook / Mail, Teams…) as a file. Where the browser cannot share files,
 * the PDF downloads and WhatsApp Web / the e-mail program opens with a short message — attach the downloaded file.
 */
import { useState } from 'react';

async function renderPdf(selector: string, title: string): Promise<File> {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error('Нема што да се испрати.');
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.noprint,script').forEach((x) => x.remove());
  const html = c.id === 'printArea' ? c.outerHTML : `<div id="printArea" style="display:block">${c.outerHTML}</div>`;
  let css = '';
  for (const s of Array.from(document.styleSheets)) {
    try { for (const r of Array.from(s.cssRules)) css += r.cssText + '\n'; } catch { /* cross-origin sheet */ }
  }
  const landscape = !!el.querySelector('.pdfdoc.land');
  const r = await fetch('/api/pdf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, css, title, landscape }) });
  const j = await r.json().catch(() => ({})) as { id?: string; error?: string };
  if (!r.ok || !j.id) throw new Error(j.error || 'PDF не може да се подготви.');
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, i < 5 ? 1000 : 2000));
    const x = await fetch('/api/files/' + j.id, { cache: 'no-store' });
    if (x.ok) return new File([await x.blob()], (title || 'dokument').replace(/[\/:*?"<>|]+/g, ' ').trim() + '.pdf', { type: 'application/pdf' });
    if (x.status !== 404) break;
  }
  throw new Error('PDF не е подготвен (серверот за PDF не одговара). Обидете се повторно.');
}

function download(f: File) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function SharePdf({ selector = '#printArea', title }: { selector?: string; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async (via: 'share' | 'mail' | 'wa') => {
    setBusy(true); setMsg('');
    try {
      const t = title || document.title;
      const f = await renderPdf(selector, t);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (via === 'share' && nav.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title: t, text: t });
        return;
      }
      download(f);
      const text = `${t} – во прилог (PDF).`;
      if (via === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      else window.location.href = `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(text + '\n\n')}`;
      setMsg(`PDF-от „${f.name}“ е преземен – прикачете го во ${via === 'wa' ? 'WhatsApp (📎)' : 'пораката'}.`);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setMsg((e as Error)?.message || 'Не успеа.');
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => void go('share')} title="WhatsApp, Viber, е-пошта… (PDF како прилог)">{busy ? 'Се подготвува…' : '📤 Испрати'}</button>
      <button type="button" className="btn" disabled={busy} onClick={() => void go('mail')}>✉ Е-пошта</button>
      <button type="button" className="btn" disabled={busy} onClick={() => void go('wa')} style={{ borderColor: '#25D366' }}>💬 WhatsApp</button>
      {msg && <span className="mini" style={{ alignSelf: 'center' }}>{msg}</span>}
    </>
  );
}
