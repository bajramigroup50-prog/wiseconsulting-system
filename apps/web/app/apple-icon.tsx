import { pwaIcon } from '@/lib/pwa-icon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** apple-touch-icon (iOS „Add to Home Screen“): full-bleed, iOS rounds the corners itself. */
export default function AppleIcon() {
  return pwaIcon(180, true);
}
