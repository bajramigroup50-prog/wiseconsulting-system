import { pwaIcon } from '@/lib/pwa-icon';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** Browser tab icon — the legacy „W“ brand mark. */
export default function Icon() {
  return pwaIcon(64);
}
