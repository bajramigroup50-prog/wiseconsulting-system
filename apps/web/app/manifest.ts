import type { MetadataRoute } from 'next';
import { PWA_GREEN } from '@/lib/pwa-icon';

/** Installable desktop / mobile app (PWA), served at /manifest.webmanifest. No middleware guards it or the icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'WISE CONSULTING',
    short_name: 'WISE',
    description: 'Сметководствена програма WISE CONSULTING',
    lang: 'mk',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PWA_GREEN,
    theme_color: PWA_GREEN,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
