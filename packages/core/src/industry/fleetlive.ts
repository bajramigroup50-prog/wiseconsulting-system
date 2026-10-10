/**
 * Vehicles live (legacy `pnLiveStart` / `pnDist` / `pnAgo` / `pnTrackSVG` / `VIEWS.pnLive` 9440–9462): the driver's
 * phone sends its position while a travel order is on the road; the office sees the last position and the track.
 */
export interface GeoPos { lat: number; lon: number; acc?: number | null; spd?: number | null; at: string }

/** Legacy `pnDist`: metres between two points (haversine). */
export function geoDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Legacy throttle: a new point is stored when ≥ 40 s or ≥ 150 m passed since the last one. */
export const LIVE_MIN_SECONDS = 40;
export const LIVE_MIN_METRES = 150;
export const LIVE_MAX_POINTS = 400;
export function shouldSendPosition(last: { t: number; p: { lat: number; lon: number } } | null | undefined, pos: { lat: number; lon: number }, now: number): boolean {
  if (!last) return true;
  return (now - last.t) / 1000 >= LIVE_MIN_SECONDS || geoDistance(last.p, pos) >= LIVE_MIN_METRES;
}

/** Valid WGS84 coordinates (rejects 0/0 and out of range). */
export const validGeo = (lat: unknown, lon: unknown): boolean => {
  const a = Number(lat), o = Number(lon);
  return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && !(a === 0 && o === 0);
};

/** Legacy `pnAgo`. */
export function agoText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - Date.parse(iso)) / 1000);
  return s < 60 ? `пред ${s} сек` : s < 3600 ? `пред ${Math.round(s / 60)} мин` : `пред ${Math.round(s / 3600)} ч`;
}
/** Legacy: a position older than 10 minutes is shown in red. */
export const stalePosition = (iso: string | null | undefined, now = Date.now()): boolean => !!iso && now - Date.parse(iso) > 10 * 60000;

export const mapsUrl = (p: { lat: number; lon: number }) => `https://www.google.com/maps?q=${p.lat},${p.lon}`;

/**
 * Legacy `pnTrackSVG` projection: track points and event markers into a W×H box (equirectangular, longitude scaled by
 * cos(latitude), 20 px margin, centred). Returns the projected polyline, markers and current point.
 */
export function trackProjection<E extends { lat: number; lon: number }>(track: readonly { lat: number; lon: number }[], events: readonly E[], cur: { lat: number; lon: number } | null, W = 640, H = 300) {
  const P = [...track, ...events, ...(cur ? [cur] : [])];
  if (!P.length) return null;
  const pad = 0.002;
  const la0 = Math.min(...P.map((p) => p.lat)) - pad, la1 = Math.max(...P.map((p) => p.lat)) + pad;
  const lo0 = Math.min(...P.map((p) => p.lon)) - pad, lo1 = Math.max(...P.map((p) => p.lon)) + pad;
  const k = Math.cos((((la0 + la1) / 2) * Math.PI) / 180);
  const sx = (lo1 - lo0) * k, sy = la1 - la0;
  const sc = Math.min((W - 40) / sx, (H - 40) / sy);
  const X = (lo: number) => 20 + (lo - lo0) * k * sc + (W - 40 - sx * sc) / 2;
  const Y = (la: number) => 20 + (la1 - la) * sc + (H - 40 - sy * sc) / 2;
  const pt = (p: { lat: number; lon: number }) => ({ x: Math.round(X(p.lon) * 10) / 10, y: Math.round(Y(p.lat) * 10) / 10 });
  return { line: track.map(pt), marks: events.map((e) => ({ ...e, ...pt(e) })), cur: cur ? pt(cur) : null, W, H };
}
