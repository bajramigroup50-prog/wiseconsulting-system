import { pwaIcon } from '@/lib/pwa-icon';

export const dynamic = 'force-static';

export function GET() {
  return pwaIcon(512);
}
