import type { Metadata, Viewport } from 'next';
import './legacy.css';
import './legacy-injected.css';

export const metadata: Metadata = { title: 'WISE CONSULTING' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mk">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Onest:wght@600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
