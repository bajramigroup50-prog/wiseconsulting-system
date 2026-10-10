'use client';
/**
 * Legacy `pnLiveStart` / `pnLiveStop` (9439): while the driver's „Мои патни налози“ page is open and an order is on
 * the road, the phone's position is sent every ~40 s or 150 m (screen kept awake when the browser allows it).
 */
import { useEffect, useRef, useState } from 'react';
import { shouldSendPosition } from '@wise/core/industry';
import { pushPositionAction } from '@/app/(app)/pnLive/actions';

export function LiveTracker({ orderIds }: { orderIds: string[] }) {
  const [txt, setTxt] = useState('📡 Се вклучува праќањето на локацијата во живо…');
  const last = useRef<{ t: number; p: { lat: number; lon: number } } | null>(null);
  const key = orderIds.join(',');
  useEffect(() => {
    if (!orderIds.length) return;
    if (!navigator.geolocation) { setTxt('⚠ Овој уред нема GPS.'); return; }
    let wake: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {});
    const id = navigator.geolocation.watchPosition(async (p) => {
      const pos = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), spd: p.coords.speed != null ? Math.round(p.coords.speed * 3.6) : null, at: new Date().toISOString() };
      if (!shouldSendPosition(last.current, pos, Date.now())) return;
      last.current = { t: Date.now(), p: pos };
      const r = await pushPositionAction(orderIds, pos).catch(() => ({ error: 'мрежа' }));
      setTxt(r.error ? `⚠ Локацијата не е испратена (${r.error}).` : `📡 Локацијата се праќа во живо · ${pos.at.slice(11, 19)} · ±${pos.acc} м`);
    }, () => setTxt('⚠ GPS не е достапен – дозволете „Локација“ за прелистувачот.'), { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    return () => { navigator.geolocation.clearWatch(id); wake?.release().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!orderIds.length) return null;
  return <div className="callout" role="status">{txt}</div>;
}
