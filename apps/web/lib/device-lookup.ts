/**
 * Device lookup for `proxy.ts` (getDb directly, like the rest of the proxy): the device row by certificate fingerprint,
 * cached 30 s per fingerprint (one indexed query per device per half minute), and „last seen“ (time + IP) written at
 * most every 5 minutes. The first connection also clears the stored installer bundle (the device is enrolled).
 * Revocation clears the cache in this process at once (`forgetDevice`); the single app container is the only reader.
 */
import { and, eq, isNotNull, or, lt, isNull } from 'drizzle-orm';
import { devices, getDb } from '@wise/db';
import type { DeviceRow } from './device-guard';

const TTL = 30_000;
const SEEN_MS = 5 * 6e4;
// on globalThis: the proxy and the server actions are separate bundles (separate module instances) in one process
const G = globalThis as { __wiseDevCache?: Map<string, { at: number; row: DeviceRow | null }>; __wiseDevSeen?: Map<string, number> };
const cache = (G.__wiseDevCache ??= new Map());

export function forgetDevice(fp?: string) { if (fp) cache.delete(fp); else cache.clear(); }

export async function deviceByFp(fp: string): Promise<DeviceRow | null> {
  const c = cache.get(fp);
  if (c && Date.now() - c.at < TTL) return c.row;
  const [r] = await getDb().select({ id: devices.id, status: devices.status, firmId: devices.firmId, name: devices.name })
    .from(devices).where(eq(devices.fingerprint, fp)).limit(1);
  const row = r ?? null;
  if (cache.size > 5000) cache.clear();
  cache.set(fp, { at: Date.now(), row });
  return row;
}

const seen = (G.__wiseDevSeen ??= new Map());
/** „Last seen“ (throttled); on the first connection the installer bundle is dropped. Never throws. */
export async function touchDevice(id: string, ip: string | null): Promise<void> {
  const now = Date.now();
  if (now - (seen.get(id) ?? 0) < SEEN_MS) return;
  seen.set(id, now);
  try {
    await getDb().update(devices).set({ lastSeenAt: new Date(now), lastSeenIp: ip?.slice(0, 64) ?? null, bundle: null })
      .where(and(eq(devices.id, id), eq(devices.status, 'active'),
        or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, new Date(now - SEEN_MS)), isNotNull(devices.bundle))));
  } catch { /* last-seen is informational */ }
}
