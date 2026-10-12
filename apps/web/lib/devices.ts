import 'server-only';
/**
 * 🔐 Уреди (компјутери) — loaders shared by the owner screen, its actions and the installer download.
 * Only the office owner (`lib/office-owner.ts`) sees or changes enrolled devices.
 */
import { stat } from 'node:fs/promises';
import { asc, desc, eq } from 'drizzle-orm';
import { devices, firms } from '@wise/db';
import { getUser, requireUser, type SessionUser } from './auth';
import { db } from './db';
import { DEVICE_CA_CN, installerPath, loadCa } from './device-certs';
import { deviceMode, type DeviceMode } from './device-guard';
import { viewAllowed } from './nav';
import { isOfficeOwner } from './office-owner';

export const CA_MISSING_MSG = 'Сертификатот на канцеларијата (CA) уште не е креиран на серверот (docker/device-ca.sh).';
export const OFFICE_LABEL = 'Канцеларија (нашата)';
/** Name prefix of the office's own computers. */
export const OFFICE_PREFIX = 'Канцеларија';

export async function devicesGate(): Promise<{ u: SessionUser; ok: boolean }> {
  const u = await requireUser();
  return { u, ok: viewAllowed(u.role, 'uredi') && await isOfficeOwner(u) };
}
export async function devicesGateApi(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && viewAllowed(u.role, 'uredi') && await isOfficeOwner(u) ? u : null;
}

/** „<Firm> – уред N“ (+ „ – <suffix>“ when the owner adds one, e.g. „каса 1“). */
export const deviceName = (firmName: string, no: number, suffix?: string | null) =>
  `${firmName.trim()} – уред ${no}${suffix?.trim() ? ` – ${suffix.replace(/\s+/g, ' ').trim()}` : ''}`;

export interface DeviceListRow {
  id: string; name: string; no: number; firmId: string | null; firmName: string | null; status: string; createdAt: Date;
  notAfter: Date; lastSeenAt: Date | null; lastSeenIp: string | null; revokedAt: Date | null; revokeReason: string | null;
  downloads: number; hasBundle: boolean; fingerprint: string;
}

export async function listDevices(): Promise<DeviceListRow[]> {
  const R = await db().select({
    id: devices.id, name: devices.name, no: devices.no, firmId: devices.firmId, firmName: firms.name, status: devices.status,
    createdAt: devices.createdAt, notAfter: devices.notAfter, lastSeenAt: devices.lastSeenAt, lastSeenIp: devices.lastSeenIp,
    revokedAt: devices.revokedAt, revokeReason: devices.revokeReason, downloads: devices.downloads, bundle: devices.bundle,
    fingerprint: devices.fingerprint,
  }).from(devices).leftJoin(firms, eq(firms.id, devices.firmId)).orderBy(asc(firms.name), asc(devices.no), desc(devices.createdAt));
  return R.map(({ bundle, ...r }) => ({ ...r, hasBundle: !!bundle }));
}

/** Devices grouped by firm: the office first, then the firms A–Z. */
export function groupDevices(R: DeviceListRow[]): { key: string; label: string; rows: DeviceListRow[] }[] {
  const M = new Map<string, { key: string; label: string; rows: DeviceListRow[] }>();
  for (const r of R) {
    const key = r.firmId ?? 'office';
    if (!M.has(key)) M.set(key, { key, label: r.firmId ? r.firmName ?? '—' : OFFICE_LABEL, rows: [] });
    M.get(key)!.rows.push(r);
  }
  return [...M.values()].sort((a, b) => (a.key === 'office' ? -1 : b.key === 'office' ? 1 : a.label.localeCompare(b.label, 'mk')));
}

export interface DeviceSetup { mode: DeviceMode; ca: { ok: boolean; cn?: string; notAfter?: string }; installer: { ok: boolean; size?: number; path: string } }

export async function deviceSetup(): Promise<DeviceSetup> {
  const ca = await loadCa();
  let caInfo: DeviceSetup['ca'] = { ok: false };
  if (ca) {
    try {
      const { X509Certificate } = await import('node:crypto');
      const x = new X509Certificate(ca.certPem);
      caInfo = { ok: true, cn: /CN=([^\n,]+)/.exec(x.subject)?.[1] ?? DEVICE_CA_CN, notAfter: new Date(x.validTo).toISOString() };
    } catch { caInfo = { ok: false }; }
  }
  const p = installerPath();
  const st = await stat(p).catch(() => null);
  return { mode: deviceMode(process.env.DEVICE_CERTS), ca: caInfo, installer: { ok: !!st?.isFile(), size: st?.size, path: p } };
}

export async function firmChoices(): Promise<{ id: string; name: string; city: string | null; edb: string | null }[]> {
  return db().select({ id: firms.id, name: firms.name, city: firms.city, edb: firms.edb }).from(firms)
    .where(eq(firms.active, true)).orderBy(asc(firms.name));
}
