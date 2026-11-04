import { pwaIcon } from '@/lib/pwa-icon';

export const dynamic = 'force-dynamic'; // the letter of this server's brand

export function GET() {
  return pwaIcon(512, true);
}
