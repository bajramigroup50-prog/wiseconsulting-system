'use client';
/**
 * Driver phone helpers of the travel order (legacy 9369–9422):
 * - {@link CashFill}: „💰 Наплатено во готово“ with the „= долг“ quick-fill button (`pnCashAll`);
 * - {@link TravelScan}: „📷 Товарење со скенирање“ (`pnScanHTML`, `pnScanInit`, `pnScanLoop`, `pnScanCode`,
 *   `pnScanFull`): the camera reads EAN-13 / EAN-8 / Code 128 / UPC-A / UPC-E / Code 39 with the browser's
 *   BarcodeDetector (Chrome on Android), a USB / Bluetooth scanner or typing + Enter works everywhere; each scan adds
 *   1 to the matching good of an open stop, a beep confirms, the loaded quantities are saved automatically.
 */
import { useEffect, useRef, useState } from 'react';
import { saveTravelScanAction } from '@/app/(app)/pnalozi/actions';

export function CashFill({ open }: { open: number }) {
  const [v, setV] = useState('');
  return (
    <>
      <label className="f">💰 Наплатено во готово (ден.)<input name="cash" type="number" step="any" inputMode="decimal" style={{ width: 150 }} placeholder="0" value={v} onChange={(e) => setV(e.target.value)} /></label>
      {open > 0 && <button type="button" className="btn sm" onClick={() => setV(String(open))}>= {open.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</button>}
    </>
  );
}

export interface ScanGood { i: number; k: number; name: string; partner: string; qty: number; lq: number; loaded: boolean; codes: string[]; done: boolean }

function beep(ok: boolean) {
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new C(); const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = ok ? 1200 : 300; o.connect(g); g.connect(a.destination); g.gain.value = 0.15;
    o.start(); o.stop(a.currentTime + (ok ? 0.12 : 0.35)); setTimeout(() => a.close(), 600);
  } catch { /* no audio */ }
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export function TravelScan({ id, goods }: { id: string; goods: ScanGood[] }) {
  const [open, setOpen] = useState(false);
  const [G, setG] = useState(goods);
  const [msg, setMsg] = useState('');
  const [cam, setCam] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef({ c: '', t: 0 });
  const gRef = useRef(G);
  gRef.current = G;

  const save = (L: ScanGood[], ms = 1500) => {
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      const r = await saveTravelScanAction(id, L.map((g) => ({ i: g.i, k: g.k, lq: g.lq })));
      if (r.error) setMsg(r.error);
    }, ms);
  };
  const scan = (code: string) => {
    const c = code.trim();
    if (!c) return;
    let full: ScanGood | null = null;
    const L = gRef.current;
    const hit = L.find((g) => { if (g.done || !g.codes.includes(c)) return false; if (g.loaded) { full = g; return false; } return true; });
    if (!hit) { beep(false); setMsg(full ? `„${(full as ScanGood).name}“ е веќе целосно натоварено.` : `Баркодот ${c} не е во овој налог!`); return; }
    const N = L.map((g) => { if (g !== hit) return g; const lq = g.lq + 1; return lq >= g.qty ? { ...g, lq: g.qty, loaded: true } : { ...g, lq }; });
    beep(true); setMsg(''); setG(N); save(N);
  };
  const fullOf = (g0: ScanGood) => { const N = gRef.current.map((g) => (g === g0 ? { ...g, lq: g.qty, loaded: true } : g)); setG(N); save(N, 800); };

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null, stop = false;
    const W = window as unknown as { BarcodeDetector?: new (o?: { formats: string[] }) => Detector };
    if (!W.BarcodeDetector) { setMsg('Камерата на овој прелистувач не чита баркодови (на пр. iPhone/Safari) – користете скенер или внесете го бројот. На Android користете Chrome.'); setTimeout(() => inp.current?.focus(), 80); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setMsg('Нема пристап до камера.'); return; }
    let det: Detector;
    try { det = new W.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'code_39'] }); } catch { det = new W.BarcodeDetector(); }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((st) => {
      if (stop) { st.getTracks().forEach((t) => t.stop()); return; }
      stream = st; setCam(true);
      const v = vid.current!; v.srcObject = st; v.play().catch(() => undefined);
      const loop = () => {
        if (stop) return;
        if (v.readyState < 2) { setTimeout(loop, 280); return; }
        det.detect(v).then((R) => {
          const c = R?.[0]?.rawValue;
          if (c) { const now = Date.now(); if (!(last.current.c === c && now - last.current.t < 1500)) scan(c); last.current = { c, t: now }; }
          setTimeout(loop, 280);
        }).catch(() => setTimeout(loop, 280));
      };
      loop();
    }).catch(() => setMsg('Камерата не е дозволена – дозволете „Камера“ или користете скенер.'));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); setCam(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!G.length) return null;
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>📷 Товари со скенирање</button>;
  const done = G.filter((g) => g.loaded).length;
  return (
    <div className="card" style={{ border: '2px solid var(--accent)', width: '100%' }}>
      <div className="hd"><b>📷 Товарење со скенирање · {done}/{G.length}</b><button type="button" className="btn sm" onClick={async () => {
        if (saveT.current) clearTimeout(saveT.current);
        await saveTravelScanAction(id, gRef.current.map((g) => ({ i: g.i, k: g.k, lq: g.lq })));
        setOpen(false);
      }}>Затвори</button></div>
      <video ref={vid} playsInline muted style={{ width: '100%', maxHeight: 230, background: '#000', borderRadius: 6, display: cam ? undefined : 'none' }} />
      <div className="mini">{msg}</div>
      <input ref={inp} placeholder="Скенирај со USB/Bluetooth скенер или внеси баркод + Enter" inputMode="numeric" style={{ margin: '6px 0' }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.currentTarget.value; e.currentTarget.value = ''; scan(v); } }} />
      <div>{G.map((g) => (
        <div key={`${g.i}:${g.k}`} className="row mini" style={{ gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ flex: 1 }}>{g.loaded ? '✅' : '⬜'} {g.name} <span style={{ color: 'var(--muted)' }}>· {g.partner}</span></span>
          <b>{g.lq || (g.loaded ? g.qty : 0)}/{g.qty}</b>
          {!g.loaded && !g.done && <button type="button" className="btn sm" onClick={() => fullOf(g)}>сите</button>}
        </div>))}</div>
    </div>
  );
}
