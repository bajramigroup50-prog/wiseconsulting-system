import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicPath } from './route-guard';

const SW = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('installable app (PWA)', () => {
  it('the service worker and manifest load before sign-in (no route-guard redirect)', () => {
    expect(publicPath('/sw.js')).toBe(true);
    expect(publicPath('/manifest.webmanifest')).toBe(true);
    expect(publicPath('/icons/icon-192.png')).toBe(true);
  });
  it('caches only public static files – never pages or API data', () => {
    expect(SW).toMatch(/r\.method !== 'GET'\) return/);
    expect(SW).toMatch(/r\.mode === 'navigate'[\s\S]*fetch\(r\)\.catch/);
    expect(SW).not.toMatch(/startsWith\('\/api/);
    expect(SW).toMatch(/startsWith\('\/_next\/static\/'\)/);
  });
});
