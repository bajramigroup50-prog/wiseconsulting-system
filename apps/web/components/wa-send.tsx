'use client';
/**
 * 💬 The WhatsApp send controls shared by every screen. When the owner switched the Cloud API on (💬 WhatsApp), a
 * „💬 Испрати од WISE“ button sends the text and the PDF(s) straight from WISE (`lib/whatsapp.ts` `waSendAction`):
 * inside the client's 24-hour window as free text + document, outside it with the approved template of the purpose.
 * When it is off nothing changes: the old wa.me / Viber links stay the only way.
 */
import { useEffect, useState, useTransition } from 'react';
import type { WaPurpose, WaVar } from '@wise/core/whatsapp/wa';
import { waApiOn, waSendAction } from '@/lib/whatsapp';

let onP: Promise<boolean> | null = null;
/** Is the API on? (asked once per page load) */
export function useWaApi(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    (onP ??= waApiOn().catch(() => false)).then((x) => { if (live) setOn(x); });
    return () => { live = false; };
  }, []);
  return on;
}

/**
 * The print area rendered to PDF on the server (`/api/pdf` → `pdf.render`) and stored; resolves with the file id
 * once the worker stored it (the same flow as „⬇ PDF“ / „📤 Испрати“).
 */
export async function pdfFileId(selector: string, title: string): Promise<string> {
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
    const x = await fetch('/api/files/' + j.id, { cache: 'no-store', redirect: 'manual' });
    if (x.type === 'opaqueredirect' || x.ok) return j.id;
    if (x.status !== 404) break;
  }
  throw new Error('PDF не е подготвен (серверот за PDF не одговара). Обидете се повторно.');
}

export interface WaSendProps {
  phone?: string; text?: string; firmId?: string | null; purpose?: WaPurpose;
  vars?: Partial<Record<WaVar, string | number | null>>;
  /** the files to attach, asked when „Испрати“ is clicked (a PDF rendered then, the ticked rows…) */
  files?: () => Promise<string[]> | string[];
  /** the phone / text come from the surrounding controls */
  hidePhone?: boolean; hideText?: boolean;
  /** the text read when „Испрати“ is clicked (with `hideText`: the surrounding form's message) */
  getText?: () => string;
  /** called after a successful send (e.g. „✓ Испратено – запамети“ of the опомени) */
  onSent?: () => void;
  label?: string;
}

/** A compact form: phone, message, „💬 Испрати од WISE“. Renders nothing while the API is off. */
export function WaSendBox(p: WaSendProps) {
  const on = useWaApi();
  const [phone, setPhone] = useState(p.phone ?? '');
  const [text, setText] = useState(p.text ?? '');
  useEffect(() => { if (p.text != null) setText(p.text); }, [p.text]);
  useEffect(() => { if (p.phone != null) setPhone(p.phone); }, [p.phone]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, start] = useTransition();
  if (!on) return null;
  const go = () => start(async () => {
    setMsg({});
    try {
      const fileIds = p.files ? await p.files() : [];
      const r = await waSendAction({ phone, text: p.getText ? p.getText() : p.hideText ? p.text : text, fileIds, firmId: p.firmId ?? null, purpose: p.purpose, vars: { ...p.vars } });
      if ('ok' in r) { setMsg({ ok: r.ok }); p.onSent?.(); } else setMsg({ error: r.error });
    } catch (e) { setMsg({ error: (e as Error)?.message || 'Не успеа.' }); }
  });
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end', padding: '6px 0' }}>
      {!p.hidePhone && <label className="f" style={{ margin: 0 }}>Телефон (WhatsApp)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="070 123 456" style={{ width: 170 }} /></label>}
      {!p.hideText && <label className="f" style={{ margin: 0, flex: '1 1 260px' }}>Порака<textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></label>}
      <button type="button" className="btn pri" disabled={busy} onClick={go} style={{ background: '#25D366', borderColor: '#25D366' }}>{busy ? 'Се праќа…' : p.label ?? '💬 Испрати од WISE'}</button>
      {msg.ok && <span className="pill good">{msg.ok}</span>}
      {msg.error && <span className="callout bad" style={{ margin: 0, padding: '4px 8px' }}>{msg.error}</span>}
    </div>
  );
}

/**
 * One button in a table row: sends directly when the API is on, else the given wa.me link (unchanged behaviour).
 */
export function WaQuick({ href, phone, text, firmId, purpose, vars, files, label = 'WhatsApp', className = 'btn sm', confirm, onSent }: WaSendProps & {
  /** the old wa.me link while the API is off; '' = show nothing then (a screen that had no link before) */
  href: string; className?: string; confirm?: string;
}) {
  const on = useWaApi();
  const [busy, start] = useTransition();
  const [res, setRes] = useState('');
  if (!on && !href) return null;
  if (!on) return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
  return (
    <>
      <button type="button" className={className} disabled={busy || res.startsWith('✓')} title="Испрати директно од WISE (WhatsApp Business)" style={{ borderColor: '#25D366' }}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            try {
              const r = await waSendAction({ phone: phone ?? '', text, firmId: firmId ?? null, purpose, vars: { ...vars }, fileIds: files ? await files() : [] });
              setRes('ok' in r ? '✓' : r.error);
              if ('ok' in r) onSent?.();
            } catch (e) { setRes((e as Error).message); }
          });
        }}>{busy ? '…' : res === '✓' ? '✓ ' + label : '💬 ' + label}</button>
      {res && res !== '✓' && <span className="mini" style={{ color: 'var(--bad, #b00)' }}> {res}</span>}
    </>
  );
}
