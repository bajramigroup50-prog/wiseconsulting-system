/**
 * Device guard (pure, unit-tested): which requests the app refuses because of the computer they come from.
 *
 * Caddy verifies the TLS client certificate against the device CA (`DEVICE_CERTS`, docker/Caddyfile) and forwards its
 * SHA-256 fingerprint as `x-wise-client-fp`. Caddy has no CRL, so revocation is enforced here:
 *   off       → nothing is checked (current deploy);
 *   optional  → computers without a certificate pass (enrolment period); a revoked or unknown certificate is refused;
 *   required  → only an active, known device passes (Caddy already drops connections without a valid certificate;
 *               this also covers the IP_HOST site, which has no client_auth).
 * A device bound to a client firm is used by that firm's client users and by office staff only.
 */
export type DeviceMode = 'off' | 'optional' | 'required';
export const FP_HEADER = 'x-wise-client-fp';

/** Normalised fingerprint from a header (`AB:CD…` / `abcd…`), or '' when it is not a SHA-256. */
export const normFp = (v: string | null | undefined) => {
  const s = (v ?? '').replace(/[:\s]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : '';
};

export const deviceMode = (v: string | undefined | null): DeviceMode => {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'optional' || s === 'required' ? s : 'off';
};

/** Paths never refused: the container health check (127.0.0.1, no Caddy). */
export const deviceFreePath = (p: string) => p === '/api/health';

export interface DeviceRow { id: string; status: string; firmId: string | null; name: string }

export type DeviceVerdict =
  | { ok: true; device: DeviceRow | null }
  | { ok: false; reason: 'none' | 'unknown' | 'revoked' | 'firm' };

export function deviceVerdict(mode: DeviceMode, path: string, fp: string, device: DeviceRow | null | undefined): DeviceVerdict {
  if (mode === 'off' || deviceFreePath(path)) return { ok: true, device: null };
  if (!fp) return mode === 'required' ? { ok: false, reason: 'none' } : { ok: true, device: null };
  if (!device) return { ok: false, reason: 'unknown' };
  if (device.status !== 'active') return { ok: false, reason: 'revoked' };
  return { ok: true, device };
}

/**
 * A client user on a device bound to a firm: only if the user belongs to that firm, and (when a firm is chosen) only
 * that firm. Office staff and office devices (no firm) are not restricted.
 */
export function deviceUserOk(device: DeviceRow | null, role: string, userFirms: readonly string[], chosenFirm: string | null | undefined): boolean {
  if (!device?.firmId || role !== 'klient') return true;
  if (!userFirms.includes(device.firmId)) return false;
  return !chosenFirm || chosenFirm === device.firmId;
}

export const DEVICE_MSG: Record<'none' | 'unknown' | 'revoked' | 'firm', string> = {
  none: 'Овој компјутер не е овластен за пристап до WISE CONSULTING.',
  unknown: 'Сертификатот на овој компјутер не е познат.',
  revoked: 'Пристапот за овој компјутер е одземен.',
  firm: 'Овој компјутер е наменет за друга фирма.',
};

/** The 403 page: a short closing message (no login form, nothing else to find). */
export function devicePage(reason: keyof typeof DEVICE_MSG): string {
  return '<!doctype html><html lang="mk"><head><meta charset="utf-8"><title>WISE CONSULTING</title>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;color:#0d5b4b;max-width:640px">'
    + `<h2>🔐 WISE CONSULTING</h2><p>${DEVICE_MSG[reason]}</p>`
    + '<p>Обратете се кај WISE CONSULTING за инсталација на овој компјутер.</p></body></html>';
}
