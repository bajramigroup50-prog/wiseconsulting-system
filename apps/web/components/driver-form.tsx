'use client';
/**
 * Driver phone flow of a travel order (legacy `pnEvent` / `pnGeo` / `pnSigInit` / `pnDeliv` 9405–9430):
 * every button records the time and the GPS position (asked when the form is sent, 8 s timeout — the event is saved
 * without a position when GPS is not allowed); a delivery can carry the receiver's signature (drawn on the screen)
 * and a photo (camera; scaled to 1024 px JPEG before upload, under the 1 MB server-action limit).
 */
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { FormState } from './bank-form';

function getGeo(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), 8000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); ok({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6) }); },
      () => { clearTimeout(t); ok(null); },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 7500 },
    );
  });
}

/** A form whose submit first adds `lat` / `lon` (and nothing else changes for the server action). */
export function DriverForm({ action, children, className, style }: {
  action: (prev: FormState, form: FormData) => Promise<FormState>; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const [st, run, pending] = useActionState<FormState, FormData>(action, {});
  const [locating, start] = useTransition();
  const [note, setNote] = useState('');
  return (
    <form className={className} style={style} aria-busy={pending || locating}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setNote('Се зема GPS локацијата…');
        start(async () => {
          const g = await getGeo();
          if (g) { fd.set('lat', String(g.lat)); fd.set('lon', String(g.lon)); }
          setNote(g ? '' : 'GPS не е достапен – забележано без локација.');
          start(() => run(fd));
        });
      }}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      {note && <div className="mini">{note}</div>}
      <fieldset disabled={pending || locating} style={{ display: 'contents' }}>{children}</fieldset>
    </form>
  );
}

/** Legacy `canvas.pnsig`: signature pad; the PNG data URL goes into the hidden field `name`. */
export function SignaturePad({ name, label = 'Потпис на примачот' }: { name: string; label?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [val, setVal] = useState('');
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
    let dr = false, lx = 0, ly = 0;
    const pt = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height] as const; };
    c.onpointerdown = (e) => { dr = true; try { c.setPointerCapture(e.pointerId); } catch { /* old browsers */ } [lx, ly] = pt(e); ctx.beginPath(); ctx.arc(lx, ly, 1.6, 0, 7); ctx.fill(); e.preventDefault(); };
    c.onpointermove = (e) => { if (!dr) return; const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke(); lx = x; ly = y; e.preventDefault(); };
    c.onpointerup = c.onpointercancel = c.onpointerleave = () => { if (!dr) return; dr = false; setVal(c.toDataURL('image/png')); };
  }, []);
  const clear = () => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#111';
    setVal('');
  };
  return (
    <div className="f wide">
      <span>{label}</span>
      <canvas ref={cv} width={600} height={180} style={{ width: '100%', maxWidth: 420, height: 126, border: '1px solid var(--line)', borderRadius: 6, touchAction: 'none', background: '#fff' }} />
      <input type="hidden" name={name} value={val} />
      <div><button type="button" className="btn sm ghost" onClick={clear}>Избриши потпис</button></div>
    </div>
  );
}

/** Camera photo (legacy `input[type=file][data-ph]`), scaled down in the browser; JPEG data URL in `name`. */
export function PhotoField({ name, label = '📷 Слика (испорака)' }: { name: string; label?: string }) {
  const [val, setVal] = useState('');
  const onFile = (f: File | undefined) => {
    if (!f) return setVal('');
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setVal(c.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  return (
    <label className="f">{val ? '📷 ✓ Сликано' : label}
      <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
      <input type="hidden" name={name} value={val} />
    </label>
  );
}
