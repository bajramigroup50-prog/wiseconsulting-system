/*
 * WISE service worker (installable app on Android / iPhone). Caches ONLY public static files:
 *   /_next/static/* (hashed build files), /icons/*, /forms/*, /manifest.webmanifest, /icon*, /apple-icon*.
 * Never cached: pages (HTML), /api/*, server actions (POST), files of clients (/api/files), anything with a cookie-
 * dependent answer. A page request without network gets a short built-in „Нема мрежа“ page (no data in it).
 * Same-origin GET only; every other request goes to the network untouched (the device guard and login still decide).
 */
const CACHE = 'wise-static-v1';
const MAX = 400;

const isStatic = (u) => u.origin === self.location.origin && (
  u.pathname.startsWith('/_next/static/') || u.pathname.startsWith('/icons/') || u.pathname.startsWith('/forms/')
  || u.pathname === '/manifest.webmanifest' || /^\/(icon|apple-icon)[^/]*$/.test(u.pathname));

const OFFLINE = '<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta name="theme-color" content="#0d5b4b"><title>Нема мрежа</title></head>'
  + '<body style="font-family:Segoe UI,Arial,sans-serif;margin:0;padding:32px 20px;color:#0d5b4b;text-align:center">'
  + '<div style="font-size:56px">📶</div><h2>Нема врска со интернет</h2>'
  + '<p style="color:#475467">Проверете ја мрежата и обидете се пак. Документите што ги фотографиравте се чуваат на телефонот и ќе се испратат штом има врска.</p>'
  + '<button onclick="location.reload()" style="font-size:18px;padding:14px 22px;border:0;border-radius:12px;background:#0d5b4b;color:#fff">↻ Обиди се пак</button>'
  + '</body></html>';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(c) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (r.mode === 'navigate') {
    // pages always from the network (never stored); offline → the built-in note
    e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
    return;
  }
  if (!isStatic(u) || u.search.includes('_rsc')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(r);
    if (hit) return hit;
    const res = await fetch(r);
    // only plain successful public answers (no redirects to the login, no opaque / private ones)
    if (res.ok && res.type === 'basic' && !/no-store|private/i.test(res.headers.get('Cache-Control') || '')) {
      e.waitUntil(c.put(r, res.clone()).then(() => trim(c)));
    }
    return res;
  })());
});
